/**
 * The server-side coordinate boundary for the AMap provider — the one place in
 * `server/src/nest/` allowed to import @trek/shared's coordinate functions
 * (the no-restricted-imports gate from package 01 pins exactly this directory).
 *
 * Direction of travel is the mirror of the client renderer's:
 * - REQUESTS that carry a position preference (search locationBias, POI bbox)
 *   convert WGS84 → GCJ-02 before hitting AMap;
 * - RESPONSES (every coordinate AMap returns) convert GCJ-02 → WGS84 HERE, so
 *   everything above the provider — controller, DTO, storage, wire — stays
 *   WGS84 (docs/amap/00-constraints.md, 坐标铁律).
 */

import { gcj02LngLat, wgs2gcj, gcj2wgs, wgs84LngLat } from '@trek/shared';
import type { Gcj02LngLat, Wgs84LngLat } from '@trek/shared';

/** AMap Web Service position form: "lng,lat" (GCJ-02). */
export type AmapLngLat = [number, number];

/** WGS84 {lat, lng} → GCJ-02 {lat, lng} for request parameters. */
export function toAmap(position: { lat: number; lng: number }): { lat: number; lng: number } {
  const gcj: Gcj02LngLat = wgs2gcj(wgs84LngLat(position.lat, position.lng));
  return { lat: gcj.lat, lng: gcj.lng };
}

/** GCJ-02 → WGS84 for every coordinate AMap hands back. */
export function fromAmap(position: { lat: number; lng: number }): { lat: number; lng: number } {
  const wgs: Wgs84LngLat = gcj2wgs(gcj02LngLat(position.lat, position.lng));
  return { lat: wgs.lat, lng: wgs.lng };
}

/** GCJ-02 {lat, lng} → the "lng,lat" string AMap Web Service expects. */
export function toAmapLocationString(position: { lat: number; lng: number }): string {
  return `${position.lng},${position.lat}`;
}
