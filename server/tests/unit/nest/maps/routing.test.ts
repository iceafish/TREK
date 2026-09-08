/**
 * Unit tests for the server-side AMap routing service — AMAP-ROUTE-001….
 * (docs/amap/04: the browser's OSRM calls moved behind POST /api/maps/route.)
 *
 * fetch is stubbed (vi.stubGlobal); NO test calls the real AMap API.
 *
 * The coordinate-direction assertions are the load-bearing ones: waypoints
 * arrive WGS84, go out to AMap as GCJ-02, and every point in the response
 * comes back WGS84. Expected values use the official-endpoint-validated
 * Tiananmen pair from docs/amap/01-coordinate-layer.md.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { RoutingService } from '../../../../src/nest/maps/routing.service';

// Tiananmen: WGS84 (39.9087, 116.3912) ↔ GCJ-02 (39.9101013, 39.9101013-lng 116.3974413).
const WGS_A = { lat: 39.9087, lng: 116.3912 };
const GCJ_A = { lng: 116.3974413, lat: 39.9101013 };
const WGS_B = { lat: 39.9163, lng: 116.3972 }; // 故宫 (nearby, converts a touch further)

const DB_OK = { get: vi.fn(() => undefined), run: vi.fn() } as never;

const KEY = 'test-amap-web-key';

function stubFetch(handler: (url: URL) => unknown) {
  // Handlers return the API BODY; a handler may instead return a full
  // Response-shaped object (ok/status/json) to simulate transport failures —
  // the wrapper passes those through untouched.
  const fetchMock = vi.fn(async (input: URL | string | Request) => {
    const url = input instanceof URL ? input : new URL(String(input));
    const body = handler(url);
    if (body !== null && typeof body === 'object' && 'json' in (body as Record<string, unknown>)) {
      return body as unknown as Response;
    }
    return { ok: true, status: 200, json: async () => body } as unknown as Response;
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

/**
 * A driving response whose steps carry two polyline runs: one around point A
 * and one around point B (GCJ-02). The service must decode, concatenate, and
 * convert every vertex.
 */
function drivingEnvelope() {
  return {
    status: '1',
    info: 'OK',
    route: {
      paths: [{
        distance: '1234',
        duration: '300',
        steps: [
          { polyline: `${GCJ_A.lng},${GCJ_A.lat};${GCJ_A.lng + 0.001},${GCJ_A.lat}` },
          { polyline: `${GCJ_A.lng + 0.001},${GCJ_A.lat};116.40344448050773,39.91770375650534` },
        ],
      }],
    },
  };
}

const svc = new RoutingService(DB_OK);

