import { createServer } from 'node:http';
import { findCatalog, CATALOG_PAGE_SIZE, createCatalogService, manifest } from './catalog.js';
import { addPreviewLinks } from './metadata.js';
import { createPosterService, datedPosterPath, parsePosterPath } from './posters.js';

function reply(res, status, body, head = false) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(head ? undefined : JSON.stringify(body));
}

export function createAddonServer({
  service = createCatalogService(),
  posterService = createPosterService(),
  publicUrl,
  accounts,
  enrichPreviews = async (metas) => metas.map((meta) => addPreviewLinks(meta)),
  logger = console,
} = {}) {
  let publicOrigin;
  if (publicUrl) {
    const parsed = new URL(publicUrl);
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password
      || parsed.pathname !== '/' || parsed.search || parsed.hash) {
      throw new Error('PUBLIC_URL must be an HTTP(S) origin, such as https://addon.example.com.');
    }
    publicOrigin = parsed.origin;
  }
  return createServer(async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Cache-Control', 'no-store, no-cache, max-age=0, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    const head = req.method === 'HEAD';
    const url = new URL(req.url, 'http://localhost');
    try {
      if (await accounts?.handle(req, res, url.pathname)) return;
    } catch {
      res.writeHead(500).end('Could not process settings.');
      return;
    }
    const json = (status, body) => reply(res, status, body, head);
    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
    if (req.method !== 'GET' && !head) {
      res.setHeader('Allow', 'GET, HEAD, OPTIONS');
      json(405, { error: 'Method not allowed.' });
      return;
    }

    try {
      const account = url.pathname.startsWith('/install/') ? await accounts?.resolve(url.pathname) : null;
      const pathname = account?.pathname ?? url.pathname;
      if (account && pathname === '/configure') {
        res.writeHead(302, { Location: `/configure/${account.id}`, 'Referrer-Policy': 'no-referrer' }).end();
        return;
      }
      if (pathname === '/manifest.json') {
        json(200, accounts ? { ...manifest, behaviorHints: { ...manifest.behaviorHints, configurable: true } } : manifest);
        return;
      }
      if (pathname === '/health') { json(200, { ok: true }); return; }

      if (pathname.startsWith('/poster/')) {
        if (!parsePosterPath(pathname)) { json(404, { error: 'Not found.' }); return; }
        const image = await posterService.getPoster(pathname);
        res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Content-Length': image.length });
        res.end(head ? undefined : image);
        return;
      }

      const catalogRoute = /^\/catalog\/(movie|series)\/([^/]+?)(?:\/([^/]+))?\.json$/.exec(pathname);
      if (catalogRoute && findCatalog(catalogRoute[2], catalogRoute[1])) {
        const [, , catalogId, extra = ''] = catalogRoute;
        const parameters = new URLSearchParams(extra);
        const skips = parameters.getAll('skip');
        const rawSkip = skips[0] ?? url.searchParams.get('skip') ?? '0';
        const skip = Number(rawSkip);
        if (skips.length > 1 || !/^\d+$/.test(rawSkip) || !Number.isSafeInteger(skip)) {
          json(400, { error: 'skip must be a non-negative integer.' });
          return;
        }
        const { entries, fetchedAt } = await service.getSnapshot(catalogId, skip + CATALOG_PAGE_SIZE);
        const origin = publicOrigin ?? `${req.socket.encrypted ? 'https' : 'http'}://${req.headers.host}`;
        res.setHeader('X-Catalog-Fetched-At', fetchedAt);
        const metas = entries.slice(skip, skip + CATALOG_PAGE_SIZE).map(({ meta, releaseDate, ribbon }) => ({
          ...meta,
          poster: ribbon ? new URL(datedPosterPath(meta.poster, releaseDate, ribbon), origin).href : meta.poster,
        }));
        json(200, {
          metas: head ? [] : await enrichPreviews(metas, account),
          cacheMaxAge: 0,
          staleRevalidate: 0,
          staleError: 0,
        });
        return;
      }

      json(404, { error: 'Not found.' });
    } catch (error) {
      logger.error('Catalog request failed:', error);
      // Fail visibly instead of permanently replacing the row with an empty list.
      json(502, { error: 'Could not load the latest movie list. Please try again shortly.' });
    }
  });
}
