import test from 'node:test';
import assert from 'node:assert/strict';
import { createAddonServer } from '../src/server.js';
import { createCatalogService, CATALOG_ID } from '../src/catalog.js';
import { parsePosterPath } from '../src/posters.js';

const catalogUrl = `/catalog/movie/${CATALOG_ID}`;
const quiet = { error() {}, warn() {} };
const movies = Array.from({ length: 105 }, (_, i) => ({
  uid: `m${i.toString().padStart(7, '0')}`, imdb_id: `tt${i.toString().padStart(7, '0')}`,
  title: `Film ${i.toString().padStart(3, '0')}`, web: '2026-11-06',
}));

async function withServer(service, run) {
  const server = createAddonServer({ service, logger: quiet });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try { await run(`http://127.0.0.1:${server.address().port}`); }
  finally { await new Promise((resolve) => server.close(resolve)); }
}

test('serves an installable manifest and paginates 100 movies without caching', async () => {
  let calls = 0;
  const service = createCatalogService({ loadItems: async () => { calls += 1; return movies; } });
  await withServer(service, async (base) => {
    const manifest = await (await fetch(`${base}/manifest.json`)).json();
    assert.equal(manifest.name, 'Vuniper');
    assert.equal(manifest.logo, 'https://vuniper.com/icons/icon-192x192.png');
    assert.deepEqual(manifest.types, ['movie', 'series']);
    assert.deepEqual(manifest.catalogs.map(({ name }) => name), ['Now Streaming', 'Streaming Soon', 'Hidden Gems', 'New Shows & Seasons']);
    assert.deepEqual(manifest.resources, ['catalog']);
    assert.equal(manifest.catalogs[0].extra[0].name, 'skip');
    assert.equal(manifest.catalogs[0].extra[0].isRequired, false);

    const first = await fetch(`${base}${catalogUrl}.json`);
    assert.equal(first.status, 200);
    assert.equal(first.headers.get('access-control-allow-origin'), '*');
    assert.match(first.headers.get('cache-control'), /no-store/);
    assert.ok(first.headers.get('x-catalog-fetched-at'));
    const firstData = await first.json();
    assert.equal(firstData.metas.length, 100);
    assert.equal(firstData.cacheMaxAge, 0);
    assert.equal(firstData.staleRevalidate, 0);
    assert.equal(firstData.staleError, 0);
    assert.equal(new URL(firstData.metas[0].poster).origin, base);
    assert.equal(parsePosterPath(new URL(firstData.metas[0].poster).pathname).day, '2026-11-06');

    const second = await (await fetch(`${base}${catalogUrl}/skip=100.json`)).json();
    assert.equal(second.metas.length, 5);
    assert.equal(second.metas[0].id, 'tt0000100');
    assert.equal(calls, 2);
    const exhausted = await (await fetch(`${base}${catalogUrl}/skip=200.json`)).json();
    assert.deepEqual(exhausted.metas, []);
  });
});

test('serves dated poster images and uses the public HTTPS origin behind a proxy', async () => {
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
  const paths = [];
  const service = createCatalogService({ loadItems: async () => movies.slice(0, 1) });
  const server = createAddonServer({
    service, publicUrl: 'https://addon.example.com', logger: quiet,
    posterService: { getPoster: async (path) => { paths.push(path); return jpeg; } },
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const catalog = await (await fetch(`${base}${catalogUrl}.json`)).json();
    const posterUrl = new URL(catalog.metas[0].poster);
    assert.equal(posterUrl.origin, 'https://addon.example.com');
    const backdropUrl = new URL(catalog.metas[0].background);
    assert.equal(backdropUrl.origin, posterUrl.origin);
    const backdrop = await fetch(`${base}${backdropUrl.pathname}`);
    assert.equal(backdrop.status, 200);
    assert.equal(backdrop.headers.get('content-type'), 'image/png');
    assert.match(backdrop.headers.get('cache-control'), /immutable/);
    assert.equal((await backdrop.arrayBuffer()).byteLength, Number(backdrop.headers.get('content-length')));
    const response = await fetch(`${base}${posterUrl.pathname}`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'image/jpeg');
    assert.equal(response.headers.get('access-control-allow-origin'), '*');
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), jpeg);
    assert.deepEqual(paths, [posterUrl.pathname]);
    assert.equal((await fetch(`${base}/poster/v1/2026-02-30/tt0000000.jpg`)).status, 404);
    assert.equal(paths.length, 1);
  } finally { await new Promise((resolve) => server.close(resolve)); }
});

