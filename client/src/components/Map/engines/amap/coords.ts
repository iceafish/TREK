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
