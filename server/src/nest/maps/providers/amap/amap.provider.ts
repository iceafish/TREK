/**
 * AMap Web Service provider — 检索 / 补全 / 详情 / 逆地理 / POI 探索
 * (docs/amap/03-server-provider.md).
 *
 * Stateless: every method takes the resolved key explicitly (the caller runs
 * the credential chain), so tests stub global fetch and pass a fake key.
 *
 * Coordinate law (docs/amap/00-constraints.md): AMap speaks GCJ-02, the
 * contract above this class speaks WGS84. Request position preferences go
 * through toAmap; EVERY coordinate in a response goes through fromAmap before
 * it leaves this file. Upstream errors surface with the upstream HTTP status
 * where there is one — AMap answers HTTP 200 with a body-level
 * `{ status: '0', info }` rejection, which becomes a 502 so the controller's
 * error mapping stays intact.
 *
 * Not covered here, on purpose: place photos and enrichment (OSM/Wikimedia
 * pipeline) — AMap offers no equivalent fields and the enrichment chain only
 * needs a place name + WGS84 coordinates (docs/amap/03-server-provider.md).
 */
import { fromAmap, toAmap, toAmapLocationString } from './coords';
import { amapTypesForCategory } from './amap.categories';
import type { OverpassPoi } from '../../maps.helpers';

const BASE_URL = 'https://restapi.amap.com';
const TIMEOUT_MS = 10_000;

/** One POI as AMap's v3 place endpoints return it (subset we read). */
interface AmapPoi {
  id?: string;
  name?: string;
  type?: string;
  typecode?: string;
  /** Frequently an EMPTY ARRAY instead of a string when unset — normalize. */
  address?: string | unknown[];
  location?: string | { lng: number; lat: number };
  tel?: string | unknown[];
  website?: string;
  biz_ext?: { rating?: string | unknown[]; cost?: string | unknown[] };
  /** Only returned with extensions=all (docs/amap/06); `title`/`provider` may be []. */
  photos?: Array<{ title?: string | unknown[]; provider?: unknown[]; url?: string }>;
}

interface AmapEnvelope {
  status?: string;
  info?: string;
  infocode?: string;
  count?: string;
  pois?: AmapPoi[];
  tips?: Array<{ id?: string; name?: string; district?: string; address?: string | unknown[]; location?: string }>;
  regeocode?: {
    formatted_address?: string;
    addressComponent?: {
      neighborhood?: { name?: string };
      building?: { name?: string };
      township?: string;
      pois?: Array<{ name?: string }>;
      aois?: Array<{ name?: string }>;
    };
  };
}

/** Parses AMap's "lng,lat" location string (or object form) into numbers. */
function parseLocation(loc: AmapPoi['location'] | string | undefined): { lng: number; lat: number } | null {
  if (!loc) return null;
  if (typeof loc === 'object') {
    const lat = Number(loc.lat);
    const lng = Number(loc.lng);
    return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
  }
  const [lng, lat] = loc.split(',').map(Number);
  return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
}

/** AMap answers HTTP 200 for rejections; normalize to a thrown upstream error. */
async function callAmap(key: string, path: string, params: Record<string, string>): Promise<AmapEnvelope> {
  const url = new URL(BASE_URL + path);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  url.searchParams.set('key', key);
  const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) {
    throw Object.assign(new Error(`AMap API error: ${res.status} ${res.statusText}`), { status: res.status });
  }
  const data = (await res.json()) as AmapEnvelope;
  if (data.status !== '1') {
    throw Object.assign(new Error(`AMap API error: ${data.info || 'unknown rejection'}`), {
      status: 502,
      infocode: data.infocode,
    });
  }
  return data;
}

function normalizeString(v: string | unknown[] | undefined): string | null {
  return typeof v === 'string' && v.trim() !== '' ? v : null;
}

/** One search/POI result in the provider-shaped record the contract keeps open. */
function poiToRecord(poi: AmapPoi): Record<string, unknown> {
  const loc = parseLocation(poi.location);
  const wgs = loc ? fromAmap(loc) : null;
  const rating = typeof poi.biz_ext?.rating === 'string' ? Number.parseFloat(poi.biz_ext.rating) : Number.NaN;
  return {
    // Provider-shaped record, by analogy with the Google/OSM records. `amap_id`
    // is the provider's own slot (details routes on the `amap:` prefix of the
    // id, the same way OSM routes on its `type:id`); `osm_id` mirrors the pois()
    // parity convention — the client round-trips `google_place_id || osm_id`
    // into details/photo requests and both places tables persist `osm_id`, so
    // without it the id is lost the moment a search result is picked
    // (docs/amap/06).
    google_place_id: null,
    amap_id: poi.id ? `amap:${poi.id}` : null,
    osm_id: poi.id ? `amap:${poi.id}` : 'amap:unknown',
    name: poi.name || '',
    address: normalizeString(poi.address) || '',
    lat: wgs?.lat ?? null,
    lng: wgs?.lng ?? null,
    rating: Number.isFinite(rating) ? rating : null,
    website: typeof poi.website === 'string' && poi.website !== '' ? poi.website : null,
    phone: normalizeString(poi.tel),
    types: typeof poi.type === 'string' ? poi.type.split('|') : [],
    source: 'amap',
  };
}

