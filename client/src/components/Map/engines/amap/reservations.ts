/**
 * Reservation / transport overlay for the AMap renderer — the imperative twin
 * of ReservationOverlay.tsx (Leaflet) and ReservationMapboxOverlay
 * (reservationsMapbox.ts). Geometry decisions are shared, not reimplemented:
 *
 * - booking → drawable items: `buildItems` from reservationsMapbox.ts (the one
 *   implementation of waypoint ordering, per-leg arcs, duration/distance math);
 * - great-circle sampling + antimeridian unwrap: `flightGeodesy.ts`
 *   (engine-agnostic pure math);
 * - transit real-path segments: `getTransitMapSegments` (transitGeometry.ts).
 *
 * This file only decides the AMap-specific rendering: AMap.Polyline styling
 * (status dash/opacity), the endpoint pills as DOM markers, and the
 * endpoint-proximity declutter (measured on converted GCJ-02 positions through
 * the map's own pixel projection, like the other renderers).
 *
 * Coordinates: everything arriving from the app is WGS84 and goes through
 * engines/amap/coords.toAMap before it reaches an AMap constructor. Arcs that
 * cross the antimeridian keep their unwrapped longitudes — points beyond ±180
 * are outside the China box so the coordinate transform is identity there and
 * the unwrap survives intact.
 */
import type { AMapNamespace } from './loader'
import { toAMap } from './coords'
import { buildItems, TYPE_META, TRANSPORT_COLOR } from '../../reservationsMapbox'
import type { TransportItem, TransportType } from '../../reservationsMapbox'
import { getTransitMapSegments } from '../../transitGeometry'
import { cleanEndpointName } from '../../reservationName'
import { renderIconMarkup } from '../../../../utils/iconMarkup'
import { createElement } from 'react'
import type { Reservation } from '../../../../types'

export interface ReservationOverlayOptions {
  showConnections: boolean
  /** Accepted for call-site parity with the GL overlay; nothing renders from it. */
  showStats: boolean
  showEndpointLabels: boolean
  onEndpointClick?: (reservationId: number) => void
}

/** Visual z-order of the transport lines: above routes, under DOM markers. */
const LINE_Z_INDEX = 14
const CASING_Z_INDEX = 13
/** Endpoint proximity thresholds, mirroring the Leaflet/GL declutter (px). */
const MIN_PX_BY_TYPE: Partial<Record<TransportType, number>> = { flight: 50, cruise: 150, car: 80 }
const LABEL_MIN_PX_BY_TYPE: Partial<Record<TransportType, number>> = { flight: 50, cruise: 300, car: 150, transit: 900 }

/** Stroke dash for a pending booking / a walk leg, in AMap dasharray form. */
const PENDING_DASH: [number, number] = [3, 3]
const WALK_DASH: [number, number] = [1, 4]

export class ReservationAmapOverlay {
  private map: AMap.Map
  private AMap: AMapNamespace
  private items: TransportItem[] = []
  private opts: ReservationOverlayOptions
  private roadRoutes: Map<number, [number, number][]> = new Map()
  private lines: AMap.Polyline[] = []
  private endpointMarkers: AMap.Marker[] = []
  private destroyed = false

  constructor(AMap: AMapNamespace, map: AMap.Map, opts: ReservationOverlayOptions) {
    this.AMap = AMap
    this.map = map
    this.opts = opts
  }

  update(reservations: Reservation[], opts: ReservationOverlayOptions, roadRoutes?: Map<number, [number, number][]>) {
    if (this.destroyed) return
    this.opts = opts
    this.items = buildItems(reservations)
    this.roadRoutes = roadRoutes ?? new Map()
    this.render()
  }

  destroy() {
    this.destroyed = true
    this.map.remove(this.lines)
    this.lines = []
    this.map.remove(this.endpointMarkers)
    this.endpointMarkers = []
  }

  /** Screen distance between two converted GCJ-02 positions, in container px. */
  private pixelDistance(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
    const pa = this.map.lngLatToContainer(toAMap(a))
    const pb = this.map.lngLatToContainer(toAMap(b))
    return Math.hypot(pa.getX() - pb.getX(), pa.getY() - pb.getY())
  }

