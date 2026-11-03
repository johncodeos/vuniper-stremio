import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAccounts } from '../src/accounts.js';
import { createAddonServer } from '../src/server.js';

test('personal manifests use separate install and management credentials and preserve settings across saves', async () => {
  const state = await mkdtemp(join(tmpdir(), 'vuniper-accounts-'));
  const origin = 'https://vuniper.example';
  const accounts = createAccounts(state, origin);
  const server = createAddonServer({ publicUrl: origin, accounts });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (path, form, requestOrigin = origin) => fetch(base + path, {
    method: 'POST', headers: { Origin: requestOrigin }, body: new URLSearchParams(form),
  });
  const password = 'example-password';
  try {
    assert.equal((await post('/configure', { password }, 'https://other.example')).status, 403);
    assert.equal((await fetch(base + '/configure')).headers.get('referrer-policy'), 'same-origin');
    const legacy = await fetch(base + '/settings', { redirect: 'manual' });
    assert.equal(legacy.headers.get('location'), '/configure');
    const registration = await post('/configure', { password, tmdbToken: 'secret-tmdb' });
    assert.equal(registration.status, 200);
    const html = await registration.text();
    assert.doesNotMatch(html, /secret-tmdb|example-password/);
    const install = html.match(/<code>https:\/\/vuniper.example([^<]+)<\/code>/)[1];
    const manage = html.match(/href="https:\/\/vuniper.example([^"]+)">Manage/)[1];
    assert.equal((await (await fetch(base + install)).json()).behaviorHints.configurable, true);
    const configure = await fetch(base + install.replace('/manifest.json', '/configure'), { redirect: 'manual' });
    assert.equal(configure.headers.get('location'), manage);
    assert.doesNotMatch(await (await fetch(base + manage)).text(), /secret-tmdb/);
    assert.equal((await fetch(base + install.replace(/([a-f0-9]{48})\/manifest/, '0'.repeat(48) + '/manifest'))).status, 404);
    assert.equal((await post(manage, { password: 'wrong-password' })).status, 401);
    const unlocked = await post(manage, { password });
    assert.match(await unlocked.text(), /value="secret-tmdb"/);
    const saved = await post(manage, { password, save: '1', tvdbKey: 'new-key' });
    assert.ok((await saved.text()).includes(install));
    const restored = createAccounts(state, origin);
    assert.deepEqual((await restored.resolve(install)).settings, {
      imdb: false, tmdbToken: 'secret-tmdb', tvdbKey: 'new-key',
    });
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await rm(state, { recursive: true, force: true });
  }
});
