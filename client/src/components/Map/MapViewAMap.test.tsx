import React, { Suspense } from 'react'
import type { ComponentProps } from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, act } from '@testing-library/react'
import { resetAllStores } from '../../../tests/helpers/store'
import { buildPlace } from '../../../tests/helpers/factories'
import { useSettingsStore } from '../../store/settingsStore'

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
    lngLatToContainer: vi.fn(() => ({ getX: () => 300, getY: () => 200 })),
    containerToLngLat: vi.fn((pixel: [number, number]) => {
      state.containerToLngLatCalls.push(pixel)
      return { lng: 116.39, lat: 39.908 }
    }),
    getContainer: vi.fn(() => document.createElement('div')),
    destroy: vi.fn(() => { state.destroyed = true }),
    reset() {
      state.handlers = {}
      state.bounds = null
      state.fitCalls = []
      state.zoomAndCenterCalls = []
      state.containerToLngLatCalls = []
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
  const AMap = {
    Map: vi.fn(function () {
      return fakeMap.map
    }),
    Bounds: vi.fn(function (sw: unknown, ne: unknown) {
      const b = { sw, ne }
      boundsCtors.push(b)
      return b
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
  return { AMap, instances, boundsCtors }
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
