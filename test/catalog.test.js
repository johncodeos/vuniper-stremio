import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildEntries, createCatalogService, calendarDate, findCatalog } from '../src/catalog.js';

const movie = (overrides = {}) => ({
  uid: 'm1dhdm6w', imdb_id: 'tt32767134', title: 'Example',
  web: '2026-11-06T01:35:30', release_date: '2025-01-01T00:00:00',
  img_hash: 'h5xkeyp2', year: 2025, genres: 'Horror,Drama',
  ...overrides,
});
const quiet = { warn() {} };

test('sorts by streaming day, ignoring theatrical date and artificial time of day', () => {
  const entries = buildEntries([
    movie({ imdb_id: 'tt0000001', title: 'Later', web: '2026-11-10T00:00:00', release_date: '2020-01-01' }),
    movie({ imdb_id: 'tt0000002', title: 'Zulu', web: '2026-11-06T00:01:00' }),
    movie({ imdb_id: 'tt0000003', title: 'Alpha', web: '2026-11-06T23:59:00' }),
  ]);
  assert.deepEqual(entries.map(({ meta }) => meta.name), ['Alpha', 'Zulu', 'Later']);
  assert.equal(entries[0].meta.released, undefined);
  assert.equal(entries[0].meta.releaseInfo, '2025');
});

test('decodes titles and descriptions, preserves IMDb identity, and maps source posters', () => {
  const [{ meta }] = buildEntries([movie({
    title: 'A Dog&apos;s &quot;Perfect&quot; Christmas', description: 'Family &amp; friends &#x1F37F;',
  })]);
  assert.equal(meta.name, 'A Dog\'s "Perfect" Christmas');
  assert.equal(meta.id, 'tt32767134');
  assert.equal(meta.poster, 'https://img.vuniper.com/posters-movies/m1dhdm6w_h5xkeyp2.jpg');
  assert.equal(meta.description, 'Family & friends 🍿');
  assert.deepEqual(meta.genres, ['Horror', 'Drama']);
});

test('omits unusable rows, deduplicates IMDb IDs, and keeps the earliest streaming date', () => {
  const entries = buildEntries([
    movie({ web: '2026-12-06' }), movie(),
    movie({ imdb_id: null }), movie({ imdb_id: 'not-an-id' }),
    movie({ web: null }), movie({ title: '' }), movie({ web: '2026-02-30' }),
  ]);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].releaseDate, '2026-11-06');
  assert.equal(calendarDate('2026-11-06 01:35:30'), '2026-11-06');
  assert.equal(calendarDate('2026-11-06T01:35:30Z'), '2026-11-06');
  assert.equal(calendarDate('2026-13-06'), null);
});

test('released catalogs put newest streaming dates first and retain source order within a day', () => {
  const entries = buildEntries([
    movie({ imdb_id: 'tt0000001', title: 'Older', web: '2026-10-01' }),
    movie({ imdb_id: 'tt0000002', title: 'Zulu', web: '2026-11-03T13:41:44' }),
    movie({ imdb_id: 'tt0000003', title: 'Alpha', web: '2026-11-03T13:39:16' }),
  ], { order: 'desc' });
  assert.deepEqual(entries.map(({ meta }) => meta.name), ['Zulu', 'Alpha', 'Older']);
});

test('New Shows & Seasons opens series metadata and uses the latest season rather than original premiere', () => {
  const [entry] = buildEntries([{
    uid: 's9p3uzzw', imdb_id: 'tt36153709', img_hash: 'h94m09i1',
    title: 'Example Series', year: 2024, year_end: null,
    release_date: '2024-01-01', last_season_date: '2026-11-02T23:13:53', seasons_count: 2,
  }], findCatalog('new-shows-seasons'));
  assert.equal(entry.releaseDate, '2026-11-02');
  assert.equal(entry.ribbon, null);
  assert.equal(entry.meta.type, 'series');
  assert.equal(entry.meta.id, 'tt36153709');
  assert.equal(entry.meta.releaseInfo, '2024-');
  assert.equal(entry.meta.poster, 'https://img.vuniper.com/posters-shows/s9p3uzzw_h94m09i1.jpg');
  assert.equal(entry.meta.description, '');
});