beforeEach(() => {
  vi.unstubAllGlobals();
  // Each test gets its own cache lane so waypoint collisions across tests
  // can't serve a cached route from an earlier case.
  svc.__resetRouteCacheForTests();
  // The routing tests run with a configured provider; ROUTE-011 opts out by
  // stubbing the key to '' (env is the first step of the credential chain).
  vi.stubEnv('AMAP_WEB_SERVICE_KEY', KEY);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('RoutingService.route', () => {
  it('AMAP-ROUTE-001: decodes step polylines and returns WGS84 coordinates', async () => {
    const fetchMock = stubFetch((url) => {
      expect(url.pathname).toBe('/v3/direction/driving');
      return drivingEnvelope();
    });
    expect(fetchMock).toBeTruthy();

    const route = await svc.route([WGS_A, WGS_B], 'driving');
    // 4 decoded vertices — the shared joint is deduplicated.
    expect(route.coordinates.length).toBe(3);
    // First vertex is point A converted back to WGS84.
    expect(route.coordinates[0][0]).toBeCloseTo(WGS_A.lat, 6);
    expect(route.coordinates[0][1]).toBeCloseTo(WGS_A.lng, 6);
    // Last vertex is point B converted back to WGS84.
    const [lastLat, lastLng] = route.coordinates[route.coordinates.length - 1];
    expect(lastLat).toBeCloseTo(WGS_B.lat, 6);
    expect(lastLng).toBeCloseTo(WGS_B.lng, 6);
  });

  it('AMAP-ROUTE-002: the outbound request carries GCJ-02 origin/destination', async () => {
    const fetchMock = stubFetch(() => drivingEnvelope());
    await svc.route([WGS_A, WGS_B], 'driving');
    const url = fetchMock.mock.calls[0][0] as URL;
    expect(url.pathname).toBe('/v3/direction/driving');
    const [originLng, originLat] = (url.searchParams.get('origin') || '').split(',').map(Number);
    expect(originLng).toBeCloseTo(GCJ_A.lng, 6);
    expect(originLat).toBeCloseTo(GCJ_A.lat, 6);
    // The destination is the 故宫 point, shifted as well.
    const [destLng, destLat] = (url.searchParams.get('destination') || '').split(',').map(Number);
    expect(destLng).toBeGreaterThan(WGS_B.lng);
    expect(destLat).not.toBe(WGS_B.lat);
  });

  it('AMAP-ROUTE-003: one leg per waypoint pair, totals summed', async () => {
    stubFetch(() => drivingEnvelope());
    const mid = { lat: (WGS_A.lat + WGS_B.lat) / 2, lng: (WGS_A.lng + WGS_B.lng) / 2 };
    const route = await svc.route([WGS_A, mid, WGS_B], 'driving');
    expect(route.legs.length).toBe(2);
    expect(route.distance).toBeCloseTo(1234 * 2, 5);
    expect(route.duration).toBeCloseTo(600, 5);
  });

  it('AMAP-ROUTE-004: a second identical request is served from the cache (no extra fetch)', async () => {
    const fetchMock = stubFetch(() => drivingEnvelope());
    const wps = [WGS_A, WGS_B];
    await svc.route(wps, 'driving');
    const callsAfterFirst = fetchMock.mock.calls.length;
    await svc.route(wps, 'driving');
    expect(fetchMock.mock.calls.length).toBe(callsAfterFirst);
  });

  it('AMAP-ROUTE-005: walking uses its own endpoint', async () => {
    const fetchMock = stubFetch((url) => {
      expect(url.pathname).toBe('/v3/direction/walking');
      return {
        status: '1',
        route: { paths: [{ distance: '800', duration: '600', steps: [{ polyline: `${GCJ_A.lng},${GCJ_A.lat};116.3972,39.9163` }] }] },
      };
    });
    await svc.route([WGS_A, WGS_B], 'walking');
    expect(fetchMock.mock.calls[0][0].pathname).toBe('/v3/direction/walking');
  });

  it('AMAP-ROUTE-006: cycling uses the v4 envelope and converts ms to seconds', async () => {
    const fetchMock = stubFetch((url) => {
      expect(url.pathname).toBe('/v4/direction/bicycling');
      return {
        errcode: 0,
        data: { paths: [{ distance: 2400, duration: 720000, steps: [{ polyline: `${GCJ_A.lng},${GCJ_A.lat};116.3972,39.9163` }] }] },
      };
    });
    const route = await svc.route([WGS_A, WGS_B], 'cycling');
    expect(fetchMock.mock.calls[0][0].pathname).toBe('/v4/direction/bicycling');
    // v4 reports duration in milliseconds; the service normalizes to seconds.
    expect(route.duration).toBe(720);
  });

  it('AMAP-ROUTE-007: an upstream rejection (over quota / status 0) throws a 502 so callers degrade', async () => {
    stubFetch(() => ({ status: '0', info: 'CUOTAS_EXCEEDED' }));
    await expect(svc.route([WGS_A, WGS_B], 'driving')).rejects.toMatchObject({
      status: 502,
      message: expect.stringContaining('CUOTAS_EXCEEDED'),
    });
  });

  it('AMAP-ROUTE-008: a v4 errcode rejection throws a 502 too', async () => {
    stubFetch(() => ({ errcode: 10044, data: {} }));
    await expect(svc.route([WGS_A, WGS_B], 'cycling')).rejects.toMatchObject({ status: 502 });
  });

  it('AMAP-ROUTE-009: an upstream HTTP failure throws a 502, not the raw status', async () => {
    stubFetch(() => ({ ok: false, status: 500, json: async () => ({}) }));
    await expect(svc.route([WGS_A, WGS_B], 'driving')).rejects.toMatchObject({ status: 502 });
  });

  it('AMAP-ROUTE-010: steps with no usable polyline degrade to the straight from→to pair (WGS84)', async () => {
    stubFetch(() => ({
      status: '1',
      route: { paths: [{ distance: '10', duration: '5', steps: [{ polyline: '' }] }] },
    }));
    const route = await svc.route([WGS_A, WGS_B], 'driving');
    expect(route.coordinates.length).toBe(2);
    expect(route.coordinates[0][0]).toBeCloseTo(WGS_A.lat, 6);
    expect(route.coordinates[1][0]).toBeCloseTo(WGS_B.lat, 6);
  });

  it('AMAP-ROUTE-011: an unconfigured instance throws 503 before any network call', async () => {
    vi.stubEnv('AMAP_WEB_SERVICE_KEY', '');
    await expect(svc.route([WGS_A, WGS_B], 'driving')).rejects.toMatchObject({
      status: 503,
      message: expect.stringContaining('not configured'),
    });
  });
});
