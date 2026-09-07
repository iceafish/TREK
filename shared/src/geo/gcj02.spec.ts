import { gcj02LngLat, wgs84LngLat } from './coords';
import type { Gcj02LngLat, Wgs84LngLat } from './coords';
import { gcj2wgs, outOfChina, wgs2gcj } from './gcj02';

import { describe, expect, expectTypeOf, it } from 'vitest';

/**
 * Regression baseline for the forward transform. The expected outputs were
 * produced (2026-09-07) by a conversion validated against AMap's official
 * endpoint over 30 mainland points — 0.13 m from the official transform at
 * Tiananmen — so they are the ground truth, not just this implementation's
 * echo. This table is the test that matters: round-trip closure alone cannot
 * catch a sign flip or a lat/lng swap, because an implementation that is
 * consistently wrong in both directions still closes its own loop.
 *
 * Useful direction signatures baked into these numbers: Tiananmen gains both
 * lat and lng; the Bund and Sanya Bay lose lat and gain lng; Mogao's total
 * shift is ~122 m against 340–555 m for the rest.
 */
const WGS84_FIXTURES = [
  { name: 'Tiananmen', lat: 39.9087, lng: 116.3912, gcjLat: 39.9101013, gcjLng: 116.3974413 },
  { name: 'the Bund', lat: 31.2393, lng: 121.4905, gcjLat: 31.2373137, gcjLng: 121.4949662 },
  { name: 'Jokhang Temple', lat: 29.653, lng: 91.132, gcjLat: 29.6502782, gcjLng: 91.1335435 },
  { name: 'Mogao Caves', lat: 40.041, lng: 94.809, gcjLat: 40.0416788, gcjLng: 94.8101238 },
  { name: 'Mohe', lat: 53.47, lng: 122.35, gcjLat: 53.4720265, gcjLng: 122.357507 },
  { name: 'Sanya Bay', lat: 18.24, lng: 109.5, gcjLat: 18.238335, gcjLng: 109.504118 },
] as const;

