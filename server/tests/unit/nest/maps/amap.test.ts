/**
 * Unit tests for the AMap Web Service provider — AMAP-P-001… — and the
 * `/_AMapService` security-code proxy middleware — AMAP-PROXY-001….
 *
 * fetch is stubbed (vi.stubGlobal); NO test calls the real AMap API.
 *
 * The load-bearing assertions are the coordinate ones: AMap answers in GCJ-02,
 * the provider must hand back WGS84 (docs/amap/00-constraints.md 坐标铁律).
 * The expected WGS84 values are the official-endpoint-validated pairs from
 * docs/amap/01-coordinate-layer.md (Tiananmen GCJ-02 116.3974413,39.9101013 ↔
 * WGS84 116.3912,39.9087) — independent ground truth, not the implementation's
 * own echo.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createAmapProxyMiddleware } from '../../../../src/nest/maps/amap-proxy.middleware';
import { amapProvider } from '../../../../src/nest/maps/providers/amap/amap.provider';
import { RateLimitService } from '../../../../src/nest/common/rate-limit.service';

// Tiananmen: GCJ-02 (116.3974413, 39.9101013) ↔ WGS84 (116.3912, 39.9087).
const GCJ = { lng: 116.3974413, lat: 39.9101013 };
const WGS = { lat: 39.9087, lng: 116.3912 };

const KEY = 'test-amap-web-key';

function amapEnvelope(payload: Record<string, unknown>) {
  return { ok: true, status: 200, json: async () => ({ status: '1', info: 'OK', ...payload }) };
}

function mockFetch(handler: (url: URL) => unknown) {
  const fetchMock = vi.fn(async (input: URL | string | Request) => {
    const url = input instanceof URL ? input : new URL(String(input));
    return handler(url) as Response;
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

beforeEach(() => {
  vi.unstubAllGlobals();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ── provider ────────────────────────────────────────────────────────────────

describe('AmapProvider.search', () => {
  it('AMAP-P-001: returns places in WGS84 and labels them source amap', async () => {
    const fetchMock = mockFetch(() =>
      amapEnvelope({
        pois: [{ id: 'B0FFH1NP1X', name: '天安门', type: '风景名胜', typecode: '110203', address: '北京市东城区', location: `${GCJ.lng},${GCJ.lat}` }],
      }),
    );
    const { places } = await amapProvider.search({ key: KEY, query: '天安门' });
    expect(places.length).toBe(1);
    const place = places[0] as Record<string, unknown>;
    expect(place.source).toBe('amap');
    expect(place.amap_id).toBe('amap:B0FFH1NP1X');
    // The GCJ-02 input coordinate must come back as WGS84 — THE regression test.
    expect(place.lng).toBeCloseTo(WGS.lng, 6);
    expect(place.lat).toBeCloseTo(WGS.lat, 6);
    expect(place.lng).not.toBeCloseTo(GCJ.lng, 4);
    // key rides on the upstream URL only
    const url = fetchMock.mock.calls[0][0] as URL;
    expect(url.searchParams.get('key')).toBe(KEY);
    expect(url.pathname).toBe('/v3/place/text');
    expect(url.searchParams.get('keywords')).toBe('天安门');
  });

  it('AMAP-P-002: converts a WGS84 locationBias to GCJ-02 for the request', async () => {
    const fetchMock = mockFetch(() => amapEnvelope({ pois: [] }));
    await amapProvider.search({
      key: KEY,
      query: '咖啡',
      locationBias: { lat: WGS.lat, lng: WGS.lng, radius: 5000 },
    });
    const url = fetchMock.mock.calls[0][0] as URL;
    const location = (url.searchParams.get('location') || '').split(',').map(Number);
    // The bias went out as GCJ-02 (shifted), not as the raw WGS84 input.
    expect(location[0]).toBeCloseTo(GCJ.lng, 6);
    expect(location[1]).toBeCloseTo(GCJ.lat, 6);
    expect(location[0]).not.toBeCloseTo(WGS.lng, 4);
    // Explicit radius rides through.
    expect(url.searchParams.get('radius')).toBe('5000');
  });

  it('AMAP-P-002b: a bias without radius defaults to 50 km', async () => {
    const fetchMock = mockFetch(() => amapEnvelope({ pois: [] }));
    await amapProvider.search({ key: KEY, query: '咖啡', locationBias: { lat: WGS.lat, lng: WGS.lng } });
    const url = fetchMock.mock.calls[0][0] as URL;
    expect(url.searchParams.get('radius')).toBe('50000');
  });

  it('AMAP-P-003: a body-level rejection (status 0) throws a 502 with the info text', async () => {
    mockFetch(() => ({ ok: true, status: 200, json: async () => ({ status: '0', info: 'INVALID_PARAMS', infocode: '10001' }) }));
    await expect(amapProvider.search({ key: KEY, query: 'x' })).rejects.toMatchObject({ status: 502, message: expect.stringContaining('INVALID_PARAMS') });
  });
});

describe('AmapProvider.autocomplete', () => {
  it('AMAP-P-004: maps tips to the suggestion contract with amap place ids', async () => {
    mockFetch(() =>
      amapEnvelope({
        tips: [
          { id: 'B0FFH1NP1X', name: '天安门广场', district: '北京市东城区', address: [], location: `${GCJ.lng},${GCJ.lat}` },
          { name: '某地址提示', district: '北京市', address: '西长安街' },
        ],
      }),
    );
    const { suggestions, source } = await amapProvider.autocomplete({ key: KEY, input: '天安' });
    expect(source).toBeUndefined(); // the service adds the envelope's source field
    expect(suggestions.length).toBe(2);
    expect(suggestions[0]).toEqual({
      placeId: 'amap:B0FFH1NP1X',
      mainText: '天安门广场',
      secondaryText: '北京市东城区',
    });
    // An id-less tip keeps a string placeId (the empty-array address normalized).
    expect(suggestions[1].placeId.startsWith('amap:tip:')).toBe(true);
  });
});

describe('AmapProvider.details', () => {
  it('AMAP-P-005: strips the amap: prefix and returns the detail record in WGS84', async () => {
    const fetchMock = mockFetch(() =>
      amapEnvelope({
        pois: [{
          id: 'B0FFH1NP1X',
          name: '天安门',
          type: '风景名胜;风景名胜',
          typecode: '110203',
          address: '北京市东城区长安街',
          location: `${GCJ.lng},${GCJ.lat}`,
          tel: '010-12345678',
        }],
      }),
    );
    const place = await amapProvider.details({ key: KEY, placeId: 'amap:B0FFH1NP1X' });
    const url = fetchMock.mock.calls[0][0] as URL;
    expect(url.pathname).toBe('/v3/place/detail');
    expect(url.searchParams.get('id')).toBe('B0FFH1NP1X');
    expect(place).not.toBeNull();
    expect((place as Record<string, unknown>).lat).toBeCloseTo(WGS.lat, 6);
    expect((place as Record<string, unknown>).lng).toBeCloseTo(WGS.lng, 6);
  });

  it('AMAP-P-006: a detail miss returns null (the service treats it as an empty result)', async () => {
    mockFetch(() => amapEnvelope({ pois: [] }));
    expect(await amapProvider.details({ key: KEY, placeId: 'amap:NOPE' })).toBeNull();
  });

  it('AMAP-ID-001: search rows expose the poiid in the osm_id slot the client round-trips (docs/amap/06)', async () => {
    mockFetch(() =>
      amapEnvelope({ pois: [{ id: 'B0FFH1NP1X', name: '天安门', location: `${GCJ.lng},${GCJ.lat}` }] }),
    );
    const { places } = await amapProvider.search({ key: KEY, query: '天安门' });
    // The pick handlers read google_place_id || osm_id — without this slot the
    // id is lost the moment a result is picked, and every downstream photo /
    // details request degenerates to bare coordinates.
    expect((places[0] as Record<string, unknown>).osm_id).toBe('amap:B0FFH1NP1X');
  });
});

describe('AmapProvider.photos', () => {
  it('AMAP-PHOTO-001: queries place/detail with extensions=all and normalizes the candidates', async () => {
    const fetchMock = mockFetch(() =>
      amapEnvelope({
        pois: [
          {
            id: 'B000A8UIN8',
            photos: [
              // The exact shapes the live API returns (docs/amap/06): a set
              // title, a title as an EMPTY ARRAY, an http url, a non-http url,
              // and an empty-array url.
              { title: '春季', provider: [], url: 'http://store.is.autonavi.com/showpic/2f96' },
              { title: [], provider: [], url: 'https://store.is.autonavi.com/showpic/ecaa' },
              { title: [], provider: [], url: 'ftp://store.is.autonavi.com/showpic/ce04' },
              { title: 'x', url: [] },
            ],
          },
        ],
      }),
    );
    const photos = await amapProvider.photos({ key: KEY, placeId: 'amap:B000A8UIN8' });
    const url = fetchMock.mock.calls[0][0] as URL;
    expect(url.pathname).toBe('/v3/place/detail');
    expect(url.searchParams.get('id')).toBe('B000A8UIN8');
    // The default `base` payload never carries photos — this channel only
    // exists with extensions=all.
    expect(url.searchParams.get('extensions')).toBe('all');
    expect(photos).toEqual([
      // http is rewritten to https (verified working on the image host)…
      { title: '春季', url: 'https://store.is.autonavi.com/showpic/2f96' },
      // …an empty-array title normalizes to null…
      { title: null, url: 'https://store.is.autonavi.com/showpic/ecaa' },
      // …and the ftp / empty-url entries are dropped.
    ]);
  });

  it('AMAP-PHOTO-002: an id-less row (amap:unknown) short-circuits without a call', async () => {
    const fetchMock = mockFetch(() => amapEnvelope({ pois: [] }));
    expect(await amapProvider.photos({ key: KEY, placeId: 'amap:unknown' })).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('AMAP-PHOTO-003: a poi without photos returns an empty list', async () => {
    mockFetch(() => amapEnvelope({ pois: [{ id: 'B001' }] }));
    expect(await amapProvider.photos({ key: KEY, placeId: 'amap:B001' })).toEqual([]);
  });

  it('AMAP-PHOTO-004: a body-level rejection throws the shared 502 shape', async () => {
    mockFetch(() => ({ ok: true, status: 200, json: async () => ({ status: '0', info: 'INVALID_PARAMS' }) }));
    await expect(amapProvider.photos({ key: KEY, placeId: 'amap:B001' })).rejects.toMatchObject({ status: 502 });
  });
});

describe('AmapProvider.reverse', () => {
  it('AMAP-P-007: sends the coordinate as GCJ-02 and returns name/address', async () => {
    const fetchMock = mockFetch(() =>
      amapEnvelope({
        regeocode: {
          formatted_address: '北京市东城区东长安街天安门',
          addressComponent: { neighborhood: { name: '天安门' }, pois: [{ name: '天安门城楼' }] },
        },
      }),
    );
    const result = await amapProvider.reverse({ key: KEY, lat: WGS.lat, lng: WGS.lng });
    const url = fetchMock.mock.calls[0][0] as URL;
    const location = (url.searchParams.get('location') || '').split(',').map(Number);
    // The WGS84 input went out as GCJ-02.
    expect(location[0]).toBeCloseTo(GCJ.lng, 6);
    expect(location[1]).toBeCloseTo(GCJ.lat, 6);
    expect(result.name).toBe('天安门');
    expect(result.address).toBe('北京市东城区东长安街天安门');
  });
});

describe('AmapProvider.pois', () => {
  const bbox = { south: 39.9, west: 116.39, north: 39.92, east: 116.41 };

  it('AMAP-P-008: around-search converts the bbox centre to GCJ-02 and the rows to WGS84', async () => {
    const fetchMock = mockFetch(() =>
      amapEnvelope({
        pois: [{ id: 'B001', name: '全聚德烤鸭店', typecode: '050300', address: '前门大街30号', location: `${GCJ.lng},${GCJ.lat}` }],
      }),
    );
    const result = await amapProvider.pois({ key: KEY, category: 'restaurant', bbox });
    const url = fetchMock.mock.calls[0][0] as URL;
    expect(url.pathname).toBe('/v3/place/around');
    // Restaurant maps to the 餐饮服务 branch.
    expect(url.searchParams.get('types')).toBe('050000');
    expect(url.searchParams.get('radius')).toBeTruthy();
    const location = (url.searchParams.get('location') || '').split(',').map(Number);
    // The bbox centre (39.91, 116.40) went out as its GCJ-02 form
    // (116.4062441, 39.9114040) — computed independently from the public offset.
    expect(location[0]).toBeCloseTo(116.4062441, 6);
    expect(location[1]).toBeCloseTo(39.911404, 6);
    expect(location[0]).not.toBeCloseTo(116.4, 4); // …not the raw WGS84 centre

    expect(result.source).toBe('amap');
    expect(result.pois.length).toBe(1);
    expect(result.pois[0].lat).toBeCloseTo(WGS.lat, 6);
    expect(result.pois[0].lng).toBeCloseTo(WGS.lng, 6);
    expect(result.pois[0].osm_id).toBe('amap:B001'); // field name is contract parity
    expect(result.pois[0].source).toBe('amap');
  });

  it('AMAP-P-009: an unknown category is a client error, before any network call', async () => {
    const fetchMock = mockFetch(() => amapEnvelope({ pois: [] }));
    await expect(amapProvider.pois({ key: KEY, category: 'nonexistent', bbox })).rejects.toMatchObject({ status: 400 });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('AmapProvider — branch coverage (error/edge paths)', () => {
  it('AMAP-P-010: a non-ok HTTP status propagates as the upstream status', async () => {
    mockFetch(() => ({ ok: false, status: 401, json: async () => ({}) }));
    await expect(amapProvider.search({ key: KEY, query: 'x' })).rejects.toMatchObject({
      status: 401,
      message: expect.stringContaining('401'),
    });
  });

  it('AMAP-P-011: POIs without a usable location are skipped, not emitted broken', async () => {
    mockFetch(() =>
      amapEnvelope({
        pois: [
          { id: 'B1', name: '无坐标店', location: '' },
          { id: 'B2', name: '正常店', location: `${GCJ.lng},${GCJ.lat}` },
        ],
      }),
    );
    const result = await amapProvider.pois({ key: KEY, category: 'restaurant', bbox: { south: 39.9, west: 116.39, north: 39.92, east: 116.41 } });
    expect(result.pois.length).toBe(1);
    expect(result.pois[0].name).toBe('正常店');
  });

  it('AMAP-P-012: array-valued address/tel/rating normalize to null, missing location to null coords', async () => {
    mockFetch(() =>
      amapEnvelope({
        pois: [
          { id: 'B3', name: '怪数据店', address: [], tel: [], biz_ext: { rating: [] }, location: [] },
          { id: 'B4', name: '天安门', location: `${GCJ.lng},${GCJ.lat}` },
        ],
      }),
    );
    const { places } = await amapProvider.search({ key: KEY, query: 'x' });
    const weird = places[0] as Record<string, unknown>;
    expect(weird.address).toBe('');
    expect(weird.phone).toBeNull();
    expect(weird.rating).toBeNull();
    expect(weird.lat).toBeNull();
    expect(weird.lng).toBeNull();

    const result = await amapProvider.pois({ key: KEY, category: 'hotel', bbox: { south: 39.9, west: 116.39, north: 39.92, east: 116.41 } });
    // The location-less row is dropped (would render broken), the good one stays.
    expect(result.pois.length).toBe(1);
    expect(result.pois[0].name).toBe('天安门');
  });

  it('AMAP-P-013: autocomplete drops tips with no name', async () => {
    mockFetch(() => amapEnvelope({ tips: [{ id: 'B5', name: '', district: '北京市' }, { id: 'B6', name: '有用提示' }] }));
    const { suggestions } = await amapProvider.autocomplete({ key: KEY, input: 'x' });
    expect(suggestions.length).toBe(1);
    expect(suggestions[0].mainText).toBe('有用提示');
  });

  it('AMAP-P-014: reverse returns nulls when regeocode is missing', async () => {
    mockFetch(() => amapEnvelope({}));
    expect(await amapProvider.reverse({ key: KEY, lat: WGS.lat, lng: WGS.lng })).toEqual({ name: null, address: null });
  });

  it('AMAP-P-014b: a blank-string address/tel normalizes to empty/null on search records', async () => {
    mockFetch(() =>
      amapEnvelope({
        pois: [{
          id: 'B30', name: '空白字段店', typecode: '050100',
          location: `${GCJ.lng},${GCJ.lat}`,
          address: '   ',
          tel: '   ',
          website: '',
        }],
      }),
    );
    const { places } = await amapProvider.search({ key: KEY, query: 'x' });
    expect(places[0].address).toBe('');
    expect(places[0].phone).toBeNull();
    expect(places[0].website).toBeNull();
  });
})

describe('AmapProvider — defensive location parsing', () => {
  it('AMAP-P-021: accepts object-form locations (v3 sometimes sends them)', async () => {
    mockFetch(() =>
      amapEnvelope({
        pois: [{ id: 'B20', name: '对象坐标店', location: { lng: GCJ.lng, lat: GCJ.lat } }],
      }),
    );
    const { places } = await amapProvider.search({ key: KEY, query: 'x' });
    expect(places[0].lng).toBeCloseTo(WGS.lng, 6);
    expect(places[0].lat).toBeCloseTo(WGS.lat, 6);
  });

  it('AMAP-P-022: object locations with non-numeric parts yield no coordinate', async () => {
    mockFetch(() =>
      amapEnvelope({
        pois: [
          { id: 'B21', name: '坏坐标店', location: { lng: Number.NaN, lat: 10 } },
          { id: 'B22', name: '好店', location: `${GCJ.lng},${GCJ.lat}` },
        ],
      }),
    );
    const result = await amapProvider.pois({ key: KEY, category: 'restaurant', bbox: { south: 39.9, west: 116.39, north: 39.92, east: 116.41 } });
    expect(result.pois.length).toBe(1);
    expect(result.pois[0].name).toBe('好店');
  });

  it('AMAP-P-023: reverse name falls through aois then pois when neighborhood/building absent', async () => {
    mockFetch(() =>
      amapEnvelope({
        regeocode: {
          formatted_address: '某地',
          addressComponent: { aois: [{ name: '某景区' }], pois: [{ name: '某店' }] },
        },
      }),
    );
    expect((await amapProvider.reverse({ key: KEY, lat: WGS.lat, lng: WGS.lng })).name).toBe('某景区');

    mockFetch(() =>
      amapEnvelope({
        regeocode: {
          formatted_address: '某地',
          addressComponent: { pois: [{ name: '某店' }] },
        },
      }),
    );
    expect((await amapProvider.reverse({ key: KEY, lat: WGS.lat, lng: WGS.lng })).name).toBe('某店');
  });
})

describe('amap-proxy middleware — branch coverage', () => {
  it('AMAP-PROXY-006: upstream HTTP failure keeps the upstream status and content type', async () => {
    const fetchMock = vi.fn(async () => ({ ok: false, status: 429, headers: new Map([['content-type', 'application/json;charset=UTF-8']]), text: async () => '{"status":"0"}' } as unknown as Response));
    const middleware = createAmapProxyMiddleware({
      resolveSecurityCode: () => 'jscode',
      fetchImpl: fetchMock as unknown as typeof fetch,
      now: () => 1_000_000,
    });
    const res = fakeRes();
    await middleware(fakeReq(), res as unknown as Response, vi.fn());
    expect(res.statusCode).toBe(429);
    expect(res.headers['Content-Type']).toContain('application/json');
    expect(res.body).toContain('status');
  });

  it('AMAP-PROXY-007: an array query value forwards its last entry', async () => {
    const fetchMock = vi.fn(async (input: URL | string) => {
      const url = new URL(String(input));
      return { ok: true, status: 200, headers: new Map(), text: async () => url.searchParams.get('ignored') ?? '' } as unknown as Response;
    });
    const middleware = createAmapProxyMiddleware({
      resolveSecurityCode: () => 'jscode',
      fetchImpl: fetchMock as unknown as typeof fetch,
      now: () => 1_000_000,
    });
    const req = fakeReq({ query: { location: 'first', ignored: '116.4,39.9' } }) as unknown as Request;
    const res = fakeRes();
    await middleware(req, res as unknown as Response, vi.fn());
    expect(res.statusCode).toBe(200);
    expect(res.body).toBe('116.4,39.9');
  });

  it('AMAP-PROXY-008: an upstream timeout answers 504, a headers-sent abort ends quietly', async () => {
    const timeoutErr = Object.assign(new Error('timed out'), { name: 'TimeoutError' });
    const middleware = createAmapProxyMiddleware({
      resolveSecurityCode: () => 'jscode',
      fetchImpl: vi.fn(async () => { throw timeoutErr; }) as unknown as typeof fetch,
      now: () => 1_000_000,
    });
    const res = fakeRes();
    await middleware(fakeReq(), res as unknown as Response, vi.fn());
    expect(res.statusCode).toBe(504);

    // A mid-stream abort after headers are sent must not throw a second
    // response into Express — the middleware ends quietly instead.
    const middlewareAbort = createAmapProxyMiddleware({
      resolveSecurityCode: () => 'jscode',
      fetchImpl: vi.fn(async () => { throw new Error('stream aborted'); }) as unknown as typeof fetch,
      now: () => 1_000_000,
    });
    const res2 = fakeRes() as FakeRes & { headersSent: boolean };
    res2.headersSent = true;
    await middlewareAbort(fakeReq(), res2 as unknown as Response, vi.fn());
    expect(res2.ended).toBe(true);
  });

  it('AMAP-PROXY-009: unexpected middleware errors go to next() for the error filter', async () => {
    const next = vi.fn();
    const middleware = createAmapProxyMiddleware({
      resolveSecurityCode: () => 'jscode',
      fetchImpl: vi.fn(async () => { throw new Error('socket exploded'); }) as unknown as typeof fetch,
      now: () => 1_000_000,
    });
    const res = fakeRes();
    await middleware(fakeReq(), res as unknown as Response, next);
    expect(next).toHaveBeenCalledTimes(1);
  });
})

interface FakeRes {
  statusCode: number
  body: unknown
  headers: Record<string, string>
  ended: boolean
  status(code: number): FakeRes
  set(k: string, v: string): FakeRes
  json(b: unknown): FakeRes
  send(b: string): FakeRes
  end(): FakeRes
}

function fakeRes(): FakeRes {
  const res: FakeRes = {
    statusCode: 200,
    body: undefined,
    headers: {},
    ended: false,
    status(code) { res.statusCode = code; return res; },
    set(k, v) { res.headers[k] = v; return res; },
    json(b) { res.body = b; return res; },
    send(b) { res.body = b; return res; },
    end() { res.ended = true; return res; },
  };
  return res;
}

function fakeReq(overrides: { method?: string; path?: string; query?: Record<string, string>; ip?: string } = {}) {
  return {
    method: overrides.method ?? 'GET',
    path: overrides.path ?? '/v3/place/text',
    query: overrides.query ?? { keywords: '天安门', location: '116.397,39.910' },
    ip: overrides.ip ?? '203.0.113.7',
    socket: { remoteAddress: overrides.ip ?? '203.0.113.7' },
  } as unknown as Request;
}

describe('AmapProvider — remaining branch arms', () => {
  it('AMAP-P-015: details accepts a raw id without the amap: prefix', async () => {
    const fetchMock = mockFetch(() => amapEnvelope({ pois: [{ id: 'B0FFH1NP1X', name: '天安门', location: `${GCJ.lng},${GCJ.lat}` }] }));
    const place = await amapProvider.details({ key: KEY, placeId: 'B0FFH1NP1X' });
    const url = fetchMock.mock.calls[0][0] as URL;
    expect(url.searchParams.get('id')).toBe('B0FFH1NP1X');
    expect(place).not.toBeNull();
  });

  it('AMAP-P-016: autocomplete converts a rectangle bias to its GCJ-02 centre', async () => {
    const fetchMock = mockFetch(() => amapEnvelope({ tips: [] }));
    await amapProvider.autocomplete({
      key: KEY,
      input: 'x',
      locationBias: { low: { lat: 39.9, lng: 116.39 }, high: { lat: 39.92, lng: 116.41 } },
    });
    const url = fetchMock.mock.calls[0][0] as URL;
    const location = (url.searchParams.get('location') || '').split(',').map(Number);
    // centre (39.91, 116.40) → GCJ-02, computed independently from the offset.
    expect(location[0]).toBeCloseTo(116.4062441, 6);
    expect(location[1]).toBeCloseTo(39.911404, 6);
  });

  it('AMAP-P-017: search records carry numeric ratings and websites when AMap provides them', async () => {
    // place/around rows deliberately omit rating (Overpass-row parity); the
    // search/text record is where biz_ext.rating surfaces.
    mockFetch(() =>
      amapEnvelope({
        pois: [{
          id: 'B9', name: '四季民福', type: '中餐厅;北京菜', typecode: '050100',
          address: '北京市东城区',
          location: `${GCJ.lng},${GCJ.lat}`,
          tel: '010-11112222',
          biz_ext: { rating: '4.8' },
          website: 'https://example.com',
        }],
      }),
    );
    const { places } = await amapProvider.search({ key: KEY, query: '四季民福' });
    expect(places[0].rating).toBeCloseTo(4.8, 5);
    expect(places[0].website).toBe('https://example.com');
    expect(places[0].phone).toBe('010-11112222');
    expect((places[0].types as string[]).length).toBeGreaterThan(0);
  });

  it('AMAP-P-018: an oversized bbox caps the around radius and reports clamped', async () => {
    const fetchMock = mockFetch(() => amapEnvelope({ pois: [] }));
    const result = await amapProvider.pois({
      key: KEY, category: 'hotel',
      bbox: { south: 30, west: 110, north: 45, east: 130 },
    });
    const url = fetchMock.mock.calls[0][0] as URL;
    expect(Number(url.searchParams.get('radius'))).toBeLessThanOrEqual(50000);
    expect(result.clamped).toBe(true);
  });

  it('AMAP-P-019: unnamed POIs are dropped from around results', async () => {
    mockFetch(() =>
      amapEnvelope({
        pois: [
          { id: 'B10', name: '', location: `${GCJ.lng},${GCJ.lat}` },
          { id: 'B11', name: '有名店', location: `${GCJ.lng},${GCJ.lat}` },
        ],
      }),
    );
    const result = await amapProvider.pois({ key: KEY, category: 'cafe', bbox: { south: 39.9, west: 116.39, north: 39.92, east: 116.41 } });
    expect(result.pois.length).toBe(1);
    expect(result.pois[0].name).toBe('有名店');
  });

  it('AMAP-P-020: reverse name falls through the component chain', async () => {
    mockFetch(() =>
      amapEnvelope({
        regeocode: {
          formatted_address: '某地',
          addressComponent: { building: { name: '某大厦' }, aois: [{ name: '某景区' }], pois: [{ name: '某店' }] },
        },
      }),
    );
    const result = await amapProvider.reverse({ key: KEY, lat: WGS.lat, lng: WGS.lng });
    expect(result.name).toBe('某大厦');
  });
})

describe('amap-proxy middleware — global limit arm', () => {
  it('AMAP-PROXY-010: the global bucket trips when many distinct IPs hammer the proxy', async () => {
    const middleware = createAmapProxyMiddleware({
      resolveSecurityCode: () => 'jscode',
      fetchImpl: vi.fn(async () => ({ ok: true, status: 200, headers: new Map(), text: async () => '{}' }) as unknown as Response),
      now: () => 1_000_000,
    });
    let last = 200;
    for (let i = 0; i < 1201; i++) {
      const res = fakeRes();
      await middleware(fakeReq({ ip: `10.0.0.${i % 256}.${Math.floor(i / 256) % 256}` }), res as unknown as Response, vi.fn());
      last = res.statusCode;
    }
    expect(last).toBe(429);
  });

  it('AMAP-PROXY-011: an array query value forwards its last entry', async () => {
    const fetchMock = vi.fn(async (input: URL | string) => {
      const url = new URL(String(input));
      return { ok: true, status: 200, headers: new Map(), text: async () => url.searchParams.get('ignored') ?? '' } as unknown as Response;
    });
    const middleware = createAmapProxyMiddleware({
      resolveSecurityCode: () => 'jscode',
      fetchImpl: fetchMock as unknown as typeof fetch,
      now: () => 1_000_000,
    });
    const req = fakeReq({ query: { ignored: '116.4,39.9' } }) as unknown as Request & { query: Record<string, unknown> };
    (req as { query: Record<string, unknown> }).query = { ignored: ['bad', '116.4,39.9'] };
    const res = fakeRes();
    await middleware(req, res as unknown as Response, vi.fn());
    expect(res.body).toBe('116.4,39.9');
  });
})

describe('amap-proxy middleware', () => {
  function makeMiddleware(handler: (url: URL) => unknown, opts: { securityCode?: string | null } = {}) {
    const fetchMock = vi.fn(async (input: URL | string) => {
      const body = JSON.stringify(handler(new URL(String(input))));
      return { ok: true, status: 200, headers: new Map([['content-type', 'application/json']]), text: async () => body } as Response;
    });
    const limiter = new RateLimitService();
    const middleware = createAmapProxyMiddleware({
      resolveSecurityCode: () => (opts.securityCode === undefined ? 'test-jscode' : opts.securityCode),
      rateLimiter: limiter,
      fetchImpl: fetchMock as unknown as typeof fetch,
      now: () => 1_000_000,
    });
    return { middleware, fetchMock, limiter };
  }

  it('AMAP-PROXY-001: forwards an allowed GET to restapi.amap.com with the jscode appended', async () => {
    const { middleware, fetchMock } = makeMiddleware(() => ({ status: '1', info: 'OK', pois: [] }));
    const res = fakeRes();
    await middleware(fakeReq(), res as unknown as Response, vi.fn());
    expect(res.statusCode).toBe(200);
    const url = fetchMock.mock.calls[0][0] as URL;
    expect(url.origin).toBe('https://restapi.amap.com');
    expect(url.pathname).toBe('/v3/place/text');
    expect(url.searchParams.get('keywords')).toBe('天安门');
    expect(url.searchParams.get('jscode')).toBe('test-jscode');
    expect((res.body as string)).toContain('OK');
  });

  it('AMAP-PROXY-002: disallowed prefixes and non-GET methods 404/405 — not an open proxy', async () => {
    const { middleware } = makeMiddleware(() => ({ status: '1' }));
    const res404 = fakeRes();
    await middleware(fakeReq({ path: '/v4/anything' }), res404 as unknown as Response, vi.fn());
    expect(res404.statusCode).toBe(404);

    const res405 = fakeRes();
    await middleware(fakeReq({ method: 'POST' }), res405 as unknown as Response, vi.fn());
    expect(res405.statusCode).toBe(405);
  });

  it('AMAP-PROXY-003: fails closed with 503 when no security code is configured', async () => {
    const { middleware, fetchMock } = makeMiddleware(() => ({ status: '1' }), { securityCode: null });
    const res = fakeRes();
    await middleware(fakeReq(), res as unknown as Response, vi.fn());
    expect(res.statusCode).toBe(503);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('AMAP-PROXY-004: rate limits per IP with 429 (60/min) and keeps other IPs working', async () => {
    const { middleware } = makeMiddleware(() => ({ status: '1', info: 'OK' }));
    const now = 1_000_000;
    for (let i = 0; i < 60; i++) {
      const res = fakeRes();
      await middleware(fakeReq({ ip: '198.51.100.1' }), res as unknown as Response, vi.fn());
      expect(res.statusCode).toBe(200);
    }
    vi.spyOn(Date, 'now').mockReturnValue(now);
    const blocked = fakeRes();
    await middleware(fakeReq({ ip: '198.51.100.1' }), blocked as unknown as Response, vi.fn());
    expect(blocked.statusCode).toBe(429);
    vi.spyOn(Date, 'now').mockRestore?.();

    const otherIp = fakeRes();
    await middleware(fakeReq({ ip: '198.51.100.2' }), otherIp as unknown as Response, vi.fn());
    expect(otherIp.statusCode).toBe(200);
  });

  it('AMAP-PROXY-005: answers anonymously by design — no session cookie required', async () => {
    // The request carries no cookie at all; the middleware is the whole stack
    // (bare Express, mounted before app.init()), so "it answered" IS the test.
    const { middleware } = makeMiddleware(() => ({ status: '1', info: 'OK' }));
    const req = fakeReq() as unknown as Request & { headers: Record<string, string> };
    req.headers = {};
    const res = fakeRes();
    await middleware(req, res as unknown as Response, vi.fn());
    expect(res.statusCode).toBe(200);
  });
});
