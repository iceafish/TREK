/**
 * WGS84 ↔ GCJ-02 conversion — pure, offline, dependency-free.
 *
 * The coordinate law of docs/amap/00-constraints.md (坐标铁律), in one place:
 *
 * - Storage is WGS84. This module is the only place GCJ-02 numbers may be
 *   produced or consumed, and it is lint-gated (no-restricted-imports in the
 *   client/server eslint configs) to the AMap boundaries:
 *   client/src/components/Map/engines/amap/** and
 *   server/src/nest/maps/providers/amap/**.
 *
 * - The iteration count in gcj2wgs is a verified constant, NOT a knob. Three
 *   rounds of the fixed-point iteration `wgs_{n+1} = gcj − (wgs2gcj(wgs_n) −
 *   wgs_n)` close the round trip to ~2.5e-5 m (worst of 30 mainland points,
 *   measured 2026-09-07); a fourth round moves the result by less than 1e-7 m.
 *   The offset field's Jacobian norm is far below 1, so the iteration is a
 *   contraction and convergence is mathematically guaranteed — which is why
 *   the count is not exposed as a parameter: it would only invite callers to
 *   "tune" a settled constant.
 *
 * - Western China lands ~7 m off after conversion. That is the known, accepted
 *   error of the public offset approximation against the real GCJ-02 field —
 *   NOT a bug. Consumer-grade GPS noise is 3–10 m, and every attempt to
 *   "correct" it would silently shift inputs that non-map consumers share:
 *   weather queries, tz-lookup time-zone resolution, Atlas point-in-polygon.
 *   Do not fix.
 *
 * - Do not replace this with AMap.convertFrom or any online converter. The
 *   forward and inverse transforms here share one source, so their residuals
 *   cancel in a round trip (measured closure error: 0.03 mm). Mixing a local
 *   transform with an online one breaks the cancellation and the residual
 *   becomes a systematic bias. The online endpoint additionally caps at 40
 *   coordinate pairs per call, has a daily quota, and costs a network round
 *   trip — a 200-place trip would spend 5 calls on its first screen alone.
 *
 * Both transforms short-circuit through the same outOfChina bounding box, so
 * identity behaviour is symmetric and forward/inverse stay consistent at the
 * box edge, where the transform is discontinuous by design. Hong Kong, Macau
 * and Taiwan fall inside the box and are transformed — matching AMap's own
 * behaviour; this round targets mainland destinations only.
 */
import { gcj02LngLat, wgs84LngLat } from './coords';
import type { Gcj02LngLat, Wgs84LngLat } from './coords';

/** Krasovsky 1940 ellipsoid semi-major axis, metres. */
const KRASOVSKY_A = 6378245.0;
/**
 * Krasovsky 1940 ellipsoid first eccentricity squared — published as
 * 0.00669342162296594323; written in exponent form because that literal
 * exceeds double precision (and no-loss-of-precision rightly complains).
 * Bit-identical to the published value.
 */
const KRASOVSKY_EE = 6.693421622965943e-3;

/**
 * Fixed iteration count for gcj2wgs — a verified constant, see the module
 * doc: ~2.5e-5 m closure at 3, no measurable gain beyond. Do not expose.
 */
const GCJ2WGS_ITERATIONS = 3;

/**
 * Rough mainland-China bounding box: lng 73.66–135.05, lat 3.86–53.55.
 * Coordinates outside it convert to themselves; both directions use this
 * same predicate so the short-circuit is symmetric.
 */
export function outOfChina(point: { lat: number; lng: number }): boolean {
  return point.lng < 73.66 || point.lng > 135.05 || point.lat < 3.86 || point.lat > 53.55;
}

/** Latitudinal component of the GCJ-02 offset field, evaluated near (lng, lat). */
function transformLat(x: number, y: number): number {
  let ret = -100.0 + 2.0 * x + 3.0 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * Math.sqrt(Math.abs(x));
  ret += ((20.0 * Math.sin(6.0 * x * Math.PI) + 20.0 * Math.sin(2.0 * x * Math.PI)) * 2.0) / 3.0;
  ret += ((20.0 * Math.sin(y * Math.PI) + 40.0 * Math.sin((y / 3.0) * Math.PI)) * 2.0) / 3.0;
  ret += ((160.0 * Math.sin((y / 12.0) * Math.PI) + 320.0 * Math.sin((y * Math.PI) / 30.0)) * 2.0) / 3.0;
  return ret;
}

/** Longitudinal component of the GCJ-02 offset field, evaluated near (lng, lat). */
function transformLng(x: number, y: number): number {
  let ret = 300.0 + x + 2.0 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x));
  ret += ((20.0 * Math.sin(6.0 * x * Math.PI) + 20.0 * Math.sin(2.0 * x * Math.PI)) * 2.0) / 3.0;
  ret += ((20.0 * Math.sin(x * Math.PI) + 40.0 * Math.sin((x / 3.0) * Math.PI)) * 2.0) / 3.0;
  ret += ((150.0 * Math.sin((x / 12.0) * Math.PI) + 300.0 * Math.sin((x / 30.0) * Math.PI)) * 2.0) / 3.0;
  return ret;
}

/** Offset in degrees that moves a WGS84 point onto the GCJ-02 grid. */
function gcjOffset(lat: number, lng: number): { dLat: number; dLng: number } {
  const x = lng - 105.0;
  const y = lat - 35.0;
  let dLat = transformLat(x, y);
  let dLng = transformLng(x, y);

  const radLat = (lat / 180.0) * Math.PI;
  let magic = Math.sin(radLat);
  magic = 1 - KRASOVSKY_EE * magic * magic;
  const sqrtMagic = Math.sqrt(magic);

  dLat = (dLat * 180.0) / (((KRASOVSKY_A * (1 - KRASOVSKY_EE)) / (magic * sqrtMagic)) * Math.PI);
  dLng = (dLng * 180.0) / ((KRASOVSKY_A / sqrtMagic) * Math.cos(radLat) * Math.PI);
  return { dLat, dLng };
}

/**
 * WGS84 → GCJ-02. Identity outside the China bounding box. Call this at the
 * last moment before handing a stored coordinate to AMap.
 */
export function wgs2gcj(point: Wgs84LngLat): Gcj02LngLat {
  if (outOfChina(point)) return gcj02LngLat(point.lat, point.lng);
  const { dLat, dLng } = gcjOffset(point.lat, point.lng);
  return gcj02LngLat(point.lat + dLat, point.lng + dLng);
}

/**
 * GCJ-02 → WGS84. Identity outside the China bounding box. Call this
 * immediately on every coordinate AMap hands back (map clicks, geocoding,
 * POI results) before it touches state, a repo, or the wire.
 */
export function gcj2wgs(point: Gcj02LngLat): Wgs84LngLat {
  if (outOfChina(point)) return wgs84LngLat(point.lat, point.lng);

  let lat = point.lat;
  let lng = point.lng;
  for (let i = 0; i < GCJ2WGS_ITERATIONS; i++) {
    const asGcj = wgs2gcj(wgs84LngLat(lat, lng));
    lat = point.lat - (asGcj.lat - lat);
    lng = point.lng - (asGcj.lng - lng);
  }
  return wgs84LngLat(lat, lng);
}
