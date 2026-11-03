import assert from 'node:assert/strict';
import { CATALOGS, createCatalogService, manifest } from '../src/catalog.js';
import { createPosterService, datedPosterPath } from '../src/posters.js';
import sharp from 'sharp';

const service = createCatalogService();
for (const catalog of CATALOGS) {
  const { entries } = await service.getSnapshot(catalog.id);
  assert.ok(entries.length > 0, `${catalog.name} returned no usable movies.`);
  assert.equal(new Set(entries.map(({ meta }) => meta.id)).size, entries.length);
  for (let i = 1; i < entries.length; i += 1) {
    const comparison = entries[i - 1].releaseDate.localeCompare(entries[i].releaseDate);
    assert.ok(catalog.order === 'asc' ? comparison <= 0 : comparison >= 0, `${catalog.name}: dates out of order.`);
  }
  for (const { meta } of entries) {
    assert.match(meta.id, /^tt\d{7,}$/);
    assert.equal(meta.type, catalog.type);
    assert.ok(meta.name);
    assert.match(meta.poster, /^https:\/\//);
  }
  const first = entries[0];
  const image = first.ribbon
    ? await createPosterService().getPoster(datedPosterPath(first.meta.poster, first.releaseDate, first.ribbon))
    : Buffer.from(await (await fetch(first.meta.poster, { signal: AbortSignal.timeout(15_000) })).arrayBuffer());
  const metadata = await sharp(image).metadata();
  assert.equal(metadata.format, 'jpeg');
  if (first.ribbon) {
    assert.equal(metadata.width, 300);
    assert.equal(metadata.height, 450);
  }
  console.log(`${catalog.name}: ${Math.min(entries.length, 100)} ${catalog.type} items on page 1; first date ${first.releaseDate}; ${first.ribbon ? `${first.ribbon} ribbon` : 'original poster'} renders.`);
  console.table(entries.slice(0, 3).map(({ releaseDate, meta }) => ({ releaseDate, title: meta.name, imdb: meta.id })));
  if (!catalog.readAll && entries.length >= 100) {
    const next = await service.getSnapshot(catalog.id, 200);
    assert.deepEqual(next.entries.slice(0, 100), entries.slice(0, 100), `${catalog.name}: earlier page shifted.`);
    console.log(`  Second page: ${next.entries.slice(100, 200).length} items; first page remains stable.`);
  }
}

const logoResponse = await fetch(manifest.logo, { signal: AbortSignal.timeout(15_000) });
assert.ok(logoResponse.ok, 'Vuniper logo failed to load.');
assert.match(logoResponse.headers.get('content-type'), /^image\/png/);
const logo = await sharp(Buffer.from(await logoResponse.arrayBuffer())).metadata();
assert.equal(logo.width, logo.height);
console.log(`Vuniper add-on logo loads: ${logo.width} × ${logo.height}.`);
