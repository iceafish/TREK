import { describe, it, expect } from 'vitest'
import { toAMap, fromAMap, transformGeoJson, transformLatLngPath } from './coords'

/**
 * Coordinate boundary tests. The expected GCJ-02 values are from the
 * official-endpoint-validated snapshot table in docs/amap/01-coordinate-layer.md
 * (Tiananmen 39.9101013, 116.3974413) — independent ground truth, NOT this
 * implementation's own output, so a sign flip or lat/lng swap fails loudly.
 */
describe('engines/amap/coords — the WGS84 ↔ GCJ-02 boundary', () => {
  it('toAMap converts WGS84 {lat,lng} to GCJ-02 [lng,lat] for AMap', () => {
    // Tiananmen: WGS84 (39.9087, 116.3912) → GCJ-02 (39.9101013, 116.3974413).
    const [lng, lat] = toAMap({ lat: 39.9087, lng: 116.3912 })
    expect(lat).toBeCloseTo(39.9101013, 6)
    expect(lng).toBeCloseTo(116.3974413, 6)
    // AMap takes [lng, lat] — the swap this assertion exists to catch.
    expect(lng).toBeGreaterThan(100)
    expect(lat).toBeLessThan(60)
  })

  it('fromAMap converts an AMap event lnglat back to WGS84 {lat,lng}', () => {
    const wgs = fromAMap({ lng: 116.3974413, lat: 39.9101013 })
    expect(wgs.lat).toBeCloseTo(39.9087, 5)
    expect(wgs.lng).toBeCloseTo(116.3912, 5)
  })

  it('fromAMap accepts the [lng,lat] array form too', () => {
    const wgs = fromAMap([116.3974413, 39.9101013])
    expect(wgs.lat).toBeCloseTo(39.9087, 5)
    expect(wgs.lng).toBeCloseTo(116.3912, 5)
  })

  it('round-trips through the boundary', () => {
    const place = { lat: 31.2393, lng: 121.4905 } // the Bund
    const back = fromAMap(toAMap(place))
    expect(back.lat).toBeCloseTo(place.lat, 6)
    expect(back.lng).toBeCloseTo(place.lng, 6)
  })

  it('leaves coordinates outside China strictly unchanged (AMap still wants GCJ there)', () => {
    // Off the mainland box the transforms are identity, so the values AMap gets
    // are the values TREK stores — Tokyo.
    expect(toAMap({ lat: 35.6586, lng: 139.7454 })).toEqual([139.7454, 35.6586])
    expect(fromAMap({ lng: 139.7454, lat: 35.6586 })).toEqual({ lat: 35.6586, lng: 139.7454 })
  })
})

describe('transformGeoJson — recursive WGS84 → GCJ-02', () => {
  // Tiananmen WGS84 (116.3912, 39.9087) → GCJ-02 (116.3974413, 39.9101013).
  it('converts Point, LineString, Polygon and MultiPolygon coordinates', () => {
    const point = transformGeoJson({
      type: 'Point',
      coordinates: [116.3912, 39.9087],
    }) as { coordinates: [number, number] }
    expect(point.coordinates[0]).toBeCloseTo(116.3974413, 6)

    const line = transformGeoJson({
      type: 'LineString',
      coordinates: [[116.3912, 39.9087], [116.40, 39.92]],
    }) as { coordinates: Array<[number, number]> }
    expect(line.coordinates[0][0]).toBeCloseTo(116.3974413, 6)
    expect(line.coordinates[1][0]).toBeCloseTo(116.4062453, 6)

    const polygon = transformGeoJson({
      type: 'Polygon',
      coordinates: [[[116.3912, 39.9087], [116.40, 39.92], [116.38, 39.90], [116.3912, 39.9087]]],
    }) as { coordinates: Array<Array<[number, number]>> }
    expect(polygon.coordinates[0][2][0]).toBeCloseTo(116.3862311, 6)

    const multi = transformGeoJson({
      type: 'MultiPolygon',
      coordinates: [[[[116.3912, 39.9087], [116.40, 39.92], [116.38, 39.90], [116.3912, 39.9087]]]],
    }) as { coordinates: Array<Array<Array<[number, number]>>> }
    expect(multi.coordinates[0][0][1][1]).toBeCloseTo(39.9214044, 6)
  })

  it('walks Feature and FeatureCollection wrappers', () => {
    const fc = transformGeoJson({
      type: 'FeatureCollection',
      features: [{
        type: 'Feature',
        properties: { name: 'x' },
        geometry: { type: 'Point', coordinates: [116.3912, 39.9087] },
      }],
    }) as { features: Array<{ geometry: { coordinates: [number, number] } }> }
    expect(fc.features[0].geometry.coordinates[0]).toBeCloseTo(116.3974413, 6)
  })

  it('passes foreign members through untouched and does not mutate the input', () => {
    const input = {
      type: 'Feature',
      properties: { kept: 'yes' },
      geometry: { type: 'Point', coordinates: [116.3912, 39.9087] },
    }
    const out = transformGeoJson(input) as typeof input
    expect(out.properties).toEqual({ kept: 'yes' })
    expect(input.geometry.coordinates[0]).toBe(116.3912)
  })

  it('leaves coordinates outside China strictly unchanged', () => {
    const out = transformGeoJson({ type: 'Point', coordinates: [139.7454, 35.6586] }) as { coordinates: [number, number] }
    expect(out.coordinates).toEqual([139.7454, 35.6586])
  })
})

describe('transformLatLngPath — TREK [lat,lng] plugin paths → GCJ-02 [lng,lat]', () => {
  it('swaps the axis order AND applies the datum conversion', () => {
    const path = transformLatLngPath([[39.9087, 116.3912] as const])
    expect(path[0][1]).toBeCloseTo(39.9101013, 6)
    expect(path[0][0]).toBeCloseTo(116.3974413, 6)
  })
})
