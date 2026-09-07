import { Suspense } from 'react'
import { useSettingsStore } from '../../store/settingsStore'
import { MapView } from './MapView'
import ErrorBoundary from '../shared/ErrorBoundary'
import { MapViewGLMapbox, MapViewGLMaplibre } from './glLazy'
import { MapViewAMapLazy } from './amapLazy'

// Auto-selects the map renderer based on user settings. Keeps the existing
// Leaflet MapView untouched so the Mapbox GL variant can mature iteratively
// behind a toggle. Atlas is not affected — it imports Leaflet directly.
//
// Offline maps: only the Leaflet renderer supports full pre-download (raster
// tiles via sync/tilePrefetcher.ts). GL maps are best-effort offline — their
// vector tiles are cached opportunistically by the Service Worker as you view
// them online (see the GL tile rules in vite.config.js), not prefetched. AMap
// (高德) is never cached at all: its terms forbid storing its service data,
// so its Service Worker rule is NetworkOnly and the tile prefetcher skips it.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function MapViewAuto(props: any) {
  const provider = useSettingsStore(s => s.settings.map_provider)
  const token = useSettingsStore(s => s.settings.mapbox_access_token)
  const amapKey = useSettingsStore(s => s.settings.amap_js_key)
  // Fall back to Leaflet when Mapbox is selected but no token is set,
  // so trip planner never shows an empty map due to a missing token.
  const glProvider = provider === 'maplibre-gl' ? 'maplibre-gl'
    : provider === 'mapbox-gl' && token ? 'mapbox-gl'
    : null
  // One chunk per engine: picking the binding here is what keeps mapbox-gl and
  // maplibre-gl out of each other's downloads.
  const MapViewGL = glProvider === 'maplibre-gl' ? MapViewGLMaplibre : MapViewGLMapbox
  if (glProvider) {
    // Render the previous Leaflet map as the fallback so there's no blank flash
    // while the GL chunk loads on first use.
    return (
      // Outside the Suspense on purpose: Suspense handles the pending promise,
      // a rejected one (chunk gone after a deploy) throws past it. Falling back
      // to Leaflet keeps a usable map instead of an error card.
      // resetKeys: with two engine chunks, a failure under one provider must not
      // keep showing Leaflet after the user switches to the other.
      <ErrorBoundary boundaryId="map:gl" resetKeys={[glProvider]} fallback={<MapView {...props} />}>
        <Suspense fallback={<MapView {...props} />}>
          <MapViewGL {...props} glProvider={glProvider} />
        </Suspense>
      </ErrorBoundary>
    )
  }
  // AMap (高德): same shape as the GL branch — same rule for a missing key
  // (no key, no AMap; Leaflet keeps the planner usable), the same Leaflet
  // fallback while the engine loads, and the same rejection path if the
  // JSAPI fails to load. resetKeys re-attempts on a key change.
  if (provider === 'amap') {
    if (!amapKey) return <MapView {...props} />
    return (
      <ErrorBoundary boundaryId="map:amap" resetKeys={[amapKey]} fallback={<MapView {...props} />}>
        <Suspense fallback={<MapView {...props} />}>
          <MapViewAMapLazy {...props} />
        </Suspense>
      </ErrorBoundary>
    )
  }
  return <MapView {...props} />
}
