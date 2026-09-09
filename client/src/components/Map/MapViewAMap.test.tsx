import React, { Suspense } from 'react'
import { http, HttpResponse } from 'msw'
import type { ComponentProps } from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, act } from '@testing-library/react'
import { resetAllStores } from '../../../tests/helpers/store'
import { buildPlace } from '../../../tests/helpers/factories'
import { useSettingsStore } from '../../store/settingsStore'
import { server } from '../../../tests/helpers/msw/server'

/**
 * MapViewAMap — the engine is mocked at the loader boundary; everything inside
 * the component (coordinate conversion, cluster data, marker DOM, listeners,
 * camera effects) runs for real against a fake AMap namespace.
 *
 * The coordinate assertions use the official-endpoint-validated GCJ-02 values
 * from docs/amap/01-coordinate-layer.md — independent ground truth, so a
 * forward/inverse mixup cannot pass.
 */

// Tiananmen: WGS84 (39.9087, 116.3912) ↔ GCJ-02 (39.9101013, 116.3974413).
const TIANANMEN_WGS = { lat: 39.9087, lng: 116.3912 }
const TIANAMEN_GCJ = { lat: 39.9101013, lng: 116.3974413 }

type Handler = (e: unknown) => void

interface ClusterInstance {
  options: {
    renderMarker: (ctx: { marker: unknown }) => void
    renderClusterMarker: (o: { count: number; marker: unknown }) => void
  }
  data: Array<{ lnglat: [number, number]; placeId: number }>
  clickHandlers: Handler[]
  setData: ReturnType<typeof vi.fn>
  setMap: ReturnType<typeof vi.fn>
  on: ReturnType<typeof vi.fn>
}

const fakeMap = vi.hoisted(() => {
  const state = {
    handlers: {} as Record<string, Handler[]>,
    bounds: null as { sw: { lng: number; lat: number }; ne: { lng: number; lat: number } } | null,
    fitCalls: [] as Array<{ bounds: unknown; avoid: number[]; maxZoom: number }>,
    zoomAndCenterCalls: [] as Array<{ zoom: number; center: unknown; immediately?: boolean }>,
    containerToLngLatCalls: [] as Array<[number, number]>,
    added: [] as Array<{ kind: string; opts?: Record<string, unknown>; path?: unknown }>,
    removed: [] as Array<{ kind: string }>,
    destroyed: false,
    zoom: 10,
  }
  function runOnce(fn: Handler): Handler {
    let done = false
    return (e: unknown) => {
      if (done) return
      done = true
      fn(e)
    }
  }
  const map = {
    on: vi.fn((type: string, fn: Handler, _context?: unknown, once?: boolean) => {
      // The typings model once() as on()'s fourth argument; a once handler
      // fires a single time, which is all the distinction the tests need.
      ;(state.handlers[type] ??= []).push(once ? runOnce(fn) : fn)
      return map
    }),
    off: vi.fn((type: string, fn: Handler) => {
      state.handlers[type] = (state.handlers[type] || []).filter(h => h !== fn)
      return map
    }),
    fire(type: string, e: unknown) {
      for (const fn of [...(state.handlers[type] || [])]) fn(e)
    },
    getBounds: vi.fn(() => ({
      getSouthWest: () => state.bounds!.sw,
      getNorthEast: () => state.bounds!.ne,
    })),
    getZoom: vi.fn(() => state.zoom),
    setZoomAndCenter: vi.fn((zoom: number, center: unknown, immediately?: boolean) => {
      state.zoomAndCenterCalls.push({ zoom, center, immediately })
    }),
    getFitZoomAndCenterByBounds: vi.fn((bounds: unknown, avoid: number[], maxZoom: number) => {
      state.fitCalls.push({ bounds, avoid, maxZoom })
      return [12.4, { lng: 116.397, lat: 39.91 }]
    }),
    // Positional: ~2.2px per 0.001° so the declutter maths sees real distances.
    lngLatToContainer: vi.fn((lnglat: { lng?: number; lat?: number } | [number, number]) => {
      const lng = Array.isArray(lnglat) ? lnglat[0] : lnglat.lng
      const lat = Array.isArray(lnglat) ? lnglat[1] : lnglat.lat
      return { getX: () => (lng + 180) * 2200, getY: () => (90 - lat) * 2200 }
    }),
    containerToLngLat: vi.fn((pixel: [number, number]) => {
      state.containerToLngLatCalls.push(pixel)
      return { lng: 116.39, lat: 39.908 }
    }),
    getContainer: vi.fn(() => document.createElement('div')),
    add: vi.fn((features: unknown) => { state.added.push(...(Array.isArray(features) ? features : [features])) }),
    remove: vi.fn((features: unknown) => { state.removed.push(...(Array.isArray(features) ? features : [features])) }),
    destroy: vi.fn(() => { state.destroyed = true }),
    reset() {
      state.handlers = {}
      state.bounds = null
      state.fitCalls = []
      state.zoomAndCenterCalls = []
      state.containerToLngLatCalls = []
      state.added = []
      state.removed = []
      state.destroyed = false
      state.zoom = 10
      for (const fn of [map.on, map.off, map.getBounds, map.getZoom, map.setZoomAndCenter, map.getFitZoomAndCenterByBounds, map.lngLatToContainer, map.containerToLngLat, map.getContainer, map.destroy]) fn.mockClear()
    },
  }
  return { map, state }
})

