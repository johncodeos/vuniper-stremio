import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMetadataService } from '../src/metadata.js';
import { createSettings, createSettingsServer } from '../src/settings.js';

test('private settings reject anonymous and forged requests and persist credentials without displaying them', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'vuniper-test-'));
  const settings = createSettings(directory);
  const server = createSettingsServer(settings, 'test-password');
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}/settings`;
  const headers = { Authorization: `Basic ${Buffer.from('admin:test-password').toString('base64')}` };
  try {
    assert.equal((await fetch(url)).status, 401);
    assert.equal((await fetch(url, { method: 'POST', headers, body: 'tmdbToken=fake' })).status, 403);
    const page = await (await fetch(url, { headers })).text();
    const csrf = page.match(/name="csrf" value="([^"]+)"/)[1];
    const saved = await fetch(url, {
      method: 'POST', headers, redirect: 'manual', body: new URLSearchParams({ csrf, tmdbToken: 'fake-token' }),
    });
    assert.equal(saved.status, 303);
    assert.equal(createSettings(directory).get().tmdbToken, 'fake-token');
    assert.doesNotMatch(await (await fetch(url, { headers })).text(), /fake-token/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    rmSync(directory, { recursive: true, force: true });
  }
});

test('TMDB and TheTVDB enrich previews with provider synopses or inventing IMDb scores', async () => {
  const urls = [];
  const enrich = createMetadataService({
    settings: { tmdbToken: 'tmdb-token', tvdbKey: 'tvdb-key' },
    fetchImpl: async (url, options) => {
      urls.push(url);
      const path = new URL(url).pathname;
      if (path.endsWith('/login')) {
        assert.deepEqual(JSON.parse(options.body), { apikey: 'tvdb-key' });
        return Response.json({ data: { token: 'tvdb-token' } });
      }
      assert.equal(options.headers.Authorization, url.includes('themoviedb') ? 'Bearer tmdb-token' : 'Bearer tvdb-token');
      if (path.includes('/find/')) return Response.json({ movie_results: [{ id: 123 }] });
      if (path.endsWith('/123')) return Response.json({ overview: 'TMDB plot', credits: { cast: [{ name: 'Movie Actor' }] } });
      if (path.includes('/search/')) return Response.json({ data: [{ series: { id: 456 } }] });
      return Response.json({ data: { overview: 'TVDB plot', characters: [{ peopleType: 'Actor', personName: 'Series Actor' }] } });
    },
  });
  const previews = await enrich([
    { type: 'movie', id: 'tt0000001', description: 'Original' },
    { type: 'series', id: 'tt0000002', description: 'Original' },
  ]);
  assert.deepEqual(previews.map(({ cast }) => cast), [['Movie Actor'], ['Series Actor']]);
  assert.equal(previews[0].description, 'TMDB plot');
  assert.equal(previews[1].description, 'TVDB plot');
  assert.equal(previews[0].imdbRating, undefined);
  assert.equal(urls.length, 5);
});

test('provider overview preserves Cinemeta display metadata when provider credits are missing', async () => {
  const enrich = createMetadataService({
    settings: { imdb: true, tmdbToken: 'test-tmdb-token' },
    fetchImpl: async (url) => {
      if (url.includes('cinemeta')) {
        return Response.json({ meta: {
          id: 'tt1234567', type: 'movie', cast: ['Fallback Actor'],
          runtime: '96 min', releaseInfo: '2026', background: 'https://example.com/backdrop.jpg',
          poster: 'https://example.com/cinemeta-poster.jpg',
        } });
      }
      if (url.includes('/find/')) return Response.json({ movie_results: [{ id: 42 }] });
      return Response.json({ overview: 'Provider overview', credits: { cast: [] } });
    },
  });
  const [preview] = await enrich([{ type: 'movie', id: 'tt1234567', description: 'Original synopsis.',
    runtime: '1h 36m', releaseInfo: '2025', poster: 'https://example.com/vuniper-poster.jpg',
  }]);
  assert.match(preview.description, /Provider overview/);
  assert.deepEqual(preview.cast, ['Fallback Actor']);
  assert.equal(preview.runtime, '1h36min');
  assert.equal(preview.releaseInfo, '2026');
  assert.equal(preview.background, 'https://example.com/backdrop.jpg');
  assert.equal(preview.poster, 'https://example.com/vuniper-poster.jpg');
});
