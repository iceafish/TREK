/**
 * AMap.MarkerCluster gateway — the one place the amap engine talks to the
 * cluster plugin.
 *
 * @amap/amap-jsapi-types ships the v1.4 shape of this class (constructor takes
 * Marker[], no render callbacks, no data array). That does not describe the
 * JSAPI 2.0 plugin the loader loads, so the local interfaces below pin the 2.0
 * surface this engine uses — per references/api/marker.md in the AMap skill —
 * and the engine keeps compiling without `any`. When the type package catches
 * up, these can shrink back to an import.
 *
 * Identity resolution: the 2.0 plugin hands `renderMarker` a bare positioned
 * marker with no back-reference to the data item. The exact lnglat of each
 * point we passed in IS that back-reference, so this module indexes points by
 * position and hands the renderer a placeId — the renderer never duplicates
 * that lookup.
 */
import type { AMapNamespace } from './loader'
import type { AMapLngLat } from './coords'

/** A point fed to the cluster: GCJ-02 lnglat (already through coords.toAMap) + its place. */
export interface ClusterPoint {
  lnglat: AMapLngLat
  weight: number
  placeId: number
}

/** The subset of AMap.Marker the render callbacks may touch. */
export interface ClusterMarkerLike {
  getPosition(): { getLng(): number; getLat(): number } | null
  setContent(content: HTMLElement | string): void
  setAnchor(anchor: string): void
}

interface RenderClusterMarkerObject {
  count: number
  marker: ClusterMarkerLike
}

interface ClusterClickInfo {
  cluster?: { clusterData?: Array<{ lnglat: AMapLngLat | { lng: number; lat: number } }> | null } | null
  lnglat?: { lng: number; lat: number } | null
}

export interface PlaceClusterHandlers {
  renderMarker: (placeId: number, marker: ClusterMarkerLike) => void
  renderClusterMarker: (count: number, marker: ClusterMarkerLike) => void
}

export interface PlaceClusterHandle {
  setData(points: ClusterPoint[]): void
  destroy(): void
}

/** Matches the Leaflet renderer's maxClusterRadius (30) and GL's clusterMaxZoom (10). */
const GRID_SIZE = 30
const MAX_CLUSTER_ZOOM = 10

export function createPlaceCluster(
  AMap: AMapNamespace,
  map: AMap.Map,
  handlers: PlaceClusterHandlers,
): PlaceClusterHandle {
  let placeByPosKey = new Map<string, number>()

  const posKey = (lng: number, lat: number): string => `${lng.toFixed(6)}:${lat.toFixed(6)}`

  const options = {
    gridSize: GRID_SIZE,
    maxZoom: MAX_CLUSTER_ZOOM,
    // Leaflet's cluster bubble sits at the mean of its children; match that.
    averageCenter: true,
    renderMarker: (ctx: { marker: ClusterMarkerLike }) => {
      const pos = ctx.marker.getPosition()
      if (!pos) return
      const placeId = placeByPosKey.get(posKey(pos.getLng(), pos.getLat()))
      if (placeId != null) handlers.renderMarker(placeId, ctx.marker)
    },
    renderClusterMarker: (o: RenderClusterMarkerObject) => {
      o.marker.setAnchor('center')
      handlers.renderClusterMarker(o.count, o.marker)
    },
  }

  // The JSAPI 2.0 constructor: (map, data points, options). Typed locally —
  // see the header — and reached through a structural extension of the
  // namespace because the shipped typings only carry the v1.4 class.
  interface MarkerClusterInstance {
    setData(data: ClusterPoint[]): void
    setMap(map: AMap.Map | null): void
    on(type: 'click', fn: (info: ClusterClickInfo) => void): void
  }
  type MarkerClusterCtor = new (
    map: AMap.Map,
    data: ClusterPoint[],
    opts: typeof options,
  ) => MarkerClusterInstance

  const ClusterCtor = (AMap as AMapNamespace & { MarkerCluster: MarkerClusterCtor }).MarkerCluster
  const cluster = new ClusterCtor(map, [], options)

  // 点击聚合点缩放展开. Fit the cluster's own points with the same capped,
  // padding-aware fit the day fit uses — a blind +2 zoom can leave children
  // half-out of frame on a wide cluster.
  cluster.on('click', (info) => {
    const data = info.cluster?.clusterData
    if (!data || data.length < 2) return
    const lngs = data.map((d) => (Array.isArray(d.lnglat) ? d.lnglat[0] : d.lnglat.lng))
    const lats = data.map((d) => (Array.isArray(d.lnglat) ? d.lnglat[1] : d.lnglat.lat))
    const bounds = new AMap.Bounds(
      [Math.min(...lngs), Math.min(...lats)],
      [Math.max(...lngs), Math.max(...lats)],
    )
    const [zoom, center] = map.getFitZoomAndCenterByBounds(bounds, [40, 40, 40, 40], 15) as [
      number,
      AMap.LngLat,
    ]
    if (typeof zoom === 'number' && center) map.setZoomAndCenter(zoom, center, false, 350)
  })

  return {
    setData(next: ClusterPoint[]) {
      placeByPosKey = new Map(next.map((p) => [posKey(p.lnglat[0], p.lnglat[1]), p.placeId]))
      cluster.setData(next)
    },
    destroy() {
      cluster.setMap(null)
    },
  }
}
