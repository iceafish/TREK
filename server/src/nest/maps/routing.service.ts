import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { readEnv } from '../../app-config';
import { resolveAmapSecret } from '../settings/instance-api-keys';
import { fromAmap, toAmap, toAmapLocationString } from './providers/amap/coords';

/**
 * Server-side routing over the AMap Web Service (docs/amap/04-server-provider…,
 * 04-routing.md). Replaces the browser's direct calls to the public OSRM
 * instances: the key stays server-side, quota lives here, and the coordinate
 * boundary is enforced in one place — waypoints arrive WGS84, requests leave
 * GCJ-02, every returned point goes back through fromAmap before it leaves.
 *
 * AMap has no single multi-waypoint walking/cycling call and its driving
 * waypoint split isn't exposed per-leg, so the route is assembled from
 * per-pair calls (origin = wp[i], destination = wp[i+1]). That yields exactly
 * one leg per waypoint pair — the shape the client's sidebar connectors and
 * the plugin-route normalization already use — at the cost of N-1 upstream
 * calls per route, which the cache below exists to absorb.
 *
 * The response is raw numbers in the plugin-route normalization's shape:
 * { route: { coordinates: [lat,lng][], distance, duration, legs: [{distance,
 * duration}] } } — the client owns all formatting (units, text).
 */

const BASE_URL = 'https://restapi.amap.com';
const TIMEOUT_MS = 10_000;
/** place/around-style upstream quota rejections surface as 502 → client falls back to straight lines. */
const UPSTREAM_ERROR_STATUS = 502;

interface RouteCacheEntry {
  at: number;
  value: AmapRoute;
}

export interface AmapRoute {
  coordinates: Array<[number, number]>;
  distance: number;
  duration: number;
  legs: Array<{ distance: number; duration: number }>;
}

export type AmapRouteProfile = 'driving' | 'walking' | 'cycling';

// Short-lived cache keyed by profile + exact waypoint list — the server-side
// half of the strategy RouteCalculator used against OSRM (the client keeps its
// formatted-result cache as the first layer).
const ROUTE_CACHE = new Map<string, RouteCacheEntry>();
const ROUTE_CACHE_TTL_MS = 10 * 60 * 1000;
const ROUTE_CACHE_MAX = 200;

@Injectable()
export class RoutingService {
  constructor(private readonly database: DatabaseService) {}

  async route(
    waypoints: Array<{ lat: number; lng: number }>,
    profile: AmapRouteProfile,
  ): Promise<AmapRoute> {
    const key = this.resolveKey();
    const cacheKey = `${profile}|${waypoints.map((p) => `${p.lat},${p.lng}`).join(';')}`;

    const cached = ROUTE_CACHE.get(cacheKey);
    if (cached && Date.now() - cached.at < ROUTE_CACHE_TTL_MS) return cached.value;
    if (cached) ROUTE_CACHE.delete(cacheKey); // expired — drop before refetching

    const legs: Array<{ distance: number; duration: number }> = [];
    const coordinates: Array<[number, number]> = [];
    let distance = 0;
    let duration = 0;

    for (let i = 0; i < waypoints.length - 1; i++) {
      const leg = await this.routeLeg(key, waypoints[i], waypoints[i + 1], profile);
      legs.push({ distance: leg.distance, duration: leg.duration });
      distance += leg.distance;
      duration += leg.duration;
      // Concatenate runs, dropping the repeated joint so the polyline has no
      // doubled point (the same join rule withHotelBookends applies client-side).
      const points = i === 0 ? leg.points : leg.points.slice(1);
      coordinates.push(...points);
    }

    const value: AmapRoute = { coordinates, distance, duration, legs };
    if (ROUTE_CACHE.size >= ROUTE_CACHE_MAX) {
      const oldest = ROUTE_CACHE.keys().next().value;
      if (oldest !== undefined) ROUTE_CACHE.delete(oldest);
    }
    ROUTE_CACHE.set(cacheKey, { at: Date.now(), value });
    return value;
  }

  /** Test helper: drop every cached route (mirrors RateLimitService.reset). */
  __resetRouteCacheForTests(): void {
    ROUTE_CACHE.clear();
  }

