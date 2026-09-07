/// <reference types="@amap/amap-jsapi-types" />
/**
 * JSAPI loader wrapper — the single way the AMap SDK enters the app.
 *
 * The loader is a ~2 kB script-injector, not the SDK itself: the multi-hundred-KB
 * JSAPI arrives at runtime from webapi.amap.com, so there is nothing worth
 * chunk-splitting here — what keeps AMap out of other providers' downloads is
 * that only MapViewAMap (an amapLazy chunk) statically imports this module.
 *
 * Behaviour pinned here, once, for every future caller:
 * - Singleton: concurrent and repeat calls join one load. A rejected load
 *   clears the singleton so a provider re-switch retries instead of replaying
 *   the cached rejection forever.
 * - Proxy security mode ONLY: `serviceHost` points at this site's
 *   `/_AMapService` prefix (fixed by AMap; the forwarding route is package 03).
 *   The securityJsCode never reaches the browser (docs/amap/00-constraints.md).
 * - Plugins are declared here, on demand: AMap.MarkerCluster is the only one
 *   package 02a needs. Add a plugin to this list when a feature loads it —
 *   nowhere else.
 * - The amap-jsapi-skill example sets `AMap.getConfig().appname`; deliberately
 *   dropped (project-owner decision, 2026-09-08): installs identify themselves
 *   to AMap with the key alone.
 */
import AMapLoader from '@amap/amap-jsapi-loader'

/** The AMap namespace, once loaded. Declared globally by @amap/amap-jsapi-types. */
export type AMapNamespace = typeof AMap

/** Plugins 02a needs. Keep this list exactly as long as the features using them. */
const REQUIRED_PLUGINS = ['AMap.MarkerCluster']

let loaderPromise: Promise<AMapNamespace> | null = null

export function loadAMap(key: string): Promise<AMapNamespace> {
  if (!loaderPromise) {
    // Must be set BEFORE the first load call (skill: references/security.md).
    // `/_AMapService` is the fixed prefix the JSAPI appends proxy requests to;
    // same-origin so it works behind any reverse proxy a self-hosted install
    // already has.
    ;(window as Window & { _AMapSecurityConfig?: AMapSecurityConfig })._AMapSecurityConfig = {
      serviceHost: `${window.location.origin}/_AMapService`,
    }
    loaderPromise = AMapLoader.load({ key, version: '2.0', plugins: REQUIRED_PLUGINS }).then(
      (AMap) => AMap as AMapNamespace,
    )
    loaderPromise.catch(() => {
      loaderPromise = null
    })
  }
  return loaderPromise
}

/** Test hook: forget the singleton so the next load call starts fresh. */
export function resetAMapLoader(): void {
  loaderPromise = null
}

/** The security config the JSAPI reads off window before loading. */
interface AMapSecurityConfig {
  /**
   * Proxy mode (production): requests go to this host with the jscode appended
   * server-side. `securityJsCode` also exists on this config in plaintext mode
   * (development only per the skill) — deliberately not a field here, so the
   * type system cannot be talked into shipping the secret to a browser.
   */
  serviceHost: string
}

declare global {
  interface Window {
    _AMapSecurityConfig?: AMapSecurityConfig
  }
}
