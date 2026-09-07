import { lazyWithRetry } from '../../utils/lazyWithRetry'

/**
 * The AMap way into a map, one chunk.
 *
 * The GL bindings pair a component with its engine as a prop, because those
 * SDKs are ES modules that must not share a chunk. AMap is neither: the SDK is
 * a runtime-injected script from webapi.amap.com, so there is no engine module
 * to pair with — the component joins the loader's promise itself with React's
 * use(), suspending inside MapViewAuto's Suspense (Leaflet fallback) until the
 * JSAPI is there and falling back through the ErrorBoundary if it never is.
 *
 * The lazy boundary still earns its keep: without it, every provider's map
 * would download the AMap renderer code.
 */
export const MapViewAMapLazy = lazyWithRetry(async () => {
  const component = await import('./MapViewAMap')
  return { default: component.MapViewAMap }
})
