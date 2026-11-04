import { testProviderCredentials } from './providers.js';
import { settingsScript, settingsScriptHash } from './settings-client.js';
import { manifest } from './catalog.js';
import { settingsStyle, settingsStyleHash } from './settings-style.js';
import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, readdir, rename, writeFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';

const derive = promisify(scrypt);
const random = () => randomBytes(24).toString('hex');
const idPattern = '[a-f0-9]{48}';
const fields = {
  tmdbToken: 'TMDB Read Access Token',
  tvdbKey: 'TheTVDB API key',
  tvdbPin: 'TheTVDB subscriber PIN (if required)',
};

function providerSettings(form, previous = {}) {
  const settings = { ...previous, imdb: form.has('imdb') };
  for (const key of Object.keys(fields)) {
    const value = form.get(key)?.trim();
    if (value && !/^[A-Za-z0-9._-]{1,2048}$/.test(value)) return null;
    if (form.has(`clear-${key}`)) delete settings[key];
    else if (value) settings[key] = value;
  }
  return settings;
}

const keyPages = {
  tmdbToken: ['https://www.themoviedb.org/settings/api', 'Open TMDB API settings'],
  tvdbKey: ['https://thetvdb.com/dashboard/account/apikeys', 'Open TheTVDB API Keys'],
};

function providerFields(settings = {}) {
  const keyLink = (name) => {
    const page = keyPages[name];
    return page ? ` <a class="badge" href="${page[0]}" target="_blank" rel="noopener noreferrer">${page[1]}</a>` : '';
  };
  return Object.entries(fields).map(([name, label]) => `<div class="field"><label>${label} <span class="badge">(Optional)</span>
    <input type="password" name="${name}" autocomplete="new-password" maxlength="2048"></label>
    ${settings[name] ? `Saved <label><input type="checkbox" name="clear-${name}"> Remove</label>` : ''}${keyLink(name)}
    ${name === 'tvdbPin' ? '' : `<button class="secondary" type="button" data-test-provider="${name === 'tmdbToken' ? 'tmdb' : 'tvdb'}">Test ${name === 'tmdbToken' ? 'TMDB' : 'TheTVDB'} key</button>`}</div>`)
    .join('') + `<p><label class="choice"><input type="checkbox" name="imdb"${settings.imdb ? ' checked' : ''}>
      Use Cinemeta for IMDb ratings, credits, runtime, year, and backdrop</label></p><p role="status" data-test-status></p>`;
}

