import { useEffect, useRef, useState, useMemo, useCallback, use } from 'react'
import { makeMarkerDraggable } from './markerDrag'
import { CATEGORY_ICON_MAP } from '../shared/categoryIcons'
import { getCached, isLoading, fetchPhoto, onThumbReady, getAllThumbs } from '../../services/photoService'
import { isCustomPlaceImage, photoCacheKey } from './placePhoto'
import { useSettingsStore } from '../../store/settingsStore'
import { useAuthStore } from '../../store/authStore'
import type { Place } from '../../types'
import { DEFAULT_MAP_CENTER, DEFAULT_MAP_ZOOM } from '../../constants/mapDefaults'
import { loadAMap } from './engines/amap/loader'
import { toAMap, fromAMap } from './engines/amap/coords'
import { createPlaceCluster } from './engines/amap/cluster'
import type { PlaceClusterHandle } from './engines/amap/cluster'
import { buildPlaceMarkerElement, buildClusterBubbleElement } from './engines/amap/markerDom'

/**
 * The AMap (高德) renderer — package 02a: basemap + place markers + clustering
 * + interactions. Route lines, reservation overlays and POI layers stay with
 * the other renderers (02b); those props are simply not declared here.
 *
 * Coordinate law (docs/amap/00-constraints.md): TREK is WGS84, AMap is GCJ-02.
 * Every coordinate enters through engines/amap/coords.toAMap and every value
 * leaving to a callback — map clicks, context menu, viewport bbox — has passed
 * through fromAMap first. The callbacks therefore carry the exact contract the
 * Leaflet and GL renderers expose; callers cannot tell the engines apart.
 */

type PlaceWithCoords = Place & { lat: number; lng: number }
type HoverPlace = Place & { category_color?: string | null; category_icon?: string | null; category_name?: string | null }

function hasValidCoords(place: Place): place is PlaceWithCoords {
  return place.lat != null && place.lng != null && Number.isFinite(place.lat) && Number.isFinite(place.lng)
}

// Stable identities for the omitted collection props (see MapViewGL): an inline
// default would allocate per render and re-trigger the effects below.
const NO_PLACES: Place[] = []
const NO_DAY_ORDER: Record<number, number[] | null> = {}

/** Ceiling for programmatic fits, matching the GL renderer's fitBounds maxZoom. */
const MAX_FIT_ZOOM = 15
/** The zoom a single selected place opens at, matching the other renderers. */
const SELECTED_PLACE_MIN_ZOOM = 14

/** A MapsEvent as JSAPI 2.0 delivers it: a GCJ-02 lnglat plus the origin event. */
interface AMapMapsEvent {
  lnglat: { lng: number; lat: number }
  pixel?: { getX(): number; getY(): number }
  originEvent?: MouseEvent | TouchEvent
}

interface Props {
  places: Place[]
  dayPlaces?: Place[]
  selectedPlaceId?: number | null
  onMarkerClick?: (id: number) => void
  hoverDisabled?: boolean
  onMapClick?: (info: { latlng: { lat: number; lng: number } }) => void
  onMapContextMenu?: ((e: { latlng: { lat: number; lng: number }; originalEvent: MouseEvent | TouchEvent }) => void) | null
  center?: [number, number]
  zoom?: number
  fitKey?: number | null
  dayOrderMap?: Record<number, number[] | null>
  leftWidth?: number
  rightWidth?: number
  hasInspector?: boolean
  hasDayDetail?: boolean
  onViewportChange?: (bbox: { south: number; west: number; north: number; east: number }) => void
  onMapReady?: (map: AMap.Map | null) => void
}