  private render() {
    const show = this.opts.showConnections

    const visibleItems = show
      ? this.items.filter(item => {
          try {
            // Transit draws its real alignment, not a from→to straight, so the
            // endpoint-proximity rule must not hide it when zoomed out (#1570).
            if (item.type === 'transit' && getTransitMapSegments(item.res).length > 0) return true
            return this.pixelDistance(item.from, item.to) >= (MIN_PX_BY_TYPE[item.type] ?? 200)
          } catch {
            return true
          }
        })
      : []

    const labelVisibleIds = new Set<number>()
    if (show) {
      for (const item of visibleItems) {
        try {
          if (this.pixelDistance(item.from, item.to) >= (LABEL_MIN_PX_BY_TYPE[item.type] ?? 400)) {
            labelVisibleIds.add(item.res.id)
          }
        } catch { /* ignore */ }
      }
    }

    this.map.remove(this.lines)
    this.lines = []
    this.map.remove(this.endpointMarkers)
    this.endpointMarkers = []
    if (!show) return

    const polylines: AMap.Polyline[] = []
    for (const item of visibleItems) {
      const pending = (item.res.status ?? 'pending') !== 'confirmed'
      const transitSegs = item.type === 'transit' ? getTransitMapSegments(item.res) : []

      if (transitSegs.length > 0) {
        for (const seg of transitSegs) {
          const path = seg.coords.map(([lat, lng]) => toAMap({ lat, lng }))
          if (path.length < 2) continue
          if (!seg.walk) {
            // White casing under coloured transit paths (GL parity).
            polylines.push(new this.AMap.Polyline({
              path, zIndex: CASING_Z_INDEX, bubble: false,
              strokeColor: '#ffffff', strokeWeight: 6, strokeOpacity: 0.85,
              lineJoin: 'round', lineCap: 'round',
            }))
          }
          polylines.push(new this.AMap.Polyline({
            path, zIndex: LINE_Z_INDEX, bubble: false,
            strokeColor: seg.walk ? '#64748b' : (seg.color || '#7c3aed'),
            strokeWeight: seg.walk ? 3 : 3.5,
            strokeOpacity: 0.95,
            strokeStyle: seg.walk ? 'dashed' : 'solid',
            ...(seg.walk ? { strokeDasharray: WALK_DASH } : {}),
            lineJoin: 'round', lineCap: 'round',
          }))
        }
        continue
      }

      // Prefer the real road route (car/bus/taxi/bicycle) over the straight arc.
      const road = this.roadRoutes.get(item.res.id)
      const legs = road && road.length >= 2 ? [road] : item.arcs
      for (const leg of legs) {
        const path = leg.map(([lat, lng]) => toAMap({ lat, lng }))
        if (path.length < 2) continue
        polylines.push(new this.AMap.Polyline({
          path, zIndex: LINE_Z_INDEX, bubble: false,
          strokeColor: TRANSPORT_COLOR,
          strokeWeight: 2.5,
          strokeOpacity: pending ? 0.55 : 0.75,
          strokeStyle: pending ? 'dashed' : 'solid',
          ...(pending ? { strokeDasharray: PENDING_DASH } : {}),
          lineJoin: 'round', lineCap: 'round',
        }))
      }
    }
    if (polylines.length > 0) {
      this.map.add(polylines)
      this.lines = polylines
    }

    for (const item of visibleItems) {
      const showLabel = this.opts.showEndpointLabels && labelVisibleIds.has(item.res.id)
      for (const ep of item.waypoints) {
        const label = showLabel ? (ep.code || cleanEndpointName(ep.name)) : null
        const el = buildEndpointPill(item.type, label)
        el.title = ep.name || ''
        el.addEventListener('click', (ev) => {
          ev.stopPropagation()
          this.opts.onEndpointClick?.(item.res.id)
        })
        const marker = new this.AMap.Marker({
          position: toAMap(ep), content: el, anchor: 'center', zIndex: 30,
        })
        this.map.add(marker)
        this.endpointMarkers.push(marker)
      }
    }
  }
}

/** The rounded transport pill an endpoint carries (icon + optional code label). */
function buildEndpointPill(type: TransportType, label: string | null): HTMLDivElement {
  const { icon: Icon } = TYPE_META[type]
  const wrap = document.createElement('div')
  wrap.style.cssText = 'display:inline-block;cursor:pointer;'
  const pill = document.createElement('div')
  // Map-internal chrome: literal colors, per the theme-lint exemption for
  // injected map HTML (theme-lint-disable is the sanctioned escape, and the
  // marker builder file this mirrors is already on the exempt list).
  pill.style.cssText = [
    'display:inline-flex;align-items:center;justify-content:center;gap:4px',
    'padding:0 8px;border-radius:999px',
    `background:${TRANSPORT_COLOR};box-shadow:0 2px 6px rgba(0,0,0,0.25)`,
    'border:1.5px solid #fff;color:#fff',
    'font-family:var(--font-system);font-size:11px;font-weight:600;letter-spacing:0.3px;line-height:1',
    'box-sizing:border-box;height:22px;white-space:nowrap',
  ].join(';')
  const icon = document.createElement('span')
  icon.innerHTML = renderIconMarkup(createElement(Icon, { size: 13, color: 'white', strokeWidth: 2.5 }))
  pill.appendChild(icon)
  if (label) {
    const text = document.createElement('span')
    text.textContent = label // endpoint codes/names are user content
    pill.appendChild(text)
  }
  wrap.appendChild(pill)
  return wrap
}

