import { describe, it, expect, vi, afterEach } from 'vitest'
import { http, HttpResponse } from 'msw'
import { server } from '../../../tests/helpers/msw/server'
import { pluginsApi, type PluginRouteResult } from '../../api/client'
import { useSettingsStore } from '../../store/settingsStore'
import {
  calculateRoute,
  calculateRouteWithLegs,
  calculateSegments,
  optimizeRoute,
  generateGoogleMapsUrl,
  generateCoMapsUrl,
  parsePluginProfile,
  withHotelBookends,
  type RouteProfileKey,
} from './RouteCalculator'

// Routing goes through THIS site (POST /api/maps/route → server-side AMap,
// docs/amap/04). The public OSRM routers must never see a request again.
const ROUTE_URL = '/api/maps/route'
const OSRM_HOSTS = ['https://router.project-osrm.org', 'https://routing.openstreetmap.de']

const buildServerRoute = (over: { coordinates?: Array<[number, number]>; distance?: number; duration?: number; legCount?: number } = {}) => {
  const distance = over.distance ?? 5000
  const duration = over.duration ?? 360
  const legCount = over.legCount ?? 1
  return {
    route: {
      coordinates: over.coordinates ?? [[48.8566, 2.3522], [48.86, 2.36]],
      distance,
      duration,
      legs: Array.from({ length: legCount }, () => ({ distance: distance / legCount, duration: duration / legCount })),
    },
  }
}

const stubServerRoute = (over: Parameters<typeof buildServerRoute>[0] = {}) =>
  server.use(http.post(ROUTE_URL, () => HttpResponse.json(buildServerRoute(over))))

// Fails the test if any request escapes to a public OSRM router — the exact
// regression the 04 migration exists to prevent.
const forbidOsrm = () => {
  let osrmHits = 0
  for (const host of OSRM_HOSTS) {
    server.use(http.all(`${host}/*`, () => { osrmHits++; return HttpResponse.json({}, { status: 500 }) }))
  }
  return () => osrmHits
}

const wp1 = { lat: 48.8566, lng: 2.3522 }
const wp2 = { lat: 48.8600, lng: 2.3600 }

// ── calculateRoute ─────────────────────────────────────────────────────────────

describe('calculateRoute', () => {
  it('FE-COMP-ROUTECALCULATOR-001: throws when fewer than 2 waypoints', async () => {
    await expect(calculateRoute([wp1])).rejects.toThrow('At least 2 waypoints required')
  })

  it('FE-COMP-ROUTECALCULATOR-002: returns the server route\'s WGS84 coordinates on success', async () => {
    stubServerRoute()
    const result = await calculateRoute([wp1, wp2])
    // The server already converted to [lat,lng] WGS84 — passed through as-is.
    expect(result.coordinates).toEqual([[48.8566, 2.3522], [48.86, 2.36]])
  })

  it('FE-COMP-ROUTECALCULATOR-003: returns formatted distance text for >= 1000 m', async () => {
    stubServerRoute({ distance: 1500 })
    const result = await calculateRoute([wp1, wp2])
    expect(result.distanceText).toBe('1.5 km')
  })

  it('FE-COMP-ROUTECALCULATOR-004: returns formatted distance in meters for short routes', async () => {
    stubServerRoute({ distance: 800 })
    const result = await calculateRoute([wp1, wp2])
    expect(result.distanceText).toBe('800 m')
  })

  it('FE-COMP-ROUTECALCULATOR-005: walking duration is the profile\'s real estimate from the server', async () => {
    // AMap walking gives a real estimate; the old synthetic distance/5km/h math is gone.
    stubServerRoute({ duration: 999 })
    const result = await calculateRoute([wp1, wp2], 'walking')
    expect(result.duration).toBe(999)
  })

  it('FE-COMP-ROUTECALCULATOR-006: throws when the server answers with an error status', async () => {
    server.use(http.post(ROUTE_URL, () => HttpResponse.json({ error: 'upstream' }, { status: 500 })))
    await expect(calculateRoute([wp1, wp2])).rejects.toThrow()
  })

  it('FE-COMP-ROUTECALCULATOR-006b: sends the waypoints and profile in the request body', async () => {
    let body: unknown = null
    server.use(http.post(ROUTE_URL, async ({ request }) => {
      body = await request.json()
      return HttpResponse.json(buildServerRoute())
    }))
    await calculateRoute([wp1, wp2], 'walking')
    expect(body).toEqual({ waypoints: [wp1, wp2], profile: 'walking' })
  })

  it('FE-COMP-ROUTECALCULATOR-008: respects AbortSignal', async () => {
    stubServerRoute()
    const controller = new AbortController()
    controller.abort()
    await expect(calculateRoute([wp1, wp2], 'driving', { signal: controller.signal })).rejects.toThrow()
  })
})