export function MapViewAMap({
  places = NO_PLACES,
  dayPlaces = NO_PLACES,
  selectedPlaceId = null,
  onMarkerClick,
  hoverDisabled = false,
  onMapClick,
  onMapContextMenu = null,
  center = DEFAULT_MAP_CENTER,
  zoom = DEFAULT_MAP_ZOOM,
  fitKey = 0,
  dayOrderMap = NO_DAY_ORDER,
  leftWidth = 0,
  rightWidth = 0,
  hasInspector = false,
  hasDayDetail = false,
  onViewportChange,
  onMapReady,
}: Props) {
  const amapKey = useSettingsStore(s => s.settings.amap_js_key || '')
  const placesPhotosEnabled = useAuthStore(s => s.placesPhotosEnabled)
  // Suspends inside MapViewAuto's Suspense — the Leaflet fallback shows while
  // the JSAPI loads — and throws to its ErrorBoundary when the load fails: the
  // same two-layer fallback the GL chunks get. A missing key throws
  // synchronously inside loadAMap; MapViewAuto gates on the key, so reaching
  // that means a wiring bug.
  const AMap = use(loadAMap(amapKey))

  const [photoUrls, setPhotoUrls] = useState<Record<string, string>>(getAllThumbs)
  // Hover tooltip — a cursor-following name/category/address card, matching the
  // Leaflet/GL maps exactly (no anchored popup, no photo thumbnail).
  const [hoverPlace, setHoverPlace] = useState<HoverPlace | null>(null)
  const [hoverPos, setHoverPos] = useState<{ x: number; y: number } | null>(null)
  const hoverIdRef = useRef<number | null>(null)
  // True while the camera moves: markers get rebuilt during the move and
  // re-fire mouseenter under a stationary cursor (#1404).
  const camMovingRef = useRef(false)
  // Incremented once the map (and cluster) exist, so effects that need the map
  // re-run after the build instead of racing it.
  const [mapBuilt, setMapBuilt] = useState(0)

  useEffect(() => { hoverIdRef.current = null; setHoverPlace(null); setHoverPos(null) }, [selectedPlaceId])
  useEffect(() => {
    if (!hoverPlace) return
    const clear = () => { hoverIdRef.current = null; setHoverPlace(null); setHoverPos(null) }
    window.addEventListener('scroll', clear, true)
    return () => window.removeEventListener('scroll', clear, true)
  }, [hoverPlace])

  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<AMap.Map | null>(null)
  const clusterRef = useRef<PlaceClusterHandle | null>(null)
  const onMapReadyRef = useRef(onMapReady)
  onMapReadyRef.current = onMapReady
  const onViewportChangeRef = useRef(onViewportChange)
  onViewportChangeRef.current = onViewportChange
  const onClickRefs = useRef({ marker: onMarkerClick, map: onMapClick, context: onMapContextMenu })
  onClickRefs.current.marker = onMarkerClick
  onClickRefs.current.map = onMapClick
  onClickRefs.current.context = onMapContextMenu
  // Same gate as the Leaflet/GL renderers: HTML5 drag is a pointer feature.
  const markersDraggableRef = useRef(typeof window !== 'undefined' && navigator.maxTouchPoints === 0)

  const validPlaces = useMemo(() => places.filter(hasValidCoords), [places])
  const placeById = useMemo(() => new Map(validPlaces.map(p => [p.id, p])), [validPlaces])

  // Everything the cluster's lazy render callbacks need, re-read at render
  // time — the cluster re-renders marker DOM on map moves, so it must always
  // see the latest selection/photos/callbacks, not the ones from creation.
  const latestRef = useRef({
    placeById,
    photoUrls,
    dayOrderMap,
    selectedPlaceId,
    hoverDisabled,
    markersDraggable: markersDraggableRef.current,
    onMarkerClick,
  })
  latestRef.current = {
    placeById,
    photoUrls,
    dayOrderMap,
    selectedPlaceId,
    hoverDisabled,
    markersDraggable: markersDraggableRef.current,
    onMarkerClick,
  }
  // What the build effect reads at map-creation time. Kept in a ref so the
  // build's dependency list stays [AMap] without suppressing the deps rule:
  // rebuilding the map because `places` changed is exactly what must not happen.
  const buildSnapRef = useRef({ center, zoom, places, dayPlaces })
  buildSnapRef.current = { center, zoom, places, dayPlaces }

  const paddingOpts = useMemo(() => {
    const isMobile = typeof window !== 'undefined' && window.innerWidth < 768
    if (isMobile) return { top: 40, right: 20, bottom: 40, left: 20 }
    const top = 60
    const bottom = hasInspector ? 320 : hasDayDetail ? 280 : 60
    return { top, right: rightWidth + 40, bottom, left: leftWidth + 40 }
  }, [leftWidth, rightWidth, hasInspector, hasDayDetail])

  const clearHover = useCallback(() => {
    hoverIdRef.current = null
    setHoverPlace(null)
    setHoverPos(null)
  }, [])

  // All fit maths lives in AMap's own API (getFitZoomAndCenterByBounds) with the
  // same panel padding the other renderers apply. `avoid` is 上、下、左、右 per
  // the JSAPI docs — a different order than the padding box.
  const fitToTargets = useCallback((targets: Place[]) => {
    const map = mapRef.current
    if (!map) return
    const gcj = targets.filter(hasValidCoords).map(p => toAMap(p))
    if (gcj.length === 0) return
    const lngs = gcj.map(c => c[0])
    const lats = gcj.map(c => c[1])
    const bounds = new AMap.Bounds(
      [Math.min(...lngs), Math.min(...lats)],
      [Math.max(...lngs), Math.max(...lats)],
    )
    const avoid = [paddingOpts.top, paddingOpts.bottom, paddingOpts.left, paddingOpts.right]
    const [fitZoom, fitCenter] = map.getFitZoomAndCenterByBounds(bounds, avoid, MAX_FIT_ZOOM) as [number, AMap.LngLat]
    if (typeof fitZoom === 'number' && fitCenter) map.setZoomAndCenter(fitZoom, fitCenter, false, 400)
  }, [AMap, paddingOpts])

  // ── Map + cluster lifecycle ────────────────────────────────────────────────
  useEffect(() => {
    const container = containerRef.current
    if (!container || !AMap) return
    const snapshot = buildSnapRef.current

    const map = new AMap.Map(container, {
      viewMode: '2D',
      zoom: snapshot.zoom,
      center: toAMap({ lat: snapshot.center[0], lng: snapshot.center[1] }),
    })
    mapRef.current = map
    ;(window as Window & { __trek_map?: AMap.Map }).__trek_map = map
    // Deliberately NOT handed to onMapReady: the only caller-side consumer
    // (TripPlannerPage's compass pill) expects the GL map API (getBearing /
    // rotate), and the Leaflet renderer sets the precedent of never handing
    // its map over. AMap 2D has no rotation to show, so the pill stays hidden
    // here exactly as it does under Leaflet. Cleanup still passes null — the
    // GL convention — so caller state resets uniformly.

    // "Add place here": the tap that ends a long-press must not also count as a
    // normal map click (#1398).
    let suppressNextClick = false
    let lastContextFire = 0
    const fireContext = (lnglat: { lng: number; lat: number }, originalEvent: MouseEvent | TouchEvent): boolean => {
      // A native contextmenu firing over our own timer would open the form twice.
      if (Date.now() - lastContextFire < 700) return false
      lastContextFire = Date.now()
      const wgs = fromAMap(lnglat)
      onClickRefs.current.context?.({ latlng: { lat: wgs.lat, lng: wgs.lng }, originalEvent })
      return true
    }

    const onMapClick = (e: AMapMapsEvent) => {
      if (suppressNextClick) { suppressNextClick = false; return }
      // Markers and cluster bubbles have bubble: false (AMap default), so a
      // click on them never reaches the map — nothing to filter here.
      const wgs = fromAMap(e.lnglat)
      onClickRefs.current.map?.({ latlng: { lat: wgs.lat, lng: wgs.lng } })
    }
    map.on('click', onMapClick)

    const onRightClick = (e: AMapMapsEvent) => {
      const original = e.originEvent ?? new MouseEvent('contextmenu')
      fireContext(e.lnglat, original)
    }
    map.on('rightclick', onRightClick)

    // Viewport bbox on pan/zoom + once when the basemap completes, so the
    // POI-explore pill can fetch OSM places for the visible area. Corners
    // leave in WGS84 — they feed OSM queries, not AMap.
    const emitViewport = () => {
      const b = map.getBounds()
      const sw = fromAMap(b.getSouthWest())
      const ne = fromAMap(b.getNorthEast())
      onViewportChangeRef.current?.({ south: sw.lat, west: sw.lng, north: ne.lat, east: ne.lng })
    }
    map.on('moveend', emitViewport)
    // The typings model once() as on()'s fourth argument — same runtime call.
    map.on('complete', emitViewport, undefined, true)

    // Clear the hover card as the camera starts moving and keep it suppressed
    // until the move ends (#1404).
    const onCamStart = () => { camMovingRef.current = true; clearHover() }
    const onCamEnd = () => { camMovingRef.current = false }
    map.on('movestart', onCamStart)
    map.on('moveend', onCamEnd)

    // Touch long-press: 600 ms hold with a 10 px move tolerance (Leaflet's
    // tapHold feel; neither AMap nor the DOM synthesizes a contextmenu for it).
    let lpTimer: number | null = null
    let lpStart: { x: number; y: number } | null = null
    const cancelLongPress = () => {
      if (lpTimer !== null) window.clearTimeout(lpTimer)
      lpTimer = null
      lpStart = null
    }
    const onTouchStart = (ev: TouchEvent) => {
      // A fresh gesture clears a stale suppression flag so it can never eat a
      // later real tap.
      suppressNextClick = false
      if (ev.touches.length !== 1) { cancelLongPress(); return }
      if ((ev.target as HTMLElement).closest('.trek-amap-marker, .trek-amap-cluster')) return
      const t = ev.touches[0]
      lpStart = { x: t.clientX, y: t.clientY }
      lpTimer = window.setTimeout(() => {
        lpTimer = null
        const start = lpStart
        lpStart = null
        if (!start) return
        const rect = container.getBoundingClientRect()
        const lnglat = map.containerToLngLat([start.x - rect.left, start.y - rect.top])
        // Only suppress the tap when OUR fire opened the form — if the dedupe
        // window swallowed this fire, no click needs suppressing.
        if (fireContext(lnglat, ev)) suppressNextClick = true
      }, 600)
    }
    const onTouchMove = (ev: TouchEvent) => {
      const t = ev.touches[0]
      if (lpStart && (!t || Math.hypot(t.clientX - lpStart.x, t.clientY - lpStart.y) > 10)) cancelLongPress()
    }
    container.addEventListener('touchstart', onTouchStart, { passive: true })
    container.addEventListener('touchmove', onTouchMove, { passive: true })
    container.addEventListener('touchend', cancelLongPress)
    container.addEventListener('touchcancel', cancelLongPress)

    const cluster = createPlaceCluster(AMap, map, {
      renderMarker: (placeId, marker) => {
        const latest = latestRef.current
        const place = latest.placeById.get(placeId)
        if (!place) return
        const pck = photoCacheKey(place)
        // A custom uploaded image wins over the auto-fetched thumb (see #1136).
        const photoUrl = isCustomPlaceImage(place.image_url) ? place.image_url! : ((pck && latest.photoUrls[pck]) || place.image_url || null)
        const orderNumbers = latest.dayOrderMap[place.id] ?? null
        const selected = place.id === latest.selectedPlaceId
        const el = buildPlaceMarkerElement(place, photoUrl, orderNumbers, selected)
        if (latest.markersDraggable) makeMarkerDraggable(el, place.id)
        el.addEventListener('click', (ev) => {
          ev.stopPropagation()
          // Clear the card right away: the recenter that follows moves the
          // marker out from under the cursor, so no mouseleave fires (#1404).
          hoverIdRef.current = null
          setHoverPlace(null)
          setHoverPos(null)
          latest.onMarkerClick?.(place.id)
        })
        el.addEventListener('mouseenter', (ev) => {
          if (latest.hoverDisabled || camMovingRef.current) return
          hoverIdRef.current = place.id
          setHoverPlace(place)
          setHoverPos({ x: ev.clientX, y: ev.clientY })
        })
        el.addEventListener('mousemove', (ev) => {
          if (latest.hoverDisabled || camMovingRef.current) return
          setHoverPos({ x: ev.clientX, y: ev.clientY })
        })
        el.addEventListener('mouseleave', () => {
          if (latest.hoverDisabled) return
          hoverIdRef.current = null
          setHoverPlace(null)
          setHoverPos(null)
        })
        marker.setContent(el)
        marker.setAnchor('center')
      },
      renderClusterMarker: (count, marker) => {
        marker.setContent(buildClusterBubbleElement(count))
      },
    })
    clusterRef.current = cluster

    // Open framed on the places when there are any (a trip in Japan shows Japan
    // straight away, no world-view flash). Running through the same fit path as
    // later fits keeps every camera decision in AMap's own zoom scale.
    const initialTargets = snapshot.dayPlaces.length > 0 ? snapshot.dayPlaces : snapshot.places
    const framedOnMount = initialTargets.some(hasValidCoords)
    if (framedOnMount) fitToTargets(initialTargets)
    framedOnMountRef.current = framedOnMount
    setMapBuilt(n => n + 1)

    return () => {
      setMapBuilt(0)
      cluster.destroy()
      clusterRef.current = null
      container.removeEventListener('touchstart', onTouchStart)
      container.removeEventListener('touchmove', onTouchMove)
      container.removeEventListener('touchend', cancelLongPress)
      container.removeEventListener('touchcancel', cancelLongPress)
      cancelLongPress()
      map.off('click', onMapClick)
      map.off('rightclick', onRightClick)
      map.off('moveend', emitViewport)
      map.off('complete', emitViewport)
      map.off('movestart', onCamStart)
      map.off('moveend', onCamEnd)
      onMapReadyRef.current?.(null)
      // AMap's own teardown — the skill mandates destroy() on unmount (WebGL
      // context leak otherwise).
      try { map.destroy() } catch { /* already gone */ }
      // Same identity check as the GL cleanup: a freshly built map stays.
      const debugHandle = window as Window & { __trek_map?: AMap.Map | null }
      if (debugHandle.__trek_map === map) delete debugHandle.__trek_map
      mapRef.current = null
      hoverIdRef.current = null
      setHoverPlace(null)
      setHoverPos(null)
    }
  }, [AMap, clearHover, fitToTargets])

  // ── Cluster data ───────────────────────────────────────────────────────────
  // Any membership / selection / day order / photo change re-feeds the cluster;
  // setData re-runs the render callbacks, so the visible marker DOM picks the
  // new state up through latestRef without rebuilding the cluster itself.
  useEffect(() => {
    const cluster = clusterRef.current
    if (!cluster) return
    cluster.setData(validPlaces.map(p => ({ lnglat: toAMap(p), weight: 1, placeId: p.id })))
  }, [mapBuilt, validPlaces, selectedPlaceId, dayOrderMap, photoUrls])

  // ── Photo loading — mirrors the Leaflet/GL effect ──────────────────────────
  const pendingThumbsRef = useRef<Record<string, string>>({})
  const thumbRafRef = useRef<number | null>(null)
  useEffect(() => {
    if (!places || places.length === 0 || !placesPhotosEnabled) return
    const cleanups: (() => void)[] = []

    const setThumb = (cacheKey: string, thumb: string) => {
      pendingThumbsRef.current[cacheKey] = thumb
      if (thumbRafRef.current !== null) return
      thumbRafRef.current = requestAnimationFrame(() => {
        thumbRafRef.current = null
        const pending = pendingThumbsRef.current
        pendingThumbsRef.current = {}
        setPhotoUrls(prev => {
          const hasChange = Object.entries(pending).some(([k, v]) => prev[k] !== v)
          return hasChange ? { ...prev, ...pending } : prev
        })
      })
    }

    for (const place of places) {
      // A custom uploaded image is shown directly — never auto-fetch a provider
      // photo for it; the request would 404 for OSM-only places and the fetched
      // thumb would shadow the user's own image (#1136).
      if (isCustomPlaceImage(place.image_url)) continue
      const cacheKey = photoCacheKey(place)
      if (!cacheKey) continue
      const cached = getCached(cacheKey)
      if (cached?.thumbDataUrl) {
        setThumb(cacheKey, cached.thumbDataUrl)
        continue
      }
      cleanups.push(onThumbReady(cacheKey, thumb => setThumb(cacheKey, thumb)))
      if (!cached && !isLoading(cacheKey)) {
        const photoId =
          (place.image_url?.startsWith('/api/maps/place-photo/') ? place.image_url : null)
          || place.google_place_id
          || place.osm_id
          || place.image_url
        if (photoId || (place.lat && place.lng)) {
          fetchPhoto(cacheKey, photoId || `coords:${place.lat}:${place.lng}`, place.lat, place.lng, place.name)
        }
      }
    }

    return () => {
      cleanups.forEach(fn => fn())
      if (thumbRafRef.current !== null) {
        cancelAnimationFrame(thumbRafRef.current)
        thumbRafRef.current = null
      }
    }
  }, [places, placesPhotosEnabled])

  // ── Fit (fitKey) ───────────────────────────────────────────────────────────
  // New fitKey (trip fit or a day selection) → fit that day's (or all) places.
  // No route handling here yet — routes arrive with 02b, like the GL renderer's
  // pending-route re-fit.
  const prevFitKey = useRef<number | null>(-1)
  const fitRanRef = useRef(false)
  const framedOnMountRef = useRef(false)
  useEffect(() => {
    if (mapBuilt === 0) return
    if (fitKey === prevFitKey.current) return
    // The map opened framed on these very places — re-fitting would only redo
    // that at a harsher maxZoom (Leaflet BoundsController's rule). Later fits
    // (picking a day) still run.
    if (!fitRanRef.current && framedOnMountRef.current) {
      fitRanRef.current = true
      prevFitKey.current = fitKey
      return
    }
    fitRanRef.current = true
    prevFitKey.current = fitKey
    fitToTargets(dayPlaces.length > 0 ? dayPlaces : places)
  }, [fitKey, mapBuilt, fitToTargets, places, dayPlaces])

  // ── Recentre on the selected place ─────────────────────────────────────────
  const prevSelectedRef = useRef<number | null>(null)
  useEffect(() => {
    if (mapBuilt === 0) { prevSelectedRef.current = selectedPlaceId; return }
    const changed = selectedPlaceId !== prevSelectedRef.current
    prevSelectedRef.current = selectedPlaceId
    const map = mapRef.current
    if (!changed || !map || !selectedPlaceId) return
    const target = places.find(p => p.id === selectedPlaceId) || dayPlaces.find(p => p.id === selectedPlaceId)
    if (!target || !hasValidCoords(target)) return
    const gcj = toAMap(target)
    const nextZoom = Math.max(map.getZoom(), SELECTED_PLACE_MIN_ZOOM)
    // Offset the centre by half the padding delta so the pin lands in the
    // middle of the *visible* area — Leaflet SelectionController's projection
    // maths, done in container pixels since AMap has no padded flyTo.
    const px = map.lngLatToContainer(gcj)
    const shifted = map.containerToLngLat([
      px.getX() + (paddingOpts.right - paddingOpts.left) / 2,
      px.getY() + (paddingOpts.bottom - paddingOpts.top) / 2,
    ])
    map.setZoomAndCenter(nextZoom, shifted, false, 400)
  }, [selectedPlaceId, mapBuilt, places, dayPlaces, paddingOpts])

  // ── External center/zoom prop changes — jump without animation ─────────────
  const jumpedToRef = useRef<[number, number] | null>(null)
  const [centerLat, centerLng] = center
  useEffect(() => {
    const map = mapRef.current
    if (mapBuilt === 0 || !map) return
    // Not on mount: the map was just built framed on its places (see GL), and
    // jumping to the prop centre here would throw that away.
    const previous = jumpedToRef.current
    jumpedToRef.current = [centerLat, centerLng]
    if (!previous || (previous[0] === centerLat && previous[1] === centerLng)) return
    map.setZoomAndCenter(zoom, toAMap({ lat: centerLat, lng: centerLng }), true)
  }, [centerLat, centerLng, zoom, mapBuilt])

  const HoverIcon = (hoverPlace?.category_icon && CATEGORY_ICON_MAP[hoverPlace.category_icon]) || CATEGORY_ICON_MAP['MapPin']

  return (
    <div className="w-full h-full relative">
      <div ref={containerRef} className="w-full h-full" />
      {/* Hover tooltip — cursor-following name/category/address card, identical
          to the Leaflet/GL overlays (no anchored popup, no photo). */}
      {!hoverDisabled && hoverPlace && hoverPos && (
        <div data-testid="tooltip" style={{
          position: 'fixed',
          left: hoverPos.x + 14,
          top: hoverPos.y - 10,
          zIndex: 9999,
          pointerEvents: 'none',
          background: 'white',
          borderRadius: 8,
          boxShadow: '0 2px 10px rgba(0,0,0,0.15)',
          padding: '6px 10px',
          fontFamily: 'var(--font-system)',
          maxWidth: 220,
          whiteSpace: 'nowrap',
        }}>
          <div style={{ fontWeight: 600, fontSize: 12, color: '#111827', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {hoverPlace.name}
          </div>
          {hoverPlace.category_name && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 3, marginTop: 1 }}>
              <HoverIcon size={10} style={{ color: hoverPlace.category_color || '#6b7280', flexShrink: 0 }} />
              <span style={{ fontSize: 11, color: '#6b7280' }}>{hoverPlace.category_name}</span>
            </div>
          )}
          {hoverPlace.address && (
            <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {hoverPlace.address}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