const fakeAMap = vi.hoisted(() => {
  const instances: ClusterInstance[] = []
  const boundsCtors: Array<{ sw: unknown; ne: unknown }> = []
  const infoWindows: Array<{
    content: unknown
    position: unknown
    opened: number
    closed: number
    setContent: ReturnType<typeof vi.fn>
    open: ReturnType<typeof vi.fn>
    close: ReturnType<typeof vi.fn>
  }> = []
  const domMarkers: Array<{ opts: { content?: HTMLElement; position?: unknown; zIndex?: number }; position: unknown; content: HTMLElement | null }> = []
  const AMap = {
    Map: vi.fn(function () {
      return fakeMap.map
    }),
    Bounds: vi.fn(function (sw: unknown, ne: unknown) {
      const b = { sw, ne }
      boundsCtors.push(b)
      return b
    }),
    Pixel: vi.fn(function (x: number, y: number) {
      return { x, y }
    }),
    Marker: vi.fn(function (opts: { content?: HTMLElement; position?: unknown; zIndex?: number }) {
      const marker = {
        opts,
        position: opts?.position ?? null,
        content: opts?.content ?? null,
      }
      domMarkers.push(marker)
      return marker
    }),
    InfoWindow: vi.fn(function () {
      const win = {
        content: null as unknown,
        position: null as unknown,
        opened: 0,
        closed: 0,
        setContent: vi.fn((c: unknown) => { win.content = c; return win }),
        open: vi.fn((_map: unknown, pos: unknown) => { win.position = pos; win.opened += 1; return win }),
        close: vi.fn(() => { win.closed += 1; return win }),
      }
      infoWindows.push(win)
      return win
    }),
    Polyline: vi.fn(function (opts: { path?: unknown; zIndex?: number; strokeColor?: string; strokeOpacity?: number }) {
      const line = { kind: 'Polyline', opts, path: opts?.path, on: vi.fn() }
      return line
    }),
    Polygon: vi.fn(function (opts: Record<string, unknown>) {
      const poly = { kind: 'Polygon', opts, on: vi.fn() }
      return poly
    }),
    Circle: vi.fn(function (opts: Record<string, unknown>) {
      const circle = { kind: 'Circle', opts, on: vi.fn() }
      return circle
    }),
    // The component reaches MarkerCluster through a structural cast (the
    // shipped typings carry the v1.4 class), so the fake is shaped accordingly.
    MarkerCluster: vi.fn(function (_map: unknown, _data: unknown, options: ClusterInstance['options']) {
      const instance: ClusterInstance = {
        options,
        data: [],
        clickHandlers: [],
        setData: vi.fn((data: ClusterInstance['data']) => { instance.data = data }),
        setMap: vi.fn(),
        on: vi.fn((type: string, fn: Handler) => {
          if (type === 'click') instance.clickHandlers.push(fn)
        }),
      }
      instances.push(instance)
      return instance
    }),
  }
  return { AMap, instances, boundsCtors, infoWindows, domMarkers }
})

vi.mock('./engines/amap/loader', () => ({
  loadAMap: vi.fn(() => Promise.resolve(fakeAMap.AMap)),
}))

// The Leaflet renderer only ever appears as MapViewAuto's fallback in this suite.
vi.mock('./MapView', () => ({
  MapView: () => <div data-testid="leaflet-fallback" />,
}))

import { MapViewAMap } from './MapViewAMap'
import { MapViewAuto } from './MapViewAuto'
import { loadAMap } from './engines/amap/loader'
import type { AMapNamespace } from './engines/amap/loader'

/** The subset of AMap.Marker the render callbacks touch, capture-style. */
function makeClusterMarker(position: { lng: number; lat: number }) {
  const holder: { content: HTMLElement | string | null } = { content: null }
  const marker = {
    getPosition: vi.fn(() => ({ getLng: () => position.lng, getLat: () => position.lat })),
    setContent: vi.fn((content: HTMLElement | string) => { holder.content = content }),
    setAnchor: vi.fn(),
  }
  return { marker, holder }
}

/** jsdom has no TouchEvent; a plain Event with `touches` is what the handlers read. */
function touchEvent(type: string, touches: Array<{ clientX: number; clientY: number }>) {
  const ev = new Event(type, { bubbles: true })
  Object.defineProperty(ev, 'touches', { value: touches })
  return ev
}

function placeAt(overrides: Record<string, unknown> = {}) {
  return {
    ...buildPlace(),
    lat: TIANANMEN_WGS.lat,
    lng: TIANANMEN_WGS.lng,
    category_name: null,
    category_color: null,
    category_icon: null,
    ...overrides,
  }
}

function setAmapKey(key: string | undefined) {
  useSettingsStore.setState({
    settings: { ...useSettingsStore.getState().settings, amap_js_key: key, map_provider: 'amap' },
  })
}

/** Renders inside an awaited act: the use() suspension must settle in-scope. */
async function renderAMap(props: ComponentProps<typeof MapViewAMap>) {
  let utils!: ReturnType<typeof render>
  await act(async () => {
    utils = render(
      <Suspense fallback={<div data-testid="suspense-fallback" />}>
        <MapViewAMap {...props} />
      </Suspense>,
    )
  })
  return utils
}

