/**
 * Branded coordinate types — the compile-time half of the coordinate law in
 * docs/amap/00-constraints.md (坐标铁律).
 *
 * Everything at rest in TREK (SQLite, Dexie, the mutation queue, the REST
 * contract, GPX/KML in and out, the plugin contract) is WGS84. GCJ-02 exists
 * only inside the AMap rendering boundary: converted out of WGS84 right
 * before handing points to AMap, converted back immediately on the way in.
 *
 * `Wgs84LngLat` and `Gcj02LngLat` are deliberately NOT interchangeable. The
 * bug class this guards against never crashes — a swapped direction or a
 * double conversion simply lands every point a few hundred metres off,
 * silently, which is the hardest failure mode of the AMap integration to
 * even notice. The brands are module-private unique symbols, so a plain
 * `{ lat, lng }` literal can never satisfy either type by accident; values
 * enter through the constructor functions and the type system rejects
 * wrong-direction calls at compile time.
 *
 * This is a deliberate new convention — no other type in this repo is
 * branded. Do not "simplify" it to match its surroundings.
 */

// Runtime symbols (not exported — unforgeable outside this module), doubling
// as the unique-symbol computed keys of the two interfaces below.
const wgs84Brand = Symbol('wgs84');
const gcj02Brand = Symbol('gcj02');

/** A coordinate in WGS84 — the only coordinate system TREK stores or transmits. */
export interface Wgs84LngLat {
  readonly lat: number;
  readonly lng: number;
  readonly [wgs84Brand]: true;
}

/** A coordinate in GCJ-02 — exists only inside the AMap rendering boundary. */
export interface Gcj02LngLat {
  readonly lat: number;
  readonly lng: number;
  readonly [gcj02Brand]: true;
}

/** Brand a plain coordinate as WGS84. Only correct if lat/lng really are WGS84. */
export function wgs84LngLat(lat: number, lng: number): Wgs84LngLat {
  return { lat, lng, [wgs84Brand]: true };
}

/** Brand a plain coordinate as GCJ-02. Only correct if lat/lng really are GCJ-02. */
export function gcj02LngLat(lat: number, lng: number): Gcj02LngLat {
  return { lat, lng, [gcj02Brand]: true };
}
