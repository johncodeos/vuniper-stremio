import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { readFileSync, writeFileSync, renameSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';

const digest = (value) => createHash('sha256').update(value).digest();

export function createSettings(directory) {
  const file = join(directory, 'providers.json');
  let current = { imdb: false };
  try {
    current = JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  return {
    get: () => current,
    save(next) {
      writeFileSync(`${file}.tmp`, JSON.stringify(next), { mode: 0o600 });
      renameSync(`${file}.tmp`, file);
      current = next;
    },
  };
}

export function createSettingsServer(settings, password) {
  const expected = digest(`Basic ${Buffer.from(`admin:${password}`).toString('base64')}`);
  const csrf = randomBytes(32).toString('hex');

  return createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'");
    if (req.url !== '/settings') { res.writeHead(404).end(); return; }
    if (!timingSafeEqual(expected, digest(req.headers.authorization ?? ''))) {
      res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="Vuniper settings"' }).end();
      return;
    }

    if (req.method === 'POST') {
      let body = '';
      try {
        for await (const chunk of req) {
          body += chunk;
          if (body.length > 8192) { res.writeHead(413).end(); return; }
        }
        const form = new URLSearchParams(body);
        if (form.get('csrf') !== csrf) { res.writeHead(403).end(); return; }
        const next = { ...settings.get(), imdb: form.has('imdb') };
        for (const key of ['tmdbToken', 'tvdbKey', 'tvdbPin']) {
          const value = form.get(key)?.trim();
          if (value && !/^[A-Za-z0-9._-]{1,2048}$/.test(value)) {
            res.writeHead(400).end('Invalid credential format.');
            return;
          }
          if (form.has(`clear-${key}`)) delete next[key];
          else if (value) next[key] = value;
        }
        settings.save(next);
        res.writeHead(303, { Location: '/settings' }).end();
      } catch {
        res.writeHead(500).end('Could not save provider settings.');
      }
      return;
    }

    if (req.method !== 'GET') { res.writeHead(405, { Allow: 'GET, POST' }).end(); return; }
    const current = settings.get();
    const field = (key, label) => `<p><label>${label} <input name="${key}" type="password" autocomplete="new-password" maxlength="2048"></label>
      ${current[key] ? '<strong>Saved</strong>' : 'Unset'}
      <label><input name="clear-${key}" type="checkbox"> Remove saved value</label></p>`;
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(`<!doctype html>
      <html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width">
      <title>Vuniper metadata settings</title><h1>Vuniper metadata settings</h1>
      <p>Vuniper supplies the catalog lists and dates. Optional providers enrich title previews.</p>
      <p>Leave a credential blank to keep its saved value. Saving applies to all users.</p>
      <form method="post" action="/settings">
        <input type="hidden" name="csrf" value="${csrf}">
        ${field('tmdbToken', 'TMDB API Read Access Token for movies')}
        ${field('tvdbKey', 'TheTVDB API key for series')}
        ${field('tvdbPin', 'TheTVDB subscriber PIN, if required')}
        <p><label><input name="imdb" type="checkbox"${current.imdb ? ' checked' : ''}> Use Cinemeta for IMDb ratings and fallback credits</label></p>
        <button>Save settings</button>
      </form></html>`);
  });
}
