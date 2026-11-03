import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { datedPosterPath, parsePosterPath, renderDatedPoster, createPosterService } from '../src/posters.js';

const source = 'https://img.vuniper.com/posters-movies/m1dhdm6w_h5xkeyp2.jpg';
const path = '/poster/v3/2026-11-06/m1dhdm6w_h5xkeyp2.jpg';
const makeImage = () => sharp({ create: {
  width: 300, height: 450, channels: 3, background: '#ca6633',
} }).png().toBuffer();

test('poster URLs carry the streaming date and only resolve known poster sources', () => {
  assert.equal(datedPosterPath(source, '2026-11-06'), path);
  assert.deepEqual(parsePosterPath(path), { day: '2026-11-06', source, ribbon: 'streaming' });
  assert.notEqual(datedPosterPath(source, '2026-11-07'), path);
  const fallback = 'https://images.metahub.space/poster/medium/tt32767134/img';
  assert.equal(parsePosterPath(datedPosterPath(fallback, '2026-11-06')).source, fallback);
  assert.throws(() => datedPosterPath('http://127.0.0.1/private', '2026-11-06'));
  for (const value of [
    '/poster/v1/2026-02-30/tt32767134.jpg',
    '/poster/v1/2026-11-06/https://example.com/image.jpg',
    '/poster/v1/2026-11-06/../../etc/passwd',
  ]) assert.equal(parsePosterPath(value), null);
});

test('movie premieres and show seasons carry distinct ribbon labels and correct source artwork', async () => {
  const releasePath = datedPosterPath(source, '2026-11-06', 'release');
  assert.equal(releasePath, '/poster/v2/release/2026-11-06/m1dhdm6w_h5xkeyp2.jpg');
  assert.equal(parsePosterPath(releasePath).ribbon, 'release');
  const showSource = 'https://img.vuniper.com/posters-shows/s9p3uzzw_h94m09i1.jpg';
  const showPath = datedPosterPath(showSource, '2026-11-02', 'season');
  assert.deepEqual(parsePosterPath(showPath), { source: showSource, day: '2026-11-02', ribbon: 'season' });
  assert.equal(parsePosterPath(showPath.replace('/season/', '/unknown/')), null);
  assert.throws(() => datedPosterPath(showSource.replace('posters-shows', 'posters-movies'), '2026-11-02'));
  assert.throws(() => datedPosterPath(source, '2026-11-06', 'unknown'));
  const image = await makeImage();
  const strip = { left: 0, top: 380, width: 300, height: 25 };
  const renders = await Promise.all(['streaming', 'release', 'season'].map(async (ribbon) =>
    sharp(await renderDatedPoster(image, '2026-11-06', ribbon)).extract(strip).raw().toBuffer()));
  assert.notDeepEqual(renders[0], renders[1]);
  assert.notDeepEqual(renders[1], renders[2]);
});

test('renders a JPEG in poster proportions with visible date text and preserved artwork', async () => {
  const original = await makeImage();
  const first = await renderDatedPoster(original, '2026-11-06');
  const second = await renderDatedPoster(original, '2027-01-08');
  const metadata = await sharp(first).metadata();
  assert.equal(metadata.format, 'jpeg');
  assert.equal(metadata.width, 300);
  assert.equal(metadata.height, 450);
  assert.ok(first.length < 100_000);
  const art = await sharp(first).extract({ left: 20, top: 20, width: 1, height: 1 }).raw().toBuffer();
  assert.ok(Math.abs(art[0] - 202) < 5);
  const strip = await sharp(first).extract({ left: 5, top: 384, width: 290, height: 45 }).stats();
  assert.ok(strip.channels[0].max > 230, 'Date strip should contain bright text.');
  assert.ok(strip.channels[0].min < 30, 'Date strip should have a dark background.');
  const region = { left: 5, top: 402, width: 290, height: 28 };
  assert.notDeepEqual(
    await sharp(first).extract(region).raw().toBuffer(),
    await sharp(second).extract(region).raw().toBuffer(),
    'Different dates must produce different date labels.',
  );
});

test('shares concurrent image downloads, caches artwork, and refetches after expiry', async () => {
  const image = await makeImage();
  let calls = 0;
  let time = 0;
  const service = createPosterService({ now: () => time, fetchImpl: async (url) => {
    assert.equal(url, source);
    calls += 1;
    return new Response(image);
  } });
  await Promise.all([service.getPoster(path), service.getPoster(path)]);
  assert.equal(calls, 1);
  await service.getPoster(path);
  assert.equal(calls, 1);
  time = 7 * 60 * 60 * 1000;
  await service.getPoster(path);
  assert.equal(calls, 2);
  await service.getPoster(path.replace('2026-11-06', '2026-11-07'));
  assert.equal(calls, 3);
});

test('rejects oversized image responses and permits retries after failure', async () => {
  const image = await makeImage();
  let calls = 0;
  const service = createPosterService({ fetchImpl: async () => ++calls === 1
    ? new Response(image, { headers: { 'Content-Length': '3000000' } })
    : new Response(image),
  });
  await assert.rejects(service.getPoster(path), /size limit/);
  assert.ok((await service.getPoster(path)).length > 0);
  assert.equal(calls, 2);
});

test('bounds the processed poster cache', async () => {
  const image = await makeImage();
  let calls = 0;
  const service = createPosterService({ maxCached: 1, fetchImpl: async () => {
    calls += 1;
    return new Response(image);
  } });
  await service.getPoster(path);
  await service.getPoster(path.replace('2026-11-06', '2026-11-07'));
  await service.getPoster(path);
  assert.equal(calls, 3);
});