// ── calculateSegments ──────────────────────────────────────────────────────────

describe('calculateSegments', () => {
  it('FE-COMP-ROUTECALCULATOR-009: returns empty array for fewer than 2 waypoints', async () => {
    const result = await calculateSegments([wp1])
    expect(result).toEqual([])
  })

  it('FE-COMP-ROUTECALCULATOR-010: returns segment midpoints and travel times', async () => {
    server.use(
      http.post(ROUTE_URL, () =>
        HttpResponse.json(buildServerRoute({ distance: 1000, duration: 120, legCount: 1 }))
      )
    )
    const result = await calculateSegments([wp1, wp2])
    expect(result).toHaveLength(1)
    const seg = result[0]
    const expectedMid: [number, number] = [
      (wp1.lat + wp2.lat) / 2,
      (wp1.lng + wp2.lng) / 2,
    ]
    expect(seg.mid[0]).toBeCloseTo(expectedMid[0])
    expect(seg.mid[1]).toBeCloseTo(expectedMid[1])
    expect(seg.drivingText).toBe('2 min')
  })
})

// ── optimizeRoute ──────────────────────────────────────────────────────────────

describe('optimizeRoute', () => {
  it('FE-COMP-ROUTECALCULATOR-011: returns input unchanged for 2 or fewer places', () => {
    const places = [wp1, wp2]
    const result = optimizeRoute(places)
    expect(result).toHaveLength(2)
    expect(result).toBe(places)
  })

  it('FE-COMP-ROUTECALCULATOR-012: nearest-neighbor reorders 3 waypoints correctly', () => {
    // Note: filter uses `p.lat && p.lng`, so avoid zero values
    const a = { lat: 1, lng: 1 }
    const b = { lat: 10, lng: 1 }
    const c = { lat: 2, lng: 1 }
    const result = optimizeRoute([a, b, c])
    // Starting from a(1,1), nearest is c(2,1) (dist=1), then b(10,1) (dist=8)
    expect(result[0]).toEqual(a)
    expect(result[1]).toEqual(c)
    expect(result[2]).toEqual(b)
  })

  it('FE-COMP-ROUTECALCULATOR-016: start anchor begins the chain at the anchor-nearest stop', () => {
    const a = { lat: 10, lng: 1 }
    const b = { lat: 2, lng: 1 }
    const c = { lat: 5, lng: 1 }
    // From the accommodation anchor (1,1): nearest is b(2,1), then c(5,1), then a(10,1)
    const result = optimizeRoute([a, b, c], { start: { lat: 1, lng: 1 } })
    expect(result).toEqual([b, c, a])
  })

  it('FE-COMP-ROUTECALCULATOR-017: start + end anchors reorder a shuffled day and keep the end-nearest stop last', () => {
    const a = { lat: 2, lng: 1 }
    const b = { lat: 5, lng: 1 }
    const c = { lat: 8, lng: 1 }
    // Transfer day: start at hotel A (1,1), end at hotel B (9,1). c is nearest B, so it must be last.
    const result = optimizeRoute([c, a, b], { start: { lat: 1, lng: 1 }, end: { lat: 9, lng: 1 } })
    expect(result).toEqual([a, b, c])
  })

  it('FE-COMP-ROUTECALCULATOR-018: an anchor makes even a two-stop day sortable', () => {
    const a = { lat: 10, lng: 1 }
    const b = { lat: 2, lng: 1 }
    // Without anchors two stops are returned unchanged; the start anchor orders them by proximity.
    const result = optimizeRoute([a, b], { start: { lat: 1, lng: 1 } })
    expect(result).toEqual([b, a])
  })

  it('FE-COMP-ROUTECALCULATOR-019: 2-opt untangles a round-trip into a clean loop around the hotel', () => {
    const hotel = { lat: 48.8668, lng: 2.3013 } // Rue Marbeuf
    const stops = [
      { id: 1, lat: 48.8565, lng: 2.3324 },
      { id: 2, lat: 48.8813, lng: 2.3151 },
      { id: 3, lat: 48.8796, lng: 2.308 },
      { id: 4, lat: 48.8723, lng: 2.2926 },
      { id: 5, lat: 48.866, lng: 2.3102 }, // nearest the hotel
    ]
    const d = (a: { lat: number; lng: number }, b: { lat: number; lng: number }) =>
      Math.hypot(a.lat - b.lat, a.lng - b.lng)
    const loop = (order: typeof stops) =>
      d(hotel, order[0]) + order.slice(1).reduce((s, p, i) => s + d(order[i], p), 0) + d(order[order.length - 1], hotel)

    const result = optimizeRoute(stops, { start: hotel, end: hotel })
    // The optimized loop is no longer than the original order…
    expect(loop(result)).toBeLessThanOrEqual(loop(stops) + 1e-9)
    // …and the hotel-adjacent stop sits at one end of the loop, right next to the hotel.
    expect([result[0].id, result[result.length - 1].id]).toContain(5)
  })

  it('FE-COMP-ROUTECALCULATOR-020: an end anchor without a start finishes at the stop nearest it', () => {
    const a = { lat: 2, lng: 1 }
    const b = { lat: 5, lng: 1 }
    const c = { lat: 9, lng: 1 }
    // a is nearest the end anchor, so the route must finish at a rather than start there.
    const result = optimizeRoute([a, b, c], { end: { lat: 1, lng: 1 } })
    expect(result[result.length - 1]).toEqual(a)
  })
})