/** Great-circle distance in metres (haversine, mean Earth radius 6371 km). */
function metresBetween(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const rad = Math.PI / 180;
  const dLat = (bLat - aLat) * rad;
  const dLng = (bLng - aLng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(aLat * rad) * Math.cos(bLat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.sqrt(h));
}

describe('wgs2gcj', () => {
  it('reproduces the official-endpoint-validated snapshot (1e-6 deg tolerance)', () => {
    for (const f of WGS84_FIXTURES) {
      const gcj = wgs2gcj(wgs84LngLat(f.lat, f.lng));
      expect(gcj.lat, f.name).toBeCloseTo(f.gcjLat, 6);
      expect(gcj.lng, f.name).toBeCloseTo(f.gcjLng, 6);
    }
  });

  it('shifts points in the documented directions', () => {
    // A sign-flipped or axis-swapped offset fails the snapshot above; these
    // assertions keep the failure readable when it happens.
    const tiananmen = wgs2gcj(wgs84LngLat(39.9087, 116.3912));
    expect(tiananmen.lat).toBeGreaterThan(39.9087);
    expect(tiananmen.lng).toBeGreaterThan(116.3912);

    const bund = wgs2gcj(wgs84LngLat(31.2393, 121.4905));
    expect(bund.lat).toBeLessThan(31.2393);
    expect(bund.lng).toBeGreaterThan(121.4905);

    const sanya = wgs2gcj(wgs84LngLat(18.24, 109.5));
    expect(sanya.lat).toBeLessThan(18.24);
    expect(sanya.lng).toBeGreaterThan(109.5);
  });
});

describe('gcj2wgs', () => {
  it('closes the round trip to < 1e-4 m', () => {
    // The six snapshot fixtures plus three more spread across the mainland.
    const points: ReadonlyArray<readonly [lat: number, lng: number]> = [
      ...WGS84_FIXTURES.map((f) => [f.lat, f.lng] as const),
      [45.8038, 126.535], // Harbin
      [34.3416, 108.9398], // Xi'an
      [43.8256, 87.6168], // Ürümqi
    ];
    for (const [lat, lng] of points) {
      const roundTrip = gcj2wgs(wgs2gcj(wgs84LngLat(lat, lng)));
      // Measured worst case is ~2.5e-5 m; 1e-4 m is the guard rail.
      expect(metresBetween(lat, lng, roundTrip.lat, roundTrip.lng)).toBeLessThan(1e-4);
    }
  });

  it('returns coordinates outside China strictly unchanged (inverse)', () => {
    const tokyo = gcj2wgs(gcj02LngLat(35.6586, 139.7454));
    expect(tokyo.lat).toBe(35.6586);
    expect(tokyo.lng).toBe(139.7454);

    const paris = gcj2wgs(gcj02LngLat(48.8584, 2.2945));
    expect(paris.lat).toBe(48.8584);
    expect(paris.lng).toBe(2.2945);
  });
});

describe('out-of-China identity', () => {
  it('leaves foreign coordinates strictly unchanged in both directions', () => {
    // Strict equality on purpose, not a tolerance: the bounding-box
    // short-circuit must return the exact input values.
    const tokyoWgs = wgs84LngLat(35.6586, 139.7454);
    const tokyoGcj = wgs2gcj(tokyoWgs);
    expect(tokyoGcj.lat).toBe(35.6586);
    expect(tokyoGcj.lng).toBe(139.7454);
    expect(metresBetween(35.6586, 139.7454, tokyoGcj.lat, tokyoGcj.lng)).toBe(0);

    const parisWgs = wgs84LngLat(48.8584, 2.2945);
    const parisGcj = wgs2gcj(parisWgs);
    expect(parisGcj.lat).toBe(48.8584);
    expect(parisGcj.lng).toBe(2.2945);
    expect(metresBetween(48.8584, 2.2945, parisGcj.lat, parisGcj.lng)).toBe(0);
  });
});

describe('outOfChina', () => {
  it('is false inside the bounding box, edges included', () => {
    expect(outOfChina({ lat: 39.9087, lng: 116.3912 })).toBe(false);
    expect(outOfChina({ lat: 3.86, lng: 73.66 })).toBe(false);
    expect(outOfChina({ lat: 53.55, lng: 135.05 })).toBe(false);
  });

  it('is true outside the bounding box', () => {
    expect(outOfChina({ lat: 35.6586, lng: 139.7454 })).toBe(true); // Tokyo
    expect(outOfChina({ lat: 48.8584, lng: 2.2945 })).toBe(true); // Paris
    expect(outOfChina({ lat: 3.85, lng: 116 })).toBe(true); // just south
    expect(outOfChina({ lat: 53.56, lng: 116 })).toBe(true); // just north
    expect(outOfChina({ lat: 30, lng: 73.65 })).toBe(true); // just west
    expect(outOfChina({ lat: 30, lng: 135.06 })).toBe(true); // just east
  });

  it('accepts branded coordinates from either side', () => {
    expect(outOfChina(wgs84LngLat(39.9087, 116.3912))).toBe(false);
    expect(outOfChina(gcj02LngLat(31.2373137, 121.4949662))).toBe(false);
  });
});

describe('coordinate brands', () => {
  it('brand a plain lat/lng pair', () => {
    expect(wgs84LngLat(39.9087, 116.3912)).toMatchObject({ lat: 39.9087, lng: 116.3912 });
    expect(gcj02LngLat(31.2373137, 121.4949662)).toMatchObject({
      lat: 31.2373137,
      lng: 121.4949662,
    });
  });

  it('keep WGS84 and GCJ-02 non-interchangeable at the type level', () => {
    // Enforced by tsc at CI time (expectTypeOf is a no-op at runtime): if
    // these types ever become assignable to each other, the direction-confusion
    // bug class this layer exists to prevent is back.
    expectTypeOf<Wgs84LngLat>().not.toExtend<Gcj02LngLat>();
    expectTypeOf<Gcj02LngLat>().not.toExtend<Wgs84LngLat>();

    expectTypeOf<Parameters<typeof wgs2gcj>[0]>().toEqualTypeOf<Wgs84LngLat>();
    expectTypeOf<ReturnType<typeof wgs2gcj>>().toEqualTypeOf<Gcj02LngLat>();
    expectTypeOf<Parameters<typeof gcj2wgs>[0]>().toEqualTypeOf<Gcj02LngLat>();
    expectTypeOf<ReturnType<typeof gcj2wgs>>().toEqualTypeOf<Wgs84LngLat>();
  });
});
