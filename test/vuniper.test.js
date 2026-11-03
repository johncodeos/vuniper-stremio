import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchItems, fetchMovies, fetchSoonMovies, VuniperError, API_URL } from '../src/vuniper.js';

const movie = (i) => ({ uid: `movie${i}`, web: `2026-11-${String(i + 1).padStart(2, '0')}T01:00:00` });
const response = (items) => Response.json({ ok: true, items });

test('loads every upstream page with the original streaming-date cursor and no credentials', async () => {
  const first = Array.from({ length: 21 }, (_, i) => movie(i));
  const requests = [];
  const movies = await fetchSoonMovies({ fetchImpl: async (url, options) => {
    requests.push({ url, ...options, body: JSON.parse(options.body) });
    return requests.length === 1 ? response(first) : response([movie(21), movie(22)]);
  } });
  assert.equal(movies.length, 23);
  assert.equal(requests.length, 2);
  assert.equal(requests[0].url, API_URL);
  assert.equal(requests[0].headers.Origin, 'https://vuniper.com');
  assert.equal(requests[0].headers.Cookie, undefined);
  assert.deepEqual(requests[0].body, {
    action: 'GET_MANY_ITEMS', mediaType: 'movies', section: 'soon', streamItems: false,
  });
  assert.equal(requests[1].body.paginationCursor, first.at(-1).web);
});

test('rejects a stuck pagination cursor instead of looping or returning a partial feed', async () => {
  const items = Array.from({ length: 21 }, (_, i) => movie(i));
  let calls = 0;
  await assert.rejects(fetchSoonMovies({ fetchImpl: async () => {
    calls += 1;
    return response(items);
  } }), /stopped making progress/);
  assert.equal(calls, 2);
});

test('fails rather than truncating the feed at the page limit', async () => {
  await assert.rejects(fetchSoonMovies({ maxPages: 1, fetchImpl: async () =>
    response(Array.from({ length: 21 }, (_, i) => movie(i))) }), /safety limit/);
});

for (const section of ['web', 'gems']) {
  test(`${section} starts from the website's curated feed, then paginates the same category`, async () => {
    const first = Array.from({ length: 21 }, (_, i) => movie(i));
    const requests = [];
    const result = await fetchMovies(section, { fetchImpl: async (_url, options) => {
      requests.push(JSON.parse(options.body));
      return response(requests.length === 1 ? first : [movie(21)]);
    } });
    assert.deepEqual(requests[0], {
      action: 'GET_MANY_ITEMS_KV', kvName: `movies_${section}`, streamItems: false,
    });
    assert.deepEqual(requests[1], {
      action: 'GET_MANY_ITEMS', mediaType: 'movies', section,
      streamItems: false, paginationCursor: first.at(-1).web,
    });
    assert.equal(result.length, 22);
  });
}

test('stops after enough rows for a requested page without loading the entire release history', async () => {
  let calls = 0;
  const result = await fetchMovies('web', {
    hasEnough: (rows) => rows.length >= 25,
    fetchImpl: async () => {
      const offset = calls++ * 21;
      return response(Array.from({ length: 21 }, (_, i) => movie(offset + i)));
    },
  });
  assert.equal(calls, 2);
  assert.equal(result.length, 42);
});

test('rejects unknown Vuniper sections before making a network request', async () => {
  await assert.rejects(fetchMovies('unknown', { fetchImpl: () => { throw new Error('Should not run'); } }), /Unsupported/);
});

for (const [mediaType, section, cursorField] of [
  ['shows', 'new', 'last_season_date'],
]) {
  test(`${mediaType}/${section} uses its own date cursor and curated feed`, async () => {
    const rows = Array.from({ length: 21 }, (_, i) => ({
      uid: `item${i}`, [cursorField]: `2026-11-${String(i + 1).padStart(2, '0')}T01:00:00`,
    }));
    const requests = [];
    await fetchItems(section, { mediaType, cursorField, fetchImpl: async (_url, options) => {
      requests.push(JSON.parse(options.body));
      return response(requests.length === 1 ? rows : []);
    } });
    assert.equal(requests[0].kvName, `${mediaType}_${section}`);
    assert.equal(requests[1].mediaType, mediaType);
    assert.equal(requests[1].section, section);
    assert.equal(requests[1].paginationCursor, rows.at(-1)[cursorField]);
  });
}

test('distinguishes a genuinely empty list from HTTP, JSON, or schema failures', async () => {
  assert.deepEqual(await fetchSoonMovies({ fetchImpl: async () => response([]) }), []);
  for (const result of [
    new Response('Forbidden', { status: 403 }),
    new Response('Not found', { status: 404 }),
    new Response('<html>not JSON</html>'),
    Response.json({ ok: false, items: [] }),
    Response.json({ ok: true, items: null }),
    response([null]),
  ]) {
    await assert.rejects(fetchSoonMovies({ fetchImpl: async () => result }), VuniperError);
  }
});

test('treats a 404 after a valid full page as the end, like the source client', async () => {
  const items = Array.from({ length: 21 }, (_, i) => movie(i));
  let calls = 0;
  const result = await fetchSoonMovies({ fetchImpl: async () => ++calls === 1
    ? response(items) : new Response('', { status: 404 }) });
  assert.equal(result.length, 21);
});

test('aborts upstream requests instead of hanging', async () => {
  // A real HTTP listener keeps the event loop alive and checks the actual fetch timeout.
  const { createServer } = await import('node:http');
  const server = createServer(() => {});
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    await assert.rejects(fetchSoonMovies({
      timeoutMs: 30,
      fetchImpl: (_url, options) => fetch(`http://127.0.0.1:${server.address().port}`, options),
    }), /Could not fetch/);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});