test('rejects invalid offsets, methods, and paths before contacting Vuniper', async () => {
  let calls = 0;
  const service = { getSnapshot: async () => { calls += 1; throw new Error('Should not run'); } };
  await withServer(service, async (base) => {
    for (const value of ['-1', 'NaN', '1.5', '9007199254740992', '1&skip=2']) {
      const result = await fetch(`${base}${catalogUrl}/skip=${value}.json`);
      assert.equal(result.status, 400);
    }
    assert.equal((await fetch(`${base}/unknown.json`)).status, 404);
    assert.equal((await fetch(`${base}/catalog/series/${CATALOG_ID}.json`)).status, 404);
    assert.equal((await fetch(`${base}/manifest.json`, { method: 'POST' })).status, 405);
    const preflight = await fetch(`${base}/manifest.json`, { method: 'OPTIONS' });
    assert.equal(preflight.status, 204);
    assert.equal(preflight.headers.get('access-control-allow-origin'), '*');
    const head = await fetch(`${base}/manifest.json`, { method: 'HEAD' });
    assert.equal(head.status, 200);
    assert.equal(await head.text(), '');
    assert.equal(calls, 0);
  });
});

test('routes every advertised category with its own ID and requested pagination range', async () => {
  const calls = [];
  const service = {
    getSnapshot: async (id, minimumEntries) => {
      calls.push({ id, minimumEntries });
      return { entries: [], fetchedAt: '2026-11-03T17:00:00Z' };
    },
  };
  await withServer(service, async (base) => {
    for (const [type, id] of [
      ['movie', 'streaming-soon'], ['movie', 'movies-now-online'], ['movie', 'hidden-gems'],
      ['series', 'new-shows-seasons'],
    ]) {
      assert.equal((await fetch(`${base}/catalog/${type}/${id}.json`)).status, 200);
      assert.equal((await fetch(`${base}/catalog/${type}/${id}/skip=100.json`)).status, 200);
    }
    assert.deepEqual(calls, [
      { id: 'streaming-soon', minimumEntries: 100 }, { id: 'streaming-soon', minimumEntries: 200 },
      { id: 'movies-now-online', minimumEntries: 100 }, { id: 'movies-now-online', minimumEntries: 200 },
      { id: 'hidden-gems', minimumEntries: 100 }, { id: 'hidden-gems', minimumEntries: 200 },
      { id: 'new-shows-seasons', minimumEntries: 100 }, { id: 'new-shows-seasons', minimumEntries: 200 },
    ]);
    assert.equal((await fetch(`${base}/catalog/movie/unknown.json`)).status, 404);
    assert.equal((await fetch(`${base}/catalog/movie/new-shows-seasons.json`)).status, 404);
    assert.equal((await fetch(`${base}/catalog/series/upcoming-movies.json`)).status, 404);
    assert.equal((await fetch(`${base}/catalog/movie/upcoming-movies.json`)).status, 404);
    assert.equal(calls.length, 8);
  });
});

test('returns an uncached 502 on source failure and recovers on the next request', async () => {
  let calls = 0;
  const service = createCatalogService({ loadItems: async () => {
    if (++calls === 1) throw new Error('Source is down');
    return movies.slice(0, 1);
  } });
  await withServer(service, async (base) => {
    const failed = await fetch(`${base}${catalogUrl}.json`);
    assert.equal(failed.status, 502);
    assert.match(failed.headers.get('cache-control'), /no-store/);
    assert.equal((await failed.json()).metas, undefined);
    const recovered = await fetch(`${base}${catalogUrl}.json`);
    assert.equal(recovered.status, 200);
    assert.equal((await recovered.json()).metas.length, 1);
  });
});

test('catalog previews expose IMDb and cast links even when metadata is unavailable', async () => {
  const { createMetadataService } = await import('../src/metadata.js');
  const source = [
    { ...movies[0], genres: 'Drama', actors: 'Source Actor', description: 'Original synopsis.' },
    { ...movies[1], actors: 'Fallback Actor', runtime: '2h 1m' },
  ];
  const service = createCatalogService({ loadItems: async () => source });
  const enrichPreviews = createMetadataService({
    fetchImpl: async (url) => {
      if (url.endsWith('/tt0000001.json')) return new Response(null, { status: 503 });
      return Response.json({ meta: {
        id: 'tt0000000', type: 'movie', cast: ['Example Actor'], imdbRating: '7.4',
      } });
    },
  });
  const server = createAddonServer({ service, enrichPreviews, logger: quiet });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const { metas: [enriched, fallback] } = await (await fetch(`${base}${catalogUrl}.json`)).json();
    assert.equal(enriched.description, 'Original synopsis.');
    assert.equal(parsePosterPath(new URL(enriched.poster).pathname).day, '2026-11-06');
    assert.deepEqual(enriched.links.map(({ category, name }) => [category, name]), [
      ['imdb', '7.4'], ['Genres', 'Drama'], ['Cast', 'Example Actor'],
    ]);
    assert.equal(fallback.links[0].name, 'Fallback Actor');
    assert.equal(fallback.imdbRating, undefined);
    assert.equal(fallback.runtime, '2h1min');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