// ── generateGoogleMapsUrl ──────────────────────────────────────────────────────

describe('generateGoogleMapsUrl', () => {
  it('FE-COMP-ROUTECALCULATOR-013: returns null for empty places', () => {
    expect(generateGoogleMapsUrl([])).toBeNull()
  })

  it('FE-COMP-ROUTECALCULATOR-014: single place returns search URL', () => {
    const result = generateGoogleMapsUrl([{ lat: 48.85, lng: 2.35 }])
    expect(result).toBe('https://www.google.com/maps/search/?api=1&query=48.85,2.35')
  })

  it('FE-COMP-ROUTECALCULATOR-015: multiple places returns directions URL', () => {
    const result = generateGoogleMapsUrl([
      { lat: 48.85, lng: 2.35 },
      { lat: 48.86, lng: 2.36 },
    ])
    expect(result).toMatch(/^https:\/\/www\.google\.com\/maps\/dir\//)
    expect(result).toContain('48.85,2.35')
    expect(result).toContain('48.86,2.36')
  })
})

// ── withHotelBookends (#1275: draw the hotel → first / last → hotel legs) ────────

describe('withHotelBookends', () => {
  const hotel = { lat: 1, lng: 1 }
  const a = { lat: 2, lng: 2 }
  const b = { lat: 3, lng: 3 }
  const evening = { lat: 4, lng: 4 }

  it('FE-COMP-ROUTECALCULATOR-021: leaves runs untouched when there is no hotel', () => {
    const runs = [[a, b]]
    expect(withHotelBookends(runs, a, b, null, null)).toEqual([[a, b]])
  })

  it('FE-COMP-ROUTECALCULATOR-022: prepends hotel→first and appends last→hotel around the runs', () => {
    const runs = [[a, b]]
    expect(withHotelBookends(runs, a, b, hotel, evening)).toEqual([
      [hotel, a],
      [a, b],
      [b, evening],
    ])
  })

  it('FE-COMP-ROUTECALCULATOR-023: a single stop with no runs still draws hotel→stop→hotel', () => {
    expect(withHotelBookends([], a, a, hotel, evening)).toEqual([
      [hotel, a],
      [a, evening],
    ])
  })

  it('FE-COMP-ROUTECALCULATOR-024: a missing first/last waypoint skips that bookend', () => {
    const runs = [[a, b]]
    expect(withHotelBookends(runs, undefined, undefined, hotel, evening)).toEqual([[a, b]])
  })

  it('FE-COMP-ROUTECALCULATOR-025: only the start hotel adds just the opening leg', () => {
    const runs = [[a, b]]
    expect(withHotelBookends(runs, a, b, hotel, null)).toEqual([
      [hotel, a],
      [a, b],
    ])
  })
})

// ── parsePluginProfile ─────────────────────────────────────────────────────────

describe('parsePluginProfile', () => {
  it('FE-COMP-ROUTECALCULATOR-026: splits plugin:<id>/<profile> into its two halves', () => {
    expect(parsePluginProfile('plugin:ev-router/fastest')).toEqual({ pluginId: 'ev-router', profileId: 'fastest' })
  })

  it('FE-COMP-ROUTECALCULATOR-027: a profile id may itself contain slashes', () => {
    expect(parsePluginProfile('plugin:ev-router/eco/winter')).toEqual({ pluginId: 'ev-router', profileId: 'eco/winter' })
  })

  it('FE-COMP-ROUTECALCULATOR-028: a built-in profile is not a plugin profile', () => {
    expect(parsePluginProfile('driving')).toBeNull()
    expect(parsePluginProfile('walking')).toBeNull()
  })

  it('FE-COMP-ROUTECALCULATOR-029: rejects a malformed plugin key', () => {
    expect(parsePluginProfile('plugin:ev-router')).toBeNull()   // no separator
    expect(parsePluginProfile('plugin:/fastest')).toBeNull()    // empty plugin id
    expect(parsePluginProfile('plugin:ev-router/')).toBeNull()  // empty profile id
  })
})

// ── calculateRoute: remaining profiles ─────────────────────────────────────────

describe('calculateRoute profiles', () => {
  it('FE-COMP-ROUTECALCULATOR-030: cycling keeps the profile\'s real duration, and the driving estimate is reported alongside', async () => {
    stubServerRoute({ distance: 9000, duration: 4242 })
    const result = await calculateRoute([wp1, wp2], 'cycling')
    expect(result.duration).toBe(4242)
    expect(result.drivingText).toBe('1 h 10 min')
  })
})

// ── calculateSegments error paths ──────────────────────────────────────────────

describe('calculateSegments failures', () => {
  it('FE-COMP-ROUTECALCULATOR-031: throws when the server answers with an HTTP error', async () => {
    server.use(http.post(ROUTE_URL, () => HttpResponse.json({}, { status: 502 })))
    await expect(calculateSegments([wp1, wp2])).rejects.toThrow()
  })

  it('FE-COMP-ROUTECALCULATOR-032: throws when the server reports no usable route', async () => {
    server.use(http.post(ROUTE_URL, () => HttpResponse.json({ error: 'No route found' }, { status: 502 })))
    await expect(calculateSegments([wp1, wp2])).rejects.toThrow()
  })
})

// ── calculateRouteWithLegs ─────────────────────────────────────────────────────

// The module caches by the exact waypoint list, so every test that must reach the
// network needs coordinates no earlier test has used.
let coordSeed = 0
function freshWaypoints(count = 2) {
  coordSeed += 1
  return Array.from({ length: count }, (_, i) => ({ lat: 10 + coordSeed + i / 100, lng: 20 + coordSeed + i / 100 }))
}

const buildLegsResponse = (legCount = 1) => buildServerRoute({
  coordinates: [[48.85, 2.35], [48.86, 2.36], [48.87, 2.37]],
  distance: 4200,
  duration: 600,
  legCount,
})

function pluginRouteResult(over: Partial<PluginRouteResult> = {}): PluginRouteResult {
  return {
    pluginId: 'ev-router',
    profile: 'fastest',
    coordinates: [[48.85, 2.35], [48.9, 2.4]],
    distance: 120000,
    duration: 5400,
    legs: [{ distance: 120000, duration: 5400 }],
    viaPoints: [],
    ...over,
  }
}

afterEach(() => {
  vi.restoreAllMocks()
  useSettingsStore.setState({ settings: { ...useSettingsStore.getState().settings, distance_unit: 'metric' } })
})

describe('calculateRouteWithLegs', () => {
  it('FE-COMP-ROUTECALCULATOR-033: returns an empty route for fewer than 2 waypoints without calling OSRM', async () => {
    const result = await calculateRouteWithLegs([wp1])
    expect(result).toEqual({ coordinates: [], distance: 0, duration: 0, legs: [] })
  })

  it('FE-COMP-ROUTECALCULATOR-034: returns road geometry as [lat,lng] plus per-leg metadata', async () => {
    server.use(http.post(ROUTE_URL, () => HttpResponse.json(buildLegsResponse())))
    const [a, b] = freshWaypoints()
    const result = await calculateRouteWithLegs([a, b])

    // OSRM ships [lng,lat]; Leaflet wants [lat,lng].
    expect(result.coordinates).toEqual([[48.85, 2.35], [48.86, 2.36], [48.87, 2.37]])
    expect(result.distance).toBe(4200)
    expect(result.legs).toHaveLength(1)
    expect(result.legs[0].from).toEqual([a.lat, a.lng])
    expect(result.legs[0].to).toEqual([b.lat, b.lng])
    expect(result.legs[0].mid).toEqual([(a.lat + b.lat) / 2, (a.lng + b.lng) / 2])
    expect(result.legs[0].distanceText).toBe('4.2 km')
    expect(result.legs[0].drivingText).toBe('10 min')
    expect(result.legs[0].walkingText).toBe('50 min')
  })

  it('FE-COMP-ROUTECALCULATOR-035: a repeated call is served from the cache instead of the network', async () => {
    let hits = 0
    server.use(http.post(ROUTE_URL, () => { hits++; return HttpResponse.json(buildLegsResponse()) }))
    const wps = freshWaypoints()
    const first = await calculateRouteWithLegs(wps)
    const second = await calculateRouteWithLegs(wps)

    expect(hits).toBe(1)
    expect(second).toBe(first)
  })

  it('FE-COMP-ROUTECALCULATOR-036: switching the distance unit re-fetches instead of reusing stale text (#1300)', async () => {
    server.use(http.post(ROUTE_URL, () => HttpResponse.json(buildLegsResponse())))
    const wps = freshWaypoints()
    const metric = await calculateRouteWithLegs(wps)
    expect(metric.legs[0].distanceText).toBe('4.2 km')

    useSettingsStore.setState({ settings: { ...useSettingsStore.getState().settings, distance_unit: 'imperial' } })
    const imperial = await calculateRouteWithLegs(wps)
    expect(imperial).not.toBe(metric)
    expect(imperial.legs[0].distanceText).toContain('mi')
  })

  it('FE-COMP-ROUTECALCULATOR-037: walking and cycling route through the same server endpoint with their profile in the body', async () => {
    const bodies: Array<{ profile?: string }> = []
    server.use(http.post(ROUTE_URL, async ({ request }) => {
      bodies.push(await request.json() as { profile?: string })
      return HttpResponse.json(buildLegsResponse())
    }))
    await expect(calculateRouteWithLegs(freshWaypoints(), { profile: 'walking' })).resolves.toMatchObject({ distance: 4200 })
    await expect(calculateRouteWithLegs(freshWaypoints(), { profile: 'cycling' })).resolves.toMatchObject({ distance: 4200 })
    expect(bodies.map((b) => b.profile)).toEqual(['walking', 'cycling'])
  })

  it('FE-COMP-ROUTECALCULATOR-038: an unknown profile falls back to driving', async () => {
    const bodies: Array<{ profile?: string }> = []
    server.use(http.post(ROUTE_URL, async ({ request }) => {
      bodies.push(await request.json() as { profile?: string })
      return HttpResponse.json(buildLegsResponse())
    }))
    await calculateRouteWithLegs(freshWaypoints(), { profile: 'hovercraft' as never })
    expect(bodies[0]?.profile).toBe('driving')
  })

  it('FE-COMP-ROUTECALCULATOR-039: builds one leg per waypoint pair', async () => {
    server.use(http.post(ROUTE_URL, () => HttpResponse.json(buildLegsResponse(2))))
    const wps = freshWaypoints(3)
    const result = await calculateRouteWithLegs(wps)
    expect(result.legs).toHaveLength(2)
    expect(result.legs[1].from).toEqual([wps[1].lat, wps[1].lng])
    expect(result.legs[1].to).toEqual([wps[2].lat, wps[2].lng])
  })

  it('FE-COMP-ROUTECALCULATOR-040: throws on a server HTTP error so the caller can fall back to a straight line', async () => {
    server.use(http.post(ROUTE_URL, () => HttpResponse.json({}, { status: 503 })))
    await expect(calculateRouteWithLegs(freshWaypoints())).rejects.toThrow()
  })

  it('FE-COMP-ROUTECALCULATOR-041: throws when the server reports no route', async () => {
    server.use(http.post(ROUTE_URL, () => HttpResponse.json({ error: 'No route found' }, { status: 502 })))
    await expect(calculateRouteWithLegs(freshWaypoints())).rejects.toThrow()
  })

  it('FE-COMP-ROUTECALCULATOR-042: a route without legs still returns its geometry', async () => {
    stubServerRoute({ coordinates: [[48.85, 2.35]], distance: 10, duration: 5, legCount: 0 })
    const result = await calculateRouteWithLegs(freshWaypoints())
    expect(result.legs).toEqual([])
    expect(result.coordinates).toEqual([[48.85, 2.35]])
  })
})

describe('calculateRouteWithLegs plugin profiles', () => {
  it('FE-COMP-ROUTECALCULATOR-043: refuses a plugin route without a trip context', async () => {
    const spy = vi.spyOn(pluginsApi, 'pluginRoute')
    await expect(
      calculateRouteWithLegs(freshWaypoints(), { profile: 'plugin:ev-router/fastest' })
    ).rejects.toThrow('Plugin routing needs a trip context')
    expect(spy).not.toHaveBeenCalled()
  })

  it('FE-COMP-ROUTECALCULATOR-044: forwards the trip/day context and the bare coordinates to the plugin', async () => {
    const spy = vi.spyOn(pluginsApi, 'pluginRoute').mockResolvedValue({ route: pluginRouteResult() })
    const wps = freshWaypoints()
    await calculateRouteWithLegs(wps, { profile: 'plugin:ev-router/fastest', tripId: 7, dayId: 3 })

    expect(spy).toHaveBeenCalledWith(
      'ev-router',
      'fastest',
      { tripId: 7, dayId: 3, waypoints: wps.map(p => ({ lat: p.lat, lng: p.lng })) },
      { signal: undefined },
    )
  })

  it('FE-COMP-ROUTECALCULATOR-045: maps the plugin answer onto the normal route shape', async () => {
    vi.spyOn(pluginsApi, 'pluginRoute').mockResolvedValue({
      route: pluginRouteResult({
        legs: [{ distance: 120000, duration: 5400, note: '25 min charge' }],
        viaPoints: [{ lat: 48.7, lng: 2.3, label: 'Supercharger', tone: 'success', dwellSeconds: 1500 }],
      }),
    })
    const wps = freshWaypoints()
    const result = await calculateRouteWithLegs(wps, { profile: 'plugin:ev-router/fastest', tripId: 7 })

    expect(result.coordinates).toEqual([[48.85, 2.35], [48.9, 2.4]])
    expect(result.legs[0].noteText).toBe('25 min charge')
    expect(result.legs[0].drivingText).toBe('1 h 30 min')
    expect(result.legs[0].distanceText).toBe('120 km')
    expect(result.legs[0].from).toEqual([wps[0].lat, wps[0].lng])
    expect(result.vias).toHaveLength(1)
    expect(result.vias?.[0].label).toBe('Supercharger')
  })

  it('FE-COMP-ROUTECALCULATOR-046: a leg without a note carries no noteText, and no vias means no vias key', async () => {
    vi.spyOn(pluginsApi, 'pluginRoute').mockResolvedValue({ route: pluginRouteResult() })
    const result = await calculateRouteWithLegs(freshWaypoints(), { profile: 'plugin:ev-router/fastest', tripId: 7 })
    expect(result.legs[0].noteText).toBeUndefined()
    expect('vias' in result).toBe(false)
  })

  it('FE-COMP-ROUTECALCULATOR-047: a refusing plugin throws like an OSRM outage', async () => {
    vi.spyOn(pluginsApi, 'pluginRoute').mockResolvedValue({ route: null })
    await expect(
      calculateRouteWithLegs(freshWaypoints(), { profile: 'plugin:ev-router/fastest', tripId: 7 })
    ).rejects.toThrow('No route found')
  })

  it('FE-COMP-ROUTECALCULATOR-048: the same coordinates on a different day are routed again, not served from cache', async () => {
    const spy = vi.spyOn(pluginsApi, 'pluginRoute').mockResolvedValue({ route: pluginRouteResult() })
    const wps = freshWaypoints()
    const opts = { profile: 'plugin:ev-router/fastest', tripId: 7 }
    await calculateRouteWithLegs(wps, { ...opts, dayId: 1 })
    await calculateRouteWithLegs(wps, { ...opts, dayId: 1 })
    expect(spy).toHaveBeenCalledTimes(1)

    // A plugin may hand back different charging stops for another day, so the
    // cache key is scoped to trip + day.
    await calculateRouteWithLegs(wps, { ...opts, dayId: 2 })
    expect(spy).toHaveBeenCalledTimes(2)
  })
})

// Runs last on purpose: it fills the module-level route cache to its cap, which
// would evict the entries the tests above rely on.
describe('calculateRouteWithLegs cache eviction', () => {
  it('FE-COMP-ROUTECALCULATOR-049: the route cache is capped and drops its oldest entry', async () => {
    const spy = vi.spyOn(pluginsApi, 'pluginRoute').mockResolvedValue({ route: pluginRouteResult() })
    const opts = { profile: 'plugin:ev-router/fastest', tripId: 99 }
    const oldest = freshWaypoints()
    await calculateRouteWithLegs(oldest, opts)

    // ROUTE_CACHE_MAX is 200 — push past it so the first entry falls out again.
    for (let i = 0; i < 201; i++) await calculateRouteWithLegs(freshWaypoints(), opts)

    spy.mockClear()
    await calculateRouteWithLegs(oldest, opts)
    expect(spy).toHaveBeenCalledTimes(1)

    // The built-in (AMap) path writes into (and trims) the very same cache.
    let hits = 0
    server.use(http.post(ROUTE_URL, () => { hits++; return HttpResponse.json(buildLegsResponse()) }))
    await calculateRouteWithLegs(freshWaypoints())
    expect(hits).toBe(1)
  })
})

// ── 04 migration guards ────────────────────────────────────────────────────────

describe('RouteCalculator — 04 migration guards (docs/amap/04)', () => {
  it('FE-COMP-ROUTECALCULATOR-050: the exported routing surface is unchanged', () => {
    // The exported signatures are the contract with the day sidebar, the map
    // route drawing and the plugin dispatch — this is the anti-regression
    // assertion the 04 brief calls the critical one.
    expect(typeof calculateRoute).toBe('function')
    expect(typeof calculateRouteWithLegs).toBe('function')
    expect(typeof calculateSegments).toBe('function')
    expect(typeof parsePluginProfile).toBe('function')
    // .length counts params before the first defaulted one: profile/opts are
    // optional (defaults), so each function reports 1.
    expect(calculateRoute.length).toBe(1)
    expect(calculateRouteWithLegs.length).toBe(1)
    expect(calculateSegments.length).toBe(1)
    // RouteProfileKey still accepts a plugin key (compile-time union, spelled
    // out here as a runtime round-trip through the parser).
    const key: RouteProfileKey = 'plugin:ev-router/fastest'
    expect(parsePluginProfile(key)).toEqual({ pluginId: 'ev-router', profileId: 'fastest' })
  })

  it('FE-COMP-ROUTECALCULATOR-051: no request escapes to a public OSRM router', async () => {
    const osrmHits = forbidOsrm()
    server.use(http.post(ROUTE_URL, () => HttpResponse.json(buildLegsResponse())))
    const wps = freshWaypoints()
    await calculateRoute([wps[0], wps[1]], 'driving')
    await calculateRoute([wps[0], wps[1]], 'walking')
    await calculateSegments(wps)
    await calculateRouteWithLegs(freshWaypoints())
    await calculateRouteWithLegs(freshWaypoints(), { profile: 'cycling' })
    expect(osrmHits()).toBe(0)
  })

  it('FE-COMP-ROUTECALCULATOR-052: the server response is trusted as [lat,lng] WGS84 — no client-side datum math', async () => {
    // The server owns the GCJ-02↔WGS84 conversion; the client passes the
    // coordinates through untouched (a datum math here would double-shift).
    const raw = [[48.8566, 2.3522], [48.87, 2.37]]
    stubServerRoute({ coordinates: raw.map(([lat, lng]) => [lat, lng] as [number, number]) })
    const result = await calculateRoute([wp1, wp2])
    expect(result.coordinates).toEqual(raw)
  })
})

// ── generateCoMapsUrl ─────────────────────────────────────────────────────────

describe('generateCoMapsUrl', () => {
  const eiffel = { lat: 48.8584, lng: 2.2945, name: 'Eiffel Tower' }
  const louvre = { lat: 48.8606, lng: 2.3376, name: 'Louvre' }
  const notre = { lat: 48.8530, lng: 2.3499, name: 'Notre-Dame' }

  it('FE-COMP-ROUTECALCULATOR-016: no stops, no link', () => {
    expect(generateCoMapsUrl([])).toBeNull()
  })

  it('FE-COMP-ROUTECALCULATOR-017: two stops build a real route, mode included', () => {
    expect(generateCoMapsUrl([eiffel, louvre], 'walking')).toBe(
      'https://comaps.at/route?sll=48.8584,2.2945&saddr=Eiffel%20Tower'
      + '&dll=48.8606,2.3376&daddr=Louvre&type=pedestrian',
    )
  })

  it('FE-COMP-ROUTECALCULATOR-018: TREK profiles map onto CoMaps travel modes', () => {
    expect(generateCoMapsUrl([eiffel, louvre], 'driving')).toContain('type=vehicle')
    expect(generateCoMapsUrl([eiffel, louvre], 'cycling')).toContain('type=bicycle')
    // A plugin router has no CoMaps equivalent, so it falls back rather than
    // sending a mode CoMaps would reject.
    expect(generateCoMapsUrl([eiffel, louvre], 'plugin:ev/fast')).toContain('type=vehicle')
  })

  it('FE-COMP-ROUTECALCULATOR-019: three stops go as pins, because a route link would drop the middle', () => {
    const url = generateCoMapsUrl([eiffel, louvre, notre])!
    expect(url).toBe(
      'https://comaps.at/map?v=1&ll=48.8584,2.2945&n=Eiffel%20Tower'
      + '&ll=48.8606,2.3376&n=Louvre&ll=48.853,2.3499&n=Notre-Dame',
    )
  })

  it('FE-COMP-ROUTECALCULATOR-020: a single stop is a pin, and a nameless one is labelled by position', () => {
    expect(generateCoMapsUrl([{ lat: 48.85, lng: 2.35 }]))
      .toBe('https://comaps.at/map?v=1&ll=48.85,2.35&n=48.85%2C2.35')
  })
})