export interface AmapSearchOptions {
  key: string;
  query: string;
  locationBias?: { lat: number; lng: number; radius?: number };
}

export interface AmapSearchResult {
  places: Record<string, unknown>[];
}

export interface AmapAutocompleteResult {
  suggestions: { placeId: string; mainText: string; secondaryText: string }[];
}

export interface AmapReverseResult {
  name: string | null;
  address: string | null;
}

export interface AmapPoisOptions {
  key: string;
  category: string;
  bbox: { south: number; west: number; north: number; east: number };
  limit?: number;
}

/** Haversine distance in metres (the bbox radius is a display preference, not surveying). */
function haversineM(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.sqrt(h));
}

/** place/around caps radius at 50 km. */
const MAX_AROUND_RADIUS_M = 50_000;

export class AmapProvider {
  /** 关键字检索 — v3/place/text. */
  async search(opts: AmapSearchOptions): Promise<AmapSearchResult> {
    const params: Record<string, string> = {
      keywords: opts.query,
      offset: '10',
      page: '1',
      extensions: 'base',
    };
    if (opts.locationBias) {
      const gcj = toAmap(opts.locationBias);
      params.location = toAmapLocationString(gcj);
      params.radius = String(opts.locationBias.radius ?? 50_000);
    }
    const data = await callAmap(opts.key, '/v3/place/text', params);
    return { places: (data.pois || []).map(poiToRecord) };
  }

  /** 输入提示 — v3/assistant/inputtips. */
  async autocomplete(opts: { key: string; input: string; locationBias?: { low: { lat: number; lng: number }; high: { lat: number; lng: number } } }): Promise<AmapAutocompleteResult> {
    const params: Record<string, string> = { keywords: opts.input };
    if (opts.locationBias) {
      // Input tips take a single location hint — the rectangle's centre.
      const centre = {
        lat: (opts.locationBias.low.lat + opts.locationBias.high.lat) / 2,
        lng: (opts.locationBias.low.lng + opts.locationBias.high.lng) / 2,
      };
      params.location = toAmapLocationString(toAmap(centre));
    }
    const data = await callAmap(opts.key, '/v3/assistant/inputtips', params);
    const suggestions = (data.tips || [])
      .slice(0, 5)
      .map((tip) => {
        const mainText = tip.name || '';
        const secondaryText = [tip.district, normalizeString(tip.address)].filter(Boolean).join('');
        // POI tips carry an id and round-trip into details; address-level tips
        // have none — their id names the tip so the value stays a string, and
        // the later details lookup degrades to the same null-place miss every
        // unresolvable id already produces.
        const placeId = tip.id ? `amap:${tip.id}` : `amap:tip:${encodeURIComponent(mainText)}`;
        return { placeId, mainText, secondaryText };
      })
      .filter((s) => s.mainText !== '');
    return { suggestions };
  }

  /** POI 详情 — v3/place/detail. */
  async details(opts: { key: string; placeId: string }): Promise<Record<string, unknown> | null> {
    const id = opts.placeId.startsWith('amap:') ? opts.placeId.slice('amap:'.length) : opts.placeId;
    const data = await callAmap(opts.key, '/v3/place/detail', { id });
    const poi = data.pois?.[0];
    if (!poi) return null;
    return poiToRecord(poi);
  }

