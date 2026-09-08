import type { NextFunction, Request, Response } from 'express';
import { RateLimitService } from '../common/rate-limit.service';

/**
 * `/_AMapService` security-code proxy (docs/amap/03-server-provider.md).
 *
 * The AMap JSAPI, configured with `window._AMapSecurityConfig.serviceHost`,
 * sends its REST plugin calls (geocode/regeo, place/text, …) to this site
 * instead of restapi.amap.com; this middleware re-addresses them and appends
 * the `jscode` security code. THE SECURITY CODE NEVER REACHES A BROWSER — it
 * exists only in the upstream URL, server-side.
 *
 * Mounted in bootstrap.ts on the raw Express instance BEFORE app.init(): Nest
 * 404s every unmatched path and never falls through to anything registered
 * later, so a Nest controller/middleware at this prefix would be dead code.
 * Bare Express here is also invisible to validateRouteGuards — that gate
 * inventories NEST routes only — which is why this file documents the anonymous
 * surface it adds, right where a reviewer reads it:
 *
 *   - Anonymous BY DESIGN: the public share page (SharedTripPage) renders a
 *     map without a session, and its tiles need this proxy exactly as much as
 *     the authenticated planner's does.
 *   - Not an open proxy: the path allow-list below admits only the map-necessary
 *     AMap REST prefixes, GET only, everything else 404s.
 *   - Rate limited per IP and globally (in-memory window, same semantics as the
 *     auth limiter) so a shared page cannot turn the instance into someone
 *     else's quota.
 */
export interface AmapProxyDeps {
  /** Resolved per request — env first, then the encrypted instance row. */
  resolveSecurityCode: () => string | null;
  /** Injectable for tests; defaults to a private in-memory limiter. */
  rateLimiter?: RateLimitService;
  /** Injectable for tests. */
  fetchImpl?: typeof fetch;
  /** Injectable for tests. */
  now?: () => number;
}

/** The AMap REST prefixes the JSAPI's service plugins actually call. */
const ALLOWED_PREFIXES = [
  '/v3/geocode/',
  '/v3/place/',
  '/v3/assistant/',
];

const PER_IP_MAX = 60;
const GLOBAL_MAX = 1200;
const WINDOW_MS = 60_000;
const UPSTREAM_TIMEOUT_MS = 10_000;

export function createAmapProxyMiddleware(deps: AmapProxyDeps) {
  const rateLimiter = deps.rateLimiter ?? new RateLimitService();
  const doFetch = deps.fetchImpl ?? fetch;
  const now = deps.now ?? Date.now;

  return async function amapProxy(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (req.method !== 'GET') {
        res.status(405).json({ error: 'Method not allowed' });
        return;
      }
      // req.path is the path INSIDE the mount point (Express strips the prefix).
      const path = req.path;
      if (!ALLOWED_PREFIXES.some((p) => path.startsWith(p))) {
        res.status(404).json({ error: 'Not found' });
        return;
      }
      const securityCode = deps.resolveSecurityCode();
      if (!securityCode) {
        // Fail closed: without a security code the upstream rejects every call
        // anyway, and saying so plainly beats proxying guaranteed rejections.
        res.status(503).json({ error: 'AMap proxy is not configured' });
        return;
      }
      const ip = req.ip || req.socket?.remoteAddress || 'unknown';
      if (
        !rateLimiter.check('amap-proxy:ip', ip, PER_IP_MAX, WINDOW_MS, now()) ||
        !rateLimiter.check('amap-proxy:global', 'global', GLOBAL_MAX, WINDOW_MS, now())
      ) {
        res.status(429).json({ error: 'Too many requests' });
        return;
      }

      const upstream = new URL('https://restapi.amap.com' + path);
      for (const [key, value] of Object.entries(req.query)) {
        if (typeof value === 'string') upstream.searchParams.set(key, value);
        else if (Array.isArray(value)) upstream.searchParams.set(key, String(value[value.length - 1]));
      }
      // The whole point of this route: the jscode rides only on the upstream leg.
      upstream.searchParams.set('jscode', securityCode);

      const upstreamRes = await doFetch(upstream, { signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS) });
      res.status(upstreamRes.status);
      const contentType = upstreamRes.headers.get('content-type');
      if (contentType) res.set('Content-Type', contentType);
      res.send(await upstreamRes.text());
    } catch (err) {
      // Client aborts are the client's problem; everything else is an upstream
      // failure worth surfacing as a 502 with the connection intact.
      if (res.headersSent) {
        res.end();
        return;
      }
      if ((err as { name?: string })?.name === 'TimeoutError' || (err as { code?: string })?.code === 'UND_ERR_ABORTED') {
        res.status(504).json({ error: 'AMap upstream timeout' });
        return;
      }
      next(err);
    }
  };
}
