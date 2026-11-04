import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSettingsSecrets } from '../src/settings-secrets.js';
import { createAccounts } from '../src/accounts.js';
import { createAddonServer } from '../src/server.js';

test('personal manifests use separate install and management credentials and preserve settings across saves', async () => {
  const state = await mkdtemp(join(tmpdir(), 'vuniper-accounts-'));
  const origin = 'https://vuniper.example';
  const secrets = createSettingsSecrets(Buffer.alloc(32, 1));
  const accounts = createAccounts(state, origin, {
    secrets,
    testCredentials: async (provider, settings) => `${provider} ${settings.tmdbToken === 'secret-tmdb' ? 'valid' : 'invalid'}`,
  });
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
    assert.deepEqual(await (await post('/configure', { test: 'tmdb', tmdbToken: 'secret-tmdb' })).json(),
      { message: 'tmdb valid' });
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
    const unlocked = await (await post(manage, { password })).text();
    assert.doesNotMatch(unlocked, /secret-tmdb/);
    assert.match(unlocked, /Saved/);
    const revision = unlocked.match(/name="revision" value="([^"]+)"/)[1];
    const file = join(state, 'accounts', `${manage.split('/').at(-1)}.json`);
    assert.doesNotMatch(await readFile(file, 'utf8'), /secret-tmdb/);
    assert.deepEqual(await (await post(manage, { password, test: 'tmdb' })).json(), { message: 'tmdb valid' });
    const saved = await post(manage, { password, revision, save: '1', tvdbKey: 'new-key' });
    assert.ok((await saved.text()).includes(install));
    const restored = createAccounts(state, origin, { secrets });
    assert.deepEqual((await restored.resolve(install)).settings, {
      imdb: false, tmdbToken: 'secret-tmdb', tvdbKey: 'new-key',
    });
    assert.equal((await post(manage, { password, revision, rotate: '1' })).status, 409);
    const latest = await (await post(manage, { password })).text();
    const currentRevision = latest.match(/name="revision" value="([^"]+)"/)[1];
    const rotated = await (await post(manage, { password, revision: currentRevision, rotate: '1' })).text();
    const replacement = rotated.match(/<code>https:\/\/vuniper.example([^<]+)<\/code>/)[1];
    assert.notEqual(replacement, install);
    assert.equal(await restored.resolve(install), null);
    const newAccount = await restored.resolve(replacement);
    const { providerSecrets, ...stored } = JSON.parse(await readFile(file, 'utf8'));
    assert.ok(providerSecrets);
    await writeFile(file, JSON.stringify({ ...stored, settings: newAccount.settings }));
    await restored.migrate();
    assert.doesNotMatch(await readFile(file, 'utf8'), /secret-tmdb|new-key/);
    assert.deepEqual((await restored.resolve(replacement)).settings, newAccount.settings);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await rm(state, { recursive: true, force: true });
  }
});