/** Re-renders inside an awaited act, same reason. */
async function rerenderAMap(utils: ReturnType<typeof render>, props: ComponentProps<typeof MapViewAMap>) {
  await act(async () => {
    utils.rerender(
      <Suspense fallback={<div data-testid="suspense-fallback" />}>
        <MapViewAMap {...props} />
      </Suspense>,
    )
  })
}

/** Flushes pending loader microtasks after plain renders (MapViewAuto tests). */
async function settle() {
  await act(async () => {})
}

beforeEach(() => {
  resetAllStores()
  setAmapKey('test-amap-key')
  fakeMap.map.reset()
  fakeAMap.instances.length = 0
  fakeAMap.boundsCtors.length = 0
  fakeAMap.infoWindows.length = 0
  fakeAMap.domMarkers.length = 0
  vi.mocked(loadAMap).mockClear().mockReturnValue(Promise.resolve(fakeAMap.AMap as unknown as AMapNamespace))
  vi.mocked(fakeAMap.AMap.Map).mockClear()
  vi.mocked(fakeAMap.AMap.Bounds).mockClear()
  vi.mocked(fakeAMap.AMap.MarkerCluster).mockClear()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('MapViewAMap — coordinate boundary', () => {
  it('feeds the cluster GCJ-02 coordinates, never the stored WGS84 values', async () => {
    await renderAMap({ places: [placeAt()] })
    await settle()
    expect(fakeAMap.instances.length).toBe(1)

    const cluster = fakeAMap.instances[0]
    await waitFor(() => expect(cluster.data.length).toBe(1))
    const [lng, lat] = cluster.data[0].lnglat
    expect(lat).toBeCloseTo(TIANAMEN_GCJ.lat, 6)
    expect(lng).toBeCloseTo(TIANAMEN_GCJ.lng, 6)
    expect(cluster.data[0].lnglat).not.toEqual([TIANANMEN_WGS.lng, TIANANMEN_WGS.lat])
  })

  it('reports map clicks back to the app in WGS84', async () => {
    const onMapClick = vi.fn()
    await renderAMap({ places: [placeAt()], onMapClick })
    await settle()

    act(() => fakeMap.map.fire('click', { lnglat: { lng: TIANAMEN_GCJ.lng, lat: TIANAMEN_GCJ.lat } }))
    expect(onMapClick).toHaveBeenCalledTimes(1)
    const { latlng } = onMapClick.mock.calls[0][0] as { latlng: { lat: number; lng: number } }
    expect(latlng.lat).toBeCloseTo(TIANANMEN_WGS.lat, 5)
    expect(latlng.lng).toBeCloseTo(TIANANMEN_WGS.lng, 5)
  })

  it('reports the context menu (right click) in WGS84 with the original event', async () => {
    const onMapContextMenu = vi.fn()
    await renderAMap({ places: [placeAt()], onMapContextMenu })
    await settle()

    const originalEvent = new MouseEvent('contextmenu')
    act(() => fakeMap.map.fire('rightclick', { lnglat: { lng: TIANAMEN_GCJ.lng, lat: TIANAMEN_GCJ.lat }, originEvent: originalEvent }))
    expect(onMapContextMenu).toHaveBeenCalledTimes(1)
    const payload = onMapContextMenu.mock.calls[0][0] as { latlng: { lat: number; lng: number }; originalEvent: MouseEvent }
    expect(payload.latlng.lat).toBeCloseTo(TIANANMEN_WGS.lat, 5)
    expect(payload.latlng.lng).toBeCloseTo(TIANANMEN_WGS.lng, 5)
    expect(payload.originalEvent).toBe(originalEvent)
  })

  it('touch long-press fires the context menu, and the closing tap does not double as a click', async () => {
    vi.useFakeTimers()
    try {
      const onMapContextMenu = vi.fn()
      const onMapClick = vi.fn()
      const { container } = await renderAMap({ places: [placeAt()], onMapContextMenu, onMapClick })
      await act(async () => {})
      // The listeners sit on the map container div: the root's first child.
      const surface = (container.firstElementChild as HTMLElement).firstElementChild as HTMLElement

      act(() => {
        surface.dispatchEvent(touchEvent('touchstart', [{ clientX: 120, clientY: 140 }]))
        vi.advanceTimersByTime(650)
      })
      expect(onMapContextMenu).toHaveBeenCalledTimes(1)
      // The held position was resolved through the map and handed over as WGS84.
      expect(fakeMap.state.containerToLngLatCalls.length).toBe(1)
      const payload = onMapContextMenu.mock.calls[0][0] as { latlng: { lat: number; lng: number }; originalEvent: Event }
      expect(payload.originalEvent).toBeTruthy()

      // The touchend tap the browser synthesizes lands on the suppression flag.
      act(() => fakeMap.map.fire('click', { lnglat: { lng: TIANAMEN_GCJ.lng, lat: TIANAMEN_GCJ.lat } }))
      expect(onMapClick).not.toHaveBeenCalled()

      // A fresh gesture clears the suppression, so the NEXT tap still counts.
      act(() => {
        surface.dispatchEvent(touchEvent('touchstart', [{ clientX: 120, clientY: 140 }]))
      })
      act(() => fakeMap.map.fire('click', { lnglat: { lng: TIANAMEN_GCJ.lng, lat: TIANAMEN_GCJ.lat } }))
      expect(onMapClick).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('a moving finger cancels the long-press', async () => {
    vi.useFakeTimers()
    try {
      const onMapContextMenu = vi.fn()
      const { container } = await renderAMap({ places: [placeAt()], onMapContextMenu })
      await act(async () => {})
      const surface = (container.firstElementChild as HTMLElement).firstElementChild as HTMLElement
      act(() => {
        surface.dispatchEvent(touchEvent('touchstart', [{ clientX: 120, clientY: 140 }]))
        surface.dispatchEvent(touchEvent('touchmove', [{ clientX: 200, clientY: 260 }]))
        vi.advanceTimersByTime(650)
      })
      expect(onMapContextMenu).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it('emits the viewport bbox on moveend with converted (WGS84) corners', async () => {
    const onViewportChange = vi.fn()
    await renderAMap({ places: [placeAt()], onViewportChange })
    await settle()

    // GCJ-02 corners around Tiananmen.
    fakeMap.state.bounds = {
      sw: { lng: 116.3974413, lat: 39.9101013 },
      ne: { lng: 116.45, lat: 39.95 },
    }
    act(() => fakeMap.map.fire('moveend', {}))
    expect(onViewportChange).toHaveBeenCalledTimes(1)
    const bbox = onViewportChange.mock.calls[0][0] as { south: number; west: number; north: number; east: number }
    // The GCJ-02 SW corner converted back must differ from its input…
    expect(bbox.south).not.toBe(39.9101013)
    expect(bbox.west).not.toBe(116.3974413)
    // …and sit slightly SOUTH/WEST of the GCJ value (the Beijing offset).
    expect(bbox.south).toBeLessThan(39.9101013)
    expect(bbox.west).toBeLessThan(116.3974413)
    expect(bbox.south).toBeLessThan(bbox.north)
    expect(bbox.west).toBeLessThan(bbox.east)
  })
})

describe('MapViewAMap — markers and clustering', () => {
  it('renders the place marker DOM for a cluster leaf, badge as text content', async () => {
    await renderAMap({ places: [placeAt({ id: 7 })], dayOrderMap: { 7: [3] } })
    await settle()

    const cluster = fakeAMap.instances[0]
    const { marker, holder } = makeClusterMarker({ lng: TIANAMEN_GCJ.lng, lat: TIANAMEN_GCJ.lat })
    act(() => cluster.options.renderMarker({ marker }))
    expect(marker.setContent).toHaveBeenCalledTimes(1)
    const el = holder.content as HTMLElement
    expect(el.className).toBe('trek-amap-marker')
    expect(el.textContent).toContain('3')
  })

  it('the marker DOM identity resolves through the position we fed the cluster', async () => {
    await renderAMap({ places: [placeAt({ id: 7 })] })
    await settle()

    const cluster = fakeAMap.instances[0]
    // A position that matches no fed point renders nothing — no cross-talk.
    const stray = makeClusterMarker({ lng: 1, lat: 1 })
    cluster.options.renderMarker({ marker: stray.marker })
    expect(stray.marker.setContent).not.toHaveBeenCalled()

    const { marker } = makeClusterMarker({ lng: TIANAMEN_GCJ.lng, lat: TIANAMEN_GCJ.lat })
    cluster.options.renderMarker({ marker })
    expect(marker.setContent).toHaveBeenCalledTimes(1)
  })

  it('a click on the marker DOM reports the place id and clears the hover card', async () => {
    const onMarkerClick = vi.fn()
    await renderAMap({ places: [placeAt({ id: 7, name: '天安门' })], onMarkerClick })
    await settle()

    const cluster = fakeAMap.instances[0]
    const { marker, holder } = makeClusterMarker({ lng: TIANAMEN_GCJ.lng, lat: TIANAMEN_GCJ.lat })
    act(() => cluster.options.renderMarker({ marker }))
    const el = holder.content as HTMLElement
    act(() => el.dispatchEvent(new MouseEvent('mouseenter', { clientX: 50, clientY: 60 })))
    expect(screen.getByTestId('tooltip')).toBeTruthy()
    act(() => el.dispatchEvent(new MouseEvent('click', { bubbles: true })))
    expect(onMarkerClick).toHaveBeenCalledWith(7)
    // #1404: the card is cleared right away — no mouseleave will fire.
    expect(screen.queryByTestId('tooltip')).toBeNull()
  })

  it('renders a count bubble for a cluster and fits its points on click', async () => {
    const onMapClick = vi.fn()
    await renderAMap({
      places: [placeAt({ id: 1 }), placeAt({ id: 2, lat: 39.95, lng: 116.45 })],
      onMapClick,
    })
    await settle()

    const cluster = fakeAMap.instances[0]
    const { marker, holder } = makeClusterMarker({ lng: TIANAMEN_GCJ.lng, lat: TIANAMEN_GCJ.lat })
    act(() => cluster.options.renderClusterMarker({ count: 12, marker }))
    const el = holder.content as HTMLElement
    expect(el.className).toBe('trek-amap-cluster')
    expect(el.textContent).toBe('12')

    expect(cluster.clickHandlers.length).toBeGreaterThan(0)
    const before = fakeMap.state.zoomAndCenterCalls.length
    act(() => cluster.clickHandlers.forEach(fn => fn({
      cluster: { clusterData: [{ lnglat: [TIANAMEN_GCJ.lng, TIANAMEN_GCJ.lat] }, { lnglat: [116.45, 39.95] }] },
    })))
    expect(fakeMap.state.zoomAndCenterCalls.length).toBe(before + 1)
    expect(onMapClick).not.toHaveBeenCalled()
  })

  it('shows the hover card on marker mouseenter and hides it on mouseleave', async () => {
    await renderAMap({ places: [placeAt({ id: 7, name: '天安门广场', category_name: '景点', address: '北京市东城区' })] })
    await settle()

    const cluster = fakeAMap.instances[0]
    const { marker, holder } = makeClusterMarker({ lng: TIANAMEN_GCJ.lng, lat: TIANAMEN_GCJ.lat })
    act(() => cluster.options.renderMarker({ marker }))
    const el = holder.content as HTMLElement
    act(() => el.dispatchEvent(new MouseEvent('mouseenter', { clientX: 50, clientY: 60 })))
    await waitFor(() => expect(screen.getByTestId('tooltip')).toBeTruthy())
    expect(screen.getByTestId('tooltip').textContent).toContain('天安门广场')
    expect(screen.getByTestId('tooltip').textContent).toContain('景点')

    act(() => el.dispatchEvent(new MouseEvent('mouseleave')))
    await waitFor(() => expect(screen.queryByTestId('tooltip')).toBeNull())
  })

  it('hoverDisabled suppresses the hover card', async () => {
    await renderAMap({ places: [placeAt({ id: 7, name: '天安门' })], hoverDisabled: true })
    await settle()

    const cluster = fakeAMap.instances[0]
    const { marker, holder } = makeClusterMarker({ lng: TIANAMEN_GCJ.lng, lat: TIANAMEN_GCJ.lat })
    act(() => cluster.options.renderMarker({ marker }))
    const el = holder.content as HTMLElement
    act(() => el.dispatchEvent(new MouseEvent('mouseenter', { clientX: 50, clientY: 60 })))
    expect(screen.queryByTestId('tooltip')).toBeNull()
  })
})

describe('MapViewAMap — camera effects', () => {
  it('frames the places on mount through getFitZoomAndCenterByBounds with panel padding', async () => {
    await renderAMap({ places: [placeAt({ id: 1 }), placeAt({ id: 2, lat: 39.95, lng: 116.45 })] })
    await settle()

    expect(fakeMap.state.fitCalls.length).toBe(1)
    const { avoid, maxZoom } = fakeMap.state.fitCalls[0]
    // avoid is 上、下、左、右 (JSAPI order): desktop top 60 / bottom 60 / left 40 / right 40.
    expect(avoid).toEqual([60, 60, 40, 40])
    expect(maxZoom).toBe(15)
    // Applied with an animated transition.
    expect(fakeMap.state.zoomAndCenterCalls.length).toBe(1)
    expect(fakeMap.state.zoomAndCenterCalls[0].immediately).toBe(false)
  })

  it('refits when fitKey changes, but adopts the opening fit instead of redoing it', async () => {
    const utils = await renderAMap({ places: [placeAt({ id: 1 })], fitKey: 0 })
    expect(fakeMap.state.fitCalls.length).toBe(1)

    await rerenderAMap(utils, { places: [placeAt({ id: 1 })], fitKey: 0 })
    await settle()
    // Same fitKey: the opening fit is adopted, not redone.
    expect(fakeMap.state.fitCalls.length).toBe(1)

    await rerenderAMap(utils, { places: [placeAt({ id: 1 })], fitKey: 2 })
    await settle()
    expect(fakeMap.state.fitCalls.length).toBe(2)
  })

  it('recentres on the selected place at the shared minimum zoom', async () => {
    const utils = await renderAMap({ places: [placeAt({ id: 1 })] })
    await settle()
    const before = fakeMap.state.zoomAndCenterCalls.length

    await rerenderAMap(utils, { places: [placeAt({ id: 1 })], selectedPlaceId: 1 })
    await settle()
    expect(fakeMap.state.zoomAndCenterCalls.length).toBe(before + 1)
    const call = fakeMap.state.zoomAndCenterCalls[fakeMap.state.zoomAndCenterCalls.length - 1]
    expect(call.zoom).toBe(14)
    expect(call.immediately).toBe(false)
  })

  it('jumps without animation when the external center prop changes', async () => {
    const utils = await renderAMap({ places: [placeAt({ id: 1 })] })
    await settle()
    const before = fakeMap.state.zoomAndCenterCalls.length

    await rerenderAMap(utils, { places: [placeAt({ id: 1 })], center: [40.0, 116.5], zoom: 12 })
    await settle()
    expect(fakeMap.state.zoomAndCenterCalls.length).toBe(before + 1)
    const call = fakeMap.state.zoomAndCenterCalls[fakeMap.state.zoomAndCenterCalls.length - 1]
    expect(call.immediately).toBe(true)
    expect(call.zoom).toBe(12)
  })

  it('keeps the map alive when a selection toggles the inspector padding', async () => {
    // hasInspector is !!selectedPlace upstream: selecting a place widens the
    // bottom padding. The map build must not depend on it — GL rebuilds on
    // provider/style changes only, and a rebuild here reset the camera to the
    // world view on every click.
    const utils = await renderAMap({ places: [placeAt({ id: 1 })], hasInspector: false })
    await settle()
    expect(vi.mocked(fakeAMap.AMap.Map)).toHaveBeenCalledTimes(1)

    await rerenderAMap(utils, { places: [placeAt({ id: 1 })], hasInspector: true, selectedPlaceId: 1 })
    await settle()
    expect(vi.mocked(fakeAMap.AMap.Map)).toHaveBeenCalledTimes(1)
    expect(fakeMap.state.destroyed).toBe(false)
    // The recentre still ran, on the same map instance.
    const calls = fakeMap.state.zoomAndCenterCalls
    expect(calls[calls.length - 1].zoom).toBe(14)

    // Deselection shrinks the padding again — still no rebuild.
    await rerenderAMap(utils, { places: [placeAt({ id: 1 })], hasInspector: false, selectedPlaceId: null })
    await settle()
    expect(vi.mocked(fakeAMap.AMap.Map)).toHaveBeenCalledTimes(1)
    expect(fakeMap.state.destroyed).toBe(false)
  })
})

describe('MapViewAMap — lifecycle', () => {
  it('keeps onMapReady GL-only: never hands the map out, resets with null on unmount', async () => {
    // TripPlannerPage's onMapReady consumer expects the GL map API (compass
    // pill). The Leaflet renderer never hands its map over; AMap follows that
    // precedent — an AMap.Map reaching that consumer would crash on getBearing.
    const onMapReady = vi.fn()
    const { unmount } = await renderAMap({ places: [placeAt({ id: 1 })], onMapReady })
    await settle()
    expect(onMapReady).not.toHaveBeenCalled()
    expect(fakeMap.state.destroyed).toBe(false)

    unmount()
    expect(fakeMap.state.destroyed).toBe(true)
    expect(onMapReady).toHaveBeenCalledWith(null)
  })

  it('shows the Suspense fallback while the JSAPI is loading', async () => {
    // One stable deferred: the component calls loadAMap on every render while
    // suspended, and use() needs the SAME promise each time (the real loader's
    // singleton guarantees that; the mock has to as well). Render + resolve
    // share one act scope — that is what flushes the use() retry in this
    // environment.
    let resolve!: (v: AMapNamespace) => void
    const deferred = new Promise<AMapNamespace>(r => { resolve = r })
    vi.mocked(loadAMap).mockImplementation(() => deferred)
    await act(async () => {
      render(
        <Suspense fallback={<div data-testid="suspense-fallback" />}>
          <MapViewAMap places={[placeAt({ id: 1 })]} />
        </Suspense>,
      )
    })
    expect(screen.getByTestId('suspense-fallback')).toBeTruthy()
    await act(async () => {
      resolve(fakeAMap.AMap as unknown as AMapNamespace)
    })
    await waitFor(() => expect(fakeAMap.instances.length).toBe(1))
  })
})

// ── 02b · overlays ───────────────────────────────────────────────────────────

const TIANANMEN_GCJ_LNG = 116.3974413
const TIANAMEN_GCJ_LAT = 39.9101013

function vectorShapes(): Array<{ kind: string; opts: Record<string, unknown>; path?: unknown; on: ReturnType<typeof vi.fn> }> {
  return fakeMap.state.added.filter(f => f && typeof f === 'object' && 'kind' in f) as never
}

describe('MapViewAMap — day route + GPX tracks', () => {
  it('draws the day route as casing + core, both in GCJ-02', async () => {
    const route: [number, number][][] = [[[39.9087, 116.3912], [39.9163, 116.3972]]]
    await renderAMap({ places: [placeAt({ id: 1 })], route })
    await settle()

    const lines = vectorShapes().filter(l => l.kind === 'Polyline')
    expect(lines.length).toBe(2)
    expect(lines[0].opts.strokeColor).toBe('#0a5cc2')
    expect(lines[1].opts.strokeColor).toBe('#0a84ff')
    // Every vertex must be the converted (GCJ-02) coordinate.
    const path = lines[0].path as Array<[number, number]>
    expect(path[0][1]).toBeCloseTo(TIANAMEN_GCJ_LAT, 6)
    expect(path[0][0]).toBeCloseTo(TIANANMEN_GCJ_LNG, 6)
    // …and must NOT be the stored WGS84 value.
    expect(path[0][0]).not.toBeCloseTo(116.3912, 4)
  })

  it('draws a GPX track in its manual colour with casing, and selects the place on track click', async () => {
    const onMarkerClick = vi.fn()
    const gpxPlace = placeAt({
      id: 9,
      route_geometry: JSON.stringify([[39.91, 116.38], [39.915, 116.39], [39.92, 116.40]]),
      route_color: '#ff8800',
    })
    const { container } = await renderAMap({ places: [gpxPlace], onMarkerClick })
    await settle()

    const lines = vectorShapes().filter(l => l.kind === 'Polyline')
    // casing + core + hit line
    expect(lines.length).toBe(3)
    expect(lines[0].opts.strokeColor).toBe('#ffffff')
    expect(lines[0].opts.strokeOpacity).toBe(0.7) // manual colour → casing on
    expect(lines[1].opts.strokeColor).toBe('#ff8800')
    expect(lines[2].opts.strokeOpacity).toBe(0.01) // invisible fat hit line

    const hit = lines[2]
    const clickHandler = (hit.on as ReturnType<typeof vi.fn>).mock.calls.find(c => c[0] === 'click')?.[1] as () => void
    expect(clickHandler).toBeTypeOf('function')
    act(() => clickHandler())
    expect(onMarkerClick).toHaveBeenCalledWith(9)
    void container
  })

  it('plugin route vias render as small dots and open the dwell popup on click', async () => {
    const via = { lat: 39.912, lng: 116.395, label: '充电 25 分钟', tone: 'warn' as const, dwellSeconds: 1500 }
    await renderAMap({ places: [placeAt({ id: 1 })], routeVias: [via] })
    await settle()

    expect(fakeAMap.domMarkers.length).toBe(1)
    expect(fakeAMap.infoWindows.length).toBeGreaterThan(0)
    const win = fakeAMap.infoWindows[0]

    const dotEl = fakeAMap.domMarkers[0].content as HTMLElement
    act(() => dotEl.dispatchEvent(new MouseEvent('click', { bubbles: true })))
    expect(win.setContent).toHaveBeenCalledTimes(1)
    expect((win.content as HTMLElement).textContent).toContain('充电 25 分钟')
    expect((win.content as HTMLElement).textContent).toContain('25 min')
    expect(win.open).toHaveBeenCalledTimes(1)
  })
})

describe('MapViewAMap — reservations overlay', () => {
  function booking(overrides: Record<string, unknown> = {}) {
    return {
      id: 31,
      type: 'flight',
      status: 'confirmed',
      day_id: null,
      end_day_id: null,
      reservation_time: null,
      reservation_end_time: null,
      endpoints: [
        { role: 'from', sequence: 0, lat: 39.9087, lng: 116.3912, name: 'Beijing Capital', code: 'PEK' },
        { role: 'to', sequence: 1, lat: 31.2393, lng: 121.4905, name: 'Shanghai Hongqiao', code: 'SHA' },
      ],
      ...overrides,
    } as never
  }

  it('draws a sampled great-circle arc (not a straight 2-point line) in GCJ-02', async () => {
    // Flights draw only when their per-booking connection toggle is on.
    await renderAMap({ places: [placeAt({ id: 1 })], reservations: [booking()], visibleConnectionIds: [31] })
    await settle()

    const lines = vectorShapes().filter(l => l.kind === 'Polyline')
    expect(lines.length).toBeGreaterThan(0)
    const arc = lines[0].path as Array<[number, number]>
    // The sampler produces a dense great-circle, not a from/to straight.
    expect(arc.length).toBeGreaterThan(16)
    // Endpoint vertices land on the converted GCJ-02 positions.
    expect(arc[0][0]).toBeCloseTo(TIANANMEN_GCJ_LNG, 6)
    expect(arc[0][1]).toBeCloseTo(TIANAMEN_GCJ_LAT, 6)
  })

  it('does not draw a connection whose endpoints sit on top of each other (declutter)', async () => {
    const sameSpot = booking({
      id: 32,
      endpoints: [
        { role: 'from', sequence: 0, lat: 39.9087, lng: 116.3912, name: 'A' },
        { role: 'to', sequence: 1, lat: 39.9087, lng: 116.3912, name: 'B' },
      ],
    })
    await renderAMap({ places: [placeAt({ id: 1 })], reservations: [sameSpot], visibleConnectionIds: [32] })
    await settle()

    const lines = vectorShapes().filter(l => l.kind === 'Polyline')
    expect(lines.length).toBe(0)
  })

  it('endpoint pills open… nothing by themselves, and report the reservation id on click', async () => {
    const onReservationClick = vi.fn()
    await renderAMap({ places: [placeAt({ id: 1 })], reservations: [booking()], visibleConnectionIds: [31], onReservationClick })
    await settle()

    // Two endpoint pills (from + to).
    expect(fakeAMap.domMarkers.length).toBe(2)
    const pill = fakeAMap.domMarkers[0].content as HTMLElement
    act(() => pill.dispatchEvent(new MouseEvent('click', { bubbles: true })))
    expect(onReservationClick).toHaveBeenCalledWith(31)
  })

  it('keeps an antimeridian-crossing arc unbroken: consecutive longitude steps stay < 180°', async () => {
    // Tokyo → San Francisco crosses the date line. The unwrapped arc must step
    // smoothly past ±180 (no ±360 jump, which would draw across the whole map);
    // both endpoints sit outside the China box, so the datum transform is
    // identity there and the unwrap survives the coordinate boundary.
    const tokyoToSf = booking({
      id: 33,
      endpoints: [
        { role: 'from', sequence: 0, lat: 35.5494, lng: 139.7798, name: 'HND', code: 'HND' },
        { role: 'to', sequence: 1, lat: 37.6213, lng: -122.379, name: 'SFO', code: 'SFO' },
      ],
    })
    await renderAMap({ places: [placeAt({ id: 1 })], reservations: [tokyoToSf], visibleConnectionIds: [33] })
    await settle()

    const lines = vectorShapes().filter(l => l.kind === 'Polyline')
    expect(lines.length).toBeGreaterThan(0)
    const arc = lines[0].path as Array<[number, number]>
    expect(arc.length).toBeGreaterThan(16)
    let maxStep = 0
    for (let i = 1; i < arc.length; i++) maxStep = Math.max(maxStep, Math.abs(arc[i][0] - arc[i - 1][0]))
    expect(maxStep).toBeLessThan(5)
    // …and the arc actually crosses the date line (unwrapped lngs beyond ±180).
    // AMap paths are [lng, lat] — longitude is index 0.
    expect(arc.some(([lng]) => lng > 180 || lng < -180)).toBe(true)
  })
})

describe('MapViewAMap — POI explore pins', () => {
  const poi = {
    osm_id: '1', name: '面馆 <script>alert(1)</script>', lat: 39.909, lng: 116.392,
    category: 'restaurant', poi_type: 'restaurant', address: '北京', website: null,
    phone: null, opening_hours: null, cuisine: null, source: 'openstreetmap' as const,
  }

  it('renders category-coloured pins; hover opens a popup with the escaped name; click reports the poi', async () => {
    const onPoiClick = vi.fn()
    await renderAMap({ places: [placeAt({ id: 1 })], pois: [poi], onPoiClick })
    await settle()

    expect(fakeAMap.domMarkers.length).toBe(1)
    expect(fakeAMap.infoWindows.length).toBeGreaterThan(0)
    const win = fakeAMap.infoWindows[0]

    const pin = fakeAMap.domMarkers[0].content as HTMLElement
    act(() => pin.dispatchEvent(new MouseEvent('mouseenter', {})))
    expect(win.setContent).toHaveBeenCalledTimes(1)
    const html = (win.content as HTMLElement).innerHTML
    expect(html).toContain('面馆')
    expect(html).not.toContain('<script>')

    act(() => pin.dispatchEvent(new MouseEvent('click', { bubbles: true })))
    expect(onPoiClick).toHaveBeenCalledWith(expect.objectContaining({ osm_id: '1' }))
  })
})

describe('MapViewAMap — plugin map contributions', () => {
  const pluginLayer = {
    pluginId: 'p1',
    id: 'layer-1',
    features: [
      { type: 'polyline', points: [[39.91, 116.38], [39.92, 116.39]], tone: 'success', width: 4, dash: 'solid', opacity: 0.8, fill: false, label: '路线走廊' },
      { type: 'polygon', points: [[39.90, 116.37], [39.91, 116.37], [39.91, 116.38]], tone: 'danger', width: 2, dash: 'dash', opacity: 0.9, fill: true, label: '区域' },
    ],
  }

  it('draws plugin shapes BELOW the day route (z 3 vs 11/12) and converts every vertex', async () => {
    server.use(
      http.get('/api/map-layers/5', () => HttpResponse.json({ layers: [pluginLayer] })),
      http.get('/api/map-markers/5', () => HttpResponse.json({ markers: [] })),
    )
    const route: [number, number][][] = [[[39.9087, 116.3912], [39.9163, 116.3972]]]
    await renderAMap({
      places: [placeAt({ id: 1 })], route,
      tripId: 5,
    })
    await settle()
    await waitFor(() => expect(vectorShapes().filter(l => l.opts?.zIndex === 3).length).toBe(2))

    const shapes = vectorShapes()
    const pluginShapes = shapes.filter(l => l.opts?.zIndex === 3)
    expect(pluginShapes.length).toBe(2)
    // One route segment → one casing (z11) + one core (z12).
    const routeLines = shapes.filter(l => l.opts?.zIndex === 11)
    expect(routeLines.length).toBe(1)
    // WGS84 [lat,lng] (39.91, 116.38) → GCJ-02: lng ≈ 116.386, NOT the raw value.
    const pluginPath = pluginShapes[0].path as Array<[number, number]>
    expect(pluginPath[0][0]).not.toBeCloseTo(116.38, 4)
  })

  it('plugin markers render as tone dots with a text-only popup on click', async () => {
    const mk = { pluginId: 'p1', id: 'm1', lat: 39.91, lng: 116.39, label: '补给点', popupText: '免费开水', tone: 'success' }
    server.use(
      http.get('/api/map-markers/5', () => HttpResponse.json({ markers: [mk] })),
      http.get('/api/map-layers/5', () => HttpResponse.json({ layers: [] })),
    )
    await renderAMap({ places: [placeAt({ id: 1 })], tripId: 5 })
    await settle()
    await waitFor(() => expect(fakeAMap.domMarkers.length).toBe(1))

    const win = fakeAMap.infoWindows[0]
    const dotEl = fakeAMap.domMarkers[0].content as HTMLElement
    act(() => dotEl.dispatchEvent(new MouseEvent('click', { bubbles: true })))
    expect((win.content as HTMLElement).textContent).toContain('补给点')
    expect((win.content as HTMLElement).textContent).toContain('免费开水')
  })
})

describe('MapViewAuto — amap branch', () => {
  it('falls back to Leaflet when no AMap key is configured', async () => {
    setAmapKey(undefined)
    const { getByTestId } = await act(async () => render(<MapViewAuto />))
    expect(getByTestId('leaflet-fallback')).toBeTruthy()
    expect(loadAMap).not.toHaveBeenCalled()
  })

  it('falls back to Leaflet when the JSAPI fails to load', async () => {
    const boom = Promise.reject(new Error('amap offline'))
    // Mark the rejection handled so vitest's unhandled-rejection detector does
    // not fire before React attaches its own handler; use() still rethrows it.
    boom.catch(() => {})
    vi.mocked(loadAMap).mockReturnValue(boom)
    const { getByTestId } = await act(async () => render(<MapViewAuto />))
    await waitFor(() => expect(getByTestId('leaflet-fallback')).toBeTruthy())
  })

  it('renders the AMap renderer through the lazy boundary when a key exists', async () => {
    await act(async () => render(<MapViewAuto />))
    await waitFor(() => expect(fakeAMap.instances.length).toBe(1))
    // The loader got the key from settings.
    expect(loadAMap).toHaveBeenCalledWith('test-amap-key')
  })
})