test('the show catalog passes its media type and latest season cursor to pagination', async () => {
  const queries = [];
  const service = createCatalogService({ loadItems: async (section, options) => {
    queries.push({ section, mediaType: options.mediaType, cursorField: options.cursorField });
    assert.equal(options.hasEnough([movie({ last_season_date: '2026-11-02' })]), true);
    return [];
  } });
  await service.getSnapshot('new-shows-seasons', 1);
  assert.deepEqual(queries, [
    { section: 'new', mediaType: 'shows', cursorField: 'last_season_date' },
  ]);
});

test('fetches afresh on subsequent requests and returns changed titles', async () => {
  let calls = 0;
  const service = createCatalogService({ loadItems: async () => [movie({ title: `Request ${++calls}` })] });
  assert.equal((await service.getSnapshot()).entries[0].meta.name, 'Request 1');
  assert.equal((await service.getSnapshot()).entries[0].meta.name, 'Request 2');
  assert.equal(calls, 2);
});

test('shares simultaneous fetches and permits a fresh retry after failure', async () => {
  let calls = 0;
  let release;
  const pending = new Promise((resolve) => { release = resolve; });
  const service = createCatalogService({ loadItems: async () => { calls += 1; return pending; } });
  const first = service.getSnapshot();
  const second = service.getSnapshot();
  assert.equal(first, second);
  release([movie()]);
  await Promise.all([first, second]);
  assert.equal(calls, 1);

  let retries = 0;
  const recovering = createCatalogService({ loadItems: async () => {
    if (++retries === 1) throw new Error('Temporarily unavailable');
    return [movie()];
  } });
  await assert.rejects(recovering.getSnapshot(), /Temporarily unavailable/);
  assert.equal((await recovering.getSnapshot()).entries.length, 1);
  assert.equal(retries, 2);
});

test('does not turn an incompatible nonempty upstream list into an empty catalog', async () => {
  const service = createCatalogService({ loadItems: async () => [movie({ imdb_id: null })], logger: quiet });
  await assert.rejects(service.getSnapshot(), /without usable IMDb IDs/);
});

test('keeps simultaneous categories isolated and counts usable movies toward each page', async () => {
  const sections = [];
  const service = createCatalogService({ loadItems: async (section, { hasEnough }) => {
    sections.push(section);
    assert.equal(hasEnough([movie({ imdb_id: null })]), false);
    assert.equal(hasEnough([movie()]), section !== 'soon');
    return [movie({ title: section })];
  } });
  const [soon, online, gems] = await Promise.all([
    service.getSnapshot('streaming-soon', 1),
    service.getSnapshot('movies-now-online', 1),
    service.getSnapshot('hidden-gems', 1),
  ]);
  assert.deepEqual(sections, ['soon', 'web', 'gems']);
  assert.deepEqual([soon, online, gems].map((data) => data.entries[0].meta.name), ['soon', 'web', 'gems']);
  await assert.rejects(service.getSnapshot('unknown'), /Unknown catalog/);
});

test('persistent catalog snapshots survive restart and expire after an upstream outage', async () => {
  const stateDirectory = await mkdtemp(join(tmpdir(), 'vuniper-cache-'));
  let now = Date.parse('2026-11-04T00:00:00Z');
  let calls = 0;
  let unavailable = false;
  const loadItems = async () => {
    calls++;
    if (unavailable) throw new Error('Upstream unavailable');
    return [movie({ description: 'Original synopsis.' })];
  };
  const options = { stateDirectory, now: () => now, loadItems, logger: quiet };
  try {
    const service = createCatalogService(options);
    const first = await service.getSnapshot();
    assert.deepEqual(await service.getSnapshot(), first);
    assert.equal(calls, 1);

    const legacy = structuredClone(first);
    legacy.entries[0].meta.description = 'Streaming: 6 November 2026 (Vuniper).\n\nOriginal synopsis.';
    await writeFile(join(stateDirectory, 'catalog-streaming-soon.json'), JSON.stringify(legacy));
    const restarted = createCatalogService(options);
    assert.deepEqual(await restarted.getSnapshot(), first);
    assert.equal(calls, 1);
    now += 6 * 60_000;
    unavailable = true;
    assert.deepEqual(await restarted.getSnapshot(), { ...first, stale: true });
    assert.equal((await restarted.getStatus()).find(({ id }) => id === 'streaming-soon').status, 'stale');
    assert.deepEqual(await restarted.getSnapshot(), { ...first, stale: true });
    assert.equal(calls, 2);
    now += 24 * 60 * 60_000;
    await assert.rejects(restarted.getSnapshot(), /Upstream unavailable/);
  } finally {
    await rm(stateDirectory, { recursive: true, force: true });
  }
});