export function createAccounts(directory, publicUrl, { secrets, testCredentials = testProviderCredentials } = {}) {
  const origin = new URL(publicUrl).origin;
  const storage = join(directory, 'accounts');
  const file = (id) => join(storage, `${id}.json`);
  async function readStored(id) {
    try { return JSON.parse(await readFile(file(id), 'utf8')); }
    catch (error) {
      if (error.code === 'ENOENT') return null;
      throw error;
    }
  }

  async function read(id) {
    const account = await readStored(id);
    if (!account?.providerSecrets) return account;
    return { ...account, settings: secrets.open(account.providerSecrets, id) };
  }

  async function write(id, { settings, ...account }) {
    const record = secrets ? { ...account, providerSecrets: secrets.seal(settings, id) } : { ...account, settings };
    const temp = join(storage, `${random()}.tmp`);
    try {
      await writeFile(temp, JSON.stringify(record), { mode: 0o600, flag: 'wx' });
      await rename(temp, file(id));
    } finally {
      await unlink(temp).catch(() => {});
    }
  }

  const updates = new Set();
  const attempts = new Map();
  let pending = 0;
  function allow(key, maximum) {
    const now = Date.now();
    for (const [id, attempt] of attempts) if (attempt.until <= now) attempts.delete(id);
    const attempt = attempts.get(key);
    if (pending >= 4 || (attempt?.count ?? 0) >= maximum) return false;
    if (!attempt && attempts.size >= 1024) return false;
    attempts.set(key, { count: (attempt?.count ?? 0) + 1, until: attempt?.until ?? now + 600_000 });
    return true;
  }

  function page(res, status, content, heading = 'Vuniper settings', subtitle = '') {
    res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8' }).end(`<!doctype html>
      <html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width">
      <title>${heading} · Vuniper</title><style>${settingsStyle}</style>
      <main><header><div class="brand"><img class="mark" src="${manifest.logo}" alt="" width="38" height="38"> Vuniper</div>
      <p class="kicker">STREMIO ADD-ON</p><h1>${heading}</h1>${subtitle ? `<p>${subtitle}</p>` : ''}</header>
      <div class="panel">${content}</div><footer>Unofficial Vuniper add-on for Stremio.</footer></main><script>${settingsScript}</script></html>`);
  }

  function links(res, id, account, saved = false) {
    const manage = `${origin}/configure/${id}`;
    const install = `${origin}/install/${id}/${account.token}/manifest.json`;
    page(res, 200, `<p>${saved ? 'Settings saved.' : 'Your add-on is ready.'}</p>
      <p><a class="primary" href="${install.replace(/^https?:/, 'stremio:')}">Install in Stremio</a></p>
      <p>Or paste this manifest URL into Stremio Add-ons.</p><p><code>${install}</code></p>
      <p><a href="${manage}">Manage settings</a>. Bookmark this link and keep your password.
      Anyone with your install link can load your catalogs, so keep it private.</p>`, 'Install Vuniper', 'Use your personal link in Stremio.');
  }

  return {
    async migrate() {
      if (!secrets) return;
      await mkdir(storage, { recursive: true, mode: 0o700 });
      for (const entry of await readdir(storage)) {
        if (!new RegExp(`^${idPattern}\\.json$`).test(entry)) continue;
        const id = entry.slice(0, -5);
        const account = await readStored(id);
        if (account?.providerSecrets) secrets.open(account.providerSecrets, id);
        else if (account?.settings) await write(id, account);
      }
    },

    async resolve(path) {
      const match = new RegExp(`^/install/(${idPattern})/(${idPattern})(/.*)$`).exec(path);
      if (!match) return null;
      const [, id, token, pathname] = match;
      const account = await readStored(id);
      if (!account || !timingSafeEqual(Buffer.from(token), Buffer.from(account.token))) return null;
      const settings = account.providerSecrets ? secrets.open(account.providerSecrets, id) : account.settings;
      return { id, pathname, settings, revision: account.revision };
    },

    async handle(req, res, pathname) {
      const legacy = pathname === '/settings' || new RegExp(`^/settings/${idPattern}$`).test(pathname);
      if (legacy) {
        res.writeHead(308, { Location: pathname.replace('/settings', '/configure'), 'Referrer-Policy': 'no-referrer' }).end();
        return true;
      }
      const manage = new RegExp(`^/configure/(${idPattern})$`).exec(pathname);
      if (pathname !== '/configure' && !manage) return false;
      for (const header of ['Access-Control-Allow-Origin', 'Access-Control-Allow-Methods', 'Access-Control-Allow-Headers']) {
        res.removeHeader(header);
      }
      res.setHeader('Content-Security-Policy', `default-src 'none'; style-src 'sha256-${settingsStyleHash}'; img-src ${new URL(manifest.logo).origin}; script-src 'sha256-${settingsScriptHash}'; connect-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'`);
      res.setHeader('Referrer-Policy', 'same-origin');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Cache-Control', 'no-store');
      const passwordField = (newPassword) => `<p><label>Password
        <input type="password" name="password" required minlength="12" maxlength="128"
        autocomplete="${newPassword ? 'new-password' : 'current-password'}"></label></p>`;
      if (req.method === 'GET') {
        page(res, 200, manage
          ? `<form method="post">${passwordField(false)}<button>Unlock settings</button></form>`
          : `<form method="post"><section><h2>Metadata providers</h2>
             <p class="hint">Add TMDB for movie details or TheTVDB for series. Leave these blank to use Vuniper metadata.</p>
             ${providerFields()}</section><section><h2>Protect your settings</h2>
             <p class="hint">Choose a password of at least 12 characters. You’ll use it when you come back to edit your settings.</p>
             ${passwordField(true)}<button>Generate install link</button></section></form>`,
          manage ? 'Unlock settings' : 'Set up Vuniper',
          manage ? 'Enter the password you chose when you created your install link.'
            : 'Bring streaming release dates and curated movie and series lists to your Stremio Board.');
        return true;
      }
      if (req.method !== 'POST') { res.writeHead(405, { Allow: 'GET, POST' }).end(); return true; }
      if (req.headers.origin !== origin || !req.headers['content-type']?.startsWith('application/x-www-form-urlencoded')) {
        res.writeHead(403).end();
        return true;
      }
      let body = '';
      for await (const chunk of req) {
        body += chunk;
        if (body.length > 8192) { res.writeHead(413).end(); return true; }
      }
      const form = new URLSearchParams(body);
      const password = form.get('password') ?? '';
      const provider = form.get('test');
      const testing = provider === 'tmdb' || provider === 'tvdb';
      const testReply = (status, message) => res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
        .end(JSON.stringify({ message }));
      if ((!testing || manage) && (password.length < 12 || password.length > 128)) {
        if (testing) testReply(400, 'Enter your settings password to test credentials.');
        else page(res, 400, '<p>Password must be 12 to 128 characters. Go back and try again.</p>');
        return true;
      }
      const id = manage?.[1] ?? random();
      const attemptKey = testing ? `provider-test:${manage ? id : 'registration'}` : manage ? id : 'registration';
      if (!allow(attemptKey, manage ? 8 : 20)) {
        res.setHeader('Retry-After', '600');
        if (testing) testReply(429, 'Too many attempts. Try again later.');
        else page(res, 429, '<p>Too many attempts. Try again later.</p>');
        return true;
      }
      pending++;
      try {
        if (!manage) {
          const settings = providerSettings(form);
          if (testing) {
            if (!settings) testReply(400, 'Invalid credential format.');
            else testReply(200, await testCredentials(provider, settings));
            return true;
          }
          if (!settings) { page(res, 400, '<p>Invalid credential format.</p>'); return true; }
          await mkdir(storage, { recursive: true, mode: 0o700 });
          if ((await readdir(storage)).length >= 1000) {
            page(res, 503, '<p>Registration is currently full.</p>');
            return true;
          }
          const salt = random();
          const hash = (await derive(password, salt, 64)).toString('hex');
          const account = { salt, hash, token: random(), revision: random(), settings };
          await write(id, account);
          links(res, id, account);
          return true;
        }
        const account = await read(id);
        const hash = await derive(password, account?.salt ?? id, 64);
        if (!account || !timingSafeEqual(hash, Buffer.from(account.hash, 'hex'))) {
          if (testing) testReply(401, 'Invalid settings password.');
          else page(res, 401, '<p>Invalid password or settings link. Go back and try again.</p>');
          return true;
        }
        if (!testing) attempts.delete(id);
        if (testing) {
          const settings = providerSettings(form, account.settings);
          if (!settings) testReply(400, 'Invalid credential format.');
          else testReply(200, await testCredentials(provider, settings));
          return true;
        }
        if (!form.has('save') && !form.has('rotate')) {
          page(res, 200, `<form method="post"><section><h2>Metadata providers</h2>${providerFields(account.settings)}</section>
            <section><h2>Confirm changes</h2>${passwordField(false)}
            <input type="hidden" name="revision" value="${account.revision}">
            <button name="save" value="1">Save settings</button></section>
            <section><h2>Replace install link</h2><p class="hint">This revokes the current link. Install the new link in Stremio.</p>
            <button class="secondary" name="rotate" value="1">Replace install link</button></section></form>`, 'Edit Vuniper settings',
            'Changes apply to your existing Stremio installation.');
          return true;
        }
        if (updates.has(id)) {
          page(res, 409, '<p>Settings are being updated. Reopen Configure and try again.</p>');
          return true;
        }
        updates.add(id);
        try {
          const current = await read(id);
          if (current.revision !== form.get('revision')) {
            page(res, 409, '<p>Settings changed. Reopen Configure and try again.</p>');
            return true;
          }
          const rotating = form.has('rotate');
          const settings = rotating ? current.settings : providerSettings(form, current.settings);
          if (!settings) { page(res, 400, '<p>Invalid credential format.</p>'); return true; }
          const next = { ...current, settings, revision: random(), token: rotating ? random() : current.token };
          await write(id, next);
          links(res, id, next, true);
        } finally {
          updates.delete(id);
        }
      } finally { pending--; }
      return true;
    },
  };
}