  /**
   * POI 图片候选 — v3/place/detail with extensions=all (`docs/amap/06`).
   *
   * The default `base` payload never carries `photos`, so this is deliberately
   * its own call rather than a flag on `details()`. The urls are autonavi image
   * CDN direct links; they are normalized here (https, drop empties) but NOT
   * handed to clients raw — the photo pipeline downloads and re-serves them
   * through the shared bytes proxy.
   */
  async photos(opts: { key: string; placeId: string }): Promise<{ title: string | null; url: string }[]> {
    const id = opts.placeId.startsWith('amap:') ? opts.placeId.slice('amap:'.length) : opts.placeId;
    // "amap:unknown" — the id-less sentinel pois()/poiToRecord mint — has
    // nothing to look up; the detail call would just bill a rejection.
    if (!id || id === 'unknown') return [];
    const data = await callAmap(opts.key, '/v3/place/detail', { id, extensions: 'all' });
    const out: { title: string | null; url: string }[] = [];
    for (const photo of data.pois?.[0]?.photos ?? []) {
      const url = typeof photo?.url === 'string' ? photo.url.trim() : '';
      if (!/^https?:\/\//i.test(url)) continue;
      // store.is.autonavi.com serves both schemes; https is verified working,
      // and the proxy's outbound fetch should not downgrade on principle.
      out.push({
        title: typeof photo.title === 'string' && photo.title ? photo.title : null,
        url: url.replace(/^http:\/\//i, 'https://'),
      });
    }
    return out;
  }

  /** 逆地理编码 — v3/geocode/regeo (extensions=all for the POI/AOI names). */
  async reverse(opts: { key: string; lat: number; lng: number }): Promise<AmapReverseResult> {
    // The incoming coordinate is WGS84 (the client's stored datum); AMap needs GCJ-02.
    const gcj = toAmap({ lat: opts.lat, lng: opts.lng });
    const data = await callAmap(opts.key, '/v3/geocode/regeo', {
      location: toAmapLocationString(gcj),
      extensions: 'all',
    });
    const regeo = data.regeocode;
    if (!regeo) return { name: null, address: null };
    const ac = regeo.addressComponent;
    const name =
      ac?.neighborhood?.name || ac?.building?.name || ac?.aois?.[0]?.name || ac?.pois?.[0]?.name || null;
    return {
      name,
      address: regeo.formatted_address || null,
    };
  }

  /** POI 周边搜索 — v3/place/around. The bbox becomes a centre + radius (GCJ-02). */
  async pois(opts: AmapPoisOptions, limit = 60): Promise<{
    pois: OverpassPoi[];
    source: 'amap';
    truncated: boolean;
    clamped: boolean;
  }> {
    const types = amapTypesForCategory(opts.category);
    if (!types) throw Object.assign(new Error('Unknown POI category'), { status: 400 });

    const centreWgs = {
      lat: (opts.bbox.south + opts.bbox.north) / 2,
      lng: (opts.bbox.west + opts.bbox.east) / 2,
    };
    const radius = Math.min(
      MAX_AROUND_RADIUS_M,
      Math.max(
        haversineM(centreWgs, { lat: opts.bbox.north, lng: opts.bbox.east }),
        haversineM(centreWgs, { lat: opts.bbox.south, lng: opts.bbox.west }),
      ),
    );
    // The requested bbox always fits inside the returned radius, so `clamped`
    // is only ever true when the radius itself hit the 50 km ceiling — the same
    // "we shrank your view" semantics the Overpass path reports.
    const clamped = haversineM(centreWgs, { lat: opts.bbox.north, lng: opts.bbox.east }) > MAX_AROUND_RADIUS_M;

    const data = await callAmap(opts.key, '/v3/place/around', {
      location: toAmapLocationString(toAmap(centreWgs)),
      radius: String(Math.round(radius)),
      types,
      offset: String(limit),
      page: '1',
    });

    const pois: OverpassPoi[] = [];
    for (const poi of data.pois || []) {
      if (!poi.name) continue; // unnamed POIs aren't useful to add to a plan
      const loc = parseLocation(poi.location);
      const wgs = loc ? fromAmap(loc) : null;
      if (!wgs) continue;
      pois.push({
        // Contract parity with the Overpass rows: same field names (osm_id
        // included), same source slot — an amap row's osm_id is `amap:<poiid>`.
        osm_id: poi.id ? `amap:${poi.id}` : 'amap:unknown',
        name: poi.name,
        lat: wgs.lat,
        lng: wgs.lng,
        category: opts.category,
        poi_type: typeof poi.typecode === 'string' ? `typecode=${poi.typecode}` : 'amap',
        address: normalizeString(poi.address),
        website: typeof poi.website === 'string' && poi.website !== '' ? poi.website : null,
        phone: normalizeString(poi.tel),
        opening_hours: null,
        cuisine: null,
        source: 'amap',
      } satisfies OverpassPoi);
    }

    return { pois: pois.slice(0, limit), source: 'amap', truncated: pois.length > limit, clamped };
  }
}

/** Shared stateless instance — the MapsService holds this, nothing to inject. */
export const amapProvider = new AmapProvider();
