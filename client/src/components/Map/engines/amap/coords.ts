/**
 * The ONE channel coordinates cross between TREK and AMap.
 *
 * Everything TREK stores or transmits is WGS84; AMap speaks GCJ-02. Both
 * transforms come from @trek/shared (package 01, same local source in both
 * directions, so the round-trip residuals cancel) and this module is the only
 * place in the client allowed to call them — the no-restricted-imports gate in
 * eslint.config.mjs enforces it. MapViewAMap converts on the way in and on the
 * way out; nothing else in the renderer sees a GCJ-02 number as anything but
 * an opaque AMap coordinate.
 *
 * See docs/amap/00-constraints.md (坐标铁律): never AMap.convertFrom, never a
 * "correction" of the ~7 m western-China approximation, never a raw AMap
 * coordinate handed to a callback.
 */
import { gcj02LngLat, wgs2gcj, gcj2wgs, wgs84LngLat } from '@trek/shared'
import type { Gcj02LngLat, Wgs84LngLat } from '@trek/shared'

/** The coordinate form AMap APIs take: [lng, lat] in GCJ-02. */
export type AMapLngLat = [number, number]

/** WGS84 {lat, lng} → GCJ-02 [lng, lat], the shape every AMap constructor wants. */
export function toAMap(point: { lat: number; lng: number }): AMapLngLat {
  const gcj: Gcj02LngLat = wgs2gcj(wgs84LngLat(point.lat, point.lng))
  return [gcj.lng, gcj.lat]
}

/**
 * A coordinate AMap handed back (event lnglat, marker position, bounds corner)
 * → WGS84 {lat, lng}. EVERY value that leaves the renderer to the rest of the
 * app goes through here first.
 */
export function fromAMap(lnglat: { lng: number; lat: number } | AMapLngLat): { lat: number; lng: number } {
  const lng = Array.isArray(lnglat) ? lnglat[0] : lnglat.lng
  const lat = Array.isArray(lnglat) ? lnglat[1] : lnglat.lat
  const wgs: Wgs84LngLat = gcj2wgs(gcj02LngLat(lat, lng))
  return { lat: wgs.lat, lng: wgs.lng }
}

// ── GeoJSON ────────────────────────────────────────────────────────────────
//
// Plugin map layers and any future GeoJSON-carrying surface hand the renderer
// nested position arrays, where ONE missed vertex shows up as a feature drawn
// a few hundred metres off. `transformGeoJson` walks the whole structure once —
// Point / LineString / Polygon / MultiPolygon / GeometryCollection / Feature /
// FeatureCollection — so callers never hand-roll the recursion (02b brief).

/** Standard GeoJSON position: [lng, lat] (note the order — NOT TREK's [lat, lng]). */
export type GeoJsonPosition = [number, number]

function isPosition(v: unknown): v is GeoJsonPosition {
  return Array.isArray(v) && v.length >= 2 && typeof v[0] === 'number' && typeof v[1] === 'number'
}

/** Converts one position in place-of-value: [lng, lat] WGS84 → [lng, lat] GCJ-02. */
function transformPosition(pos: GeoJsonPosition): GeoJsonPosition {
  const gcj = wgs2gcj(wgs84LngLat(pos[1], pos[0]))
  return [gcj.lng, gcj.lat]
}

/** Converts a nested position array of any depth (the recursive core). */
function transformPositionTree(node: unknown): unknown {
  if (isPosition(node)) return transformPosition(node)
  if (Array.isArray(node)) return node.map(transformPositionTree)
  return node
}

/**
 * Deep-converts a GeoJSON value's coordinates from WGS84 to GCJ-02, returning a
 * new structure (the input is untouched). Unknown shapes pass through so a
 * future geo type cannot silently drop a vertex — it would at worst draw
 * unconverted, which a position check catches, rather than vanish.
 */
export function transformGeoJson<T>(geojson: T): T {
  if (!geojson || typeof geojson !== 'object') return geojson
  const obj = geojson as Record<string, unknown>
  if (obj.type === 'FeatureCollection' && Array.isArray(obj.features)) {
    return { ...obj, features: obj.features.map(f => transformGeoJson(f)) } as T
  }
  if (obj.type === 'Feature' && 'geometry' in obj) {
    return { ...obj, geometry: transformGeoJson(obj.geometry) } as T
  }
  if (Array.isArray(obj.coordinates)) {
    return { ...obj, coordinates: transformPositionTree(obj.coordinates) } as T
  }
  if (obj.type === 'GeometryCollection' && Array.isArray(obj.geometries)) {
    return { ...obj, geometries: obj.geometries.map(g => transformGeoJson(g)) } as T
  }
  return geojson
}

/**
 * Converts TREK's plugin-layer position arrays — `[lat, lng]` pairs, NOT
 * GeoJSON order — to GCJ-02 `[lng, lat]` paths for AMap vector overlays.
 */
export function transformLatLngPath(path: ReadonlyArray<readonly [number, number]>): AMapLngLat[] {
  return path.map(([lat, lng]) => toAMap({ lat, lng }))
}