  private resolveKey(): string {
    const { key } = resolveAmapSecret(this.database, 'amap_web_service_key', readEnv().maps.amapWebServiceKey);
    if (!key) {
      throw Object.assign(new Error('AMap routing is not configured'), { status: 503 });
    }
    return key;
  }

  /** One origin→destination call. Returns the leg plus its WGS84 point list. */
  private async routeLeg(
    key: string,
    from: { lat: number; lng: number },
    to: { lat: number; lng: number },
    profile: AmapRouteProfile,
  ): Promise<{ distance: number; duration: number; points: Array<[number, number]> }> {
    // WGS84 → GCJ-02: AMap plans on its own datum.
    const origin = toAmapLocationString(toAmap(from));
    const destination = toAmapLocationString(toAmap(to));

    let upstreamRes: Response;
    if (profile === 'cycling') {
      // v4 bicycling: numbers not strings, envelope is { errcode, data }.
      const url = new URL(`${BASE_URL}/v4/direction/bicycling`);
      url.searchParams.set('origin', origin);
      url.searchParams.set('destination', destination);
      url.searchParams.set('key', key);
      upstreamRes = await fetch(url, { signal: AbortSignal.timeout(10_000) });
      const body = (await upstreamRes.json()) as {
        errcode?: number;
        data?: { paths?: Array<{ distance?: number; duration?: number; steps?: Array<{ polyline?: string }> }> };
      };
      const path = body.data?.paths?.[0];
      if (!upstreamRes.ok || body.errcode !== 0 || !path) {
        throw Object.assign(new Error(`AMap routing error: ${body.errcode ?? upstreamRes.status}`), {
          status: UPSTREAM_ERROR_STATUS,
        });
      }
      return {
        distance: path.distance ?? 0,
        duration: (path.duration ?? 0) / 1000, // v4 reports milliseconds
        points: this.decodeSteps(path.steps, from, to),
      };
    }

    const endpoint = profile === 'walking' ? '/v3/direction/walking' : '/v3/direction/driving';
    const url = new URL(BASE_URL + endpoint);
    url.searchParams.set('origin', origin);
    url.searchParams.set('destination', destination);
    url.searchParams.set('extensions', 'base');
    url.searchParams.set('key', key);
    upstreamRes = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    const body = (await upstreamRes.json()) as {
      status?: string;
      info?: string;
      route?: { paths?: Array<{ distance?: string; duration?: string; steps?: Array<{ polyline?: string }> }> };
    };
    const path = body.route?.paths?.[0];
    if (!upstreamRes.ok || body.status !== '1' || !path) {
      throw Object.assign(new Error(`AMap routing error: ${body.info || upstreamRes.status}`), {
        status: UPSTREAM_ERROR_STATUS,
      });
    }
    return {
      distance: Number(path.distance ?? 0),
      duration: Number(path.duration ?? 0),
      points: this.decodeSteps(path.steps, from, to),
    };
  }

  /**
   * Concatenates a path's step polylines ("lng,lat;lng,lat;…") into one WGS84
   * [lat, lng] run. A path with no usable steps degrades to the straight
   * from→to pair, so a degraded upstream answer still draws a line.
   */
  private decodeSteps(
    steps: Array<{ polyline?: string }> | undefined,
    from: { lat: number; lng: number },
    to: { lat: number; lng: number },
  ): Array<[number, number]> {
    const points: Array<[number, number]> = [];
    for (const step of steps || []) {
      if (!step.polyline || typeof step.polyline !== 'string') continue;
      for (const pair of step.polyline.split(';')) {
        const [lng, lat] = pair.split(',').map(Number);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
        const wgs = fromAmap({ lat, lng });
        const last = points[points.length - 1];
        if (last && last[0] === wgs.lat && last[1] === wgs.lng) continue; // joint dedupe
        points.push([wgs.lat, wgs.lng]);
      }
    }
    if (points.length === 0) {
      // `from`/`to` are the request's WGS84 waypoints — a degenerate straight
      // line uses them as-is, no second conversion.
      points.push([from.lat, from.lng], [to.lat, to.lng]);
    }
    return points;
  }
}
