import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCatalogProxyFetch } from '../src/catalog-proxy.js';

test('tries each proxy once on 429 and skips cooling proxies on later requests', async () => {
  const proxies = Array.from({ length: 10 }, (_, index) => `proxy-${index}`);
  let now = 0;
  let working = proxies[9];
  const tried = [];
  const fetchCatalog = createCatalogProxyFetch(proxies, {
    now: () => now,
    makeAgent: (proxy) => proxy,
    fetchImpl: async (_url, { dispatcher }) => {
      tried.push(dispatcher);
      return new Response(null, {
        status: dispatcher === working ? 200 : 429,
        headers: { 'Retry-After': '60' },
      });
    },
  });

  assert.equal((await fetchCatalog('https://api.vuniper.com', {})).status, 200);
  assert.deepEqual(tried.splice(0), proxies);
  working = proxies[0];
  assert.equal((await fetchCatalog('https://api.vuniper.com', {})).status, 429);
  assert.deepEqual(tried.splice(0), [proxies[9]]);
  assert.equal((await fetchCatalog('https://api.vuniper.com', {})).status, 429);
  assert.deepEqual(tried, []);
  now = 60_000;
  assert.equal((await fetchCatalog('https://api.vuniper.com', {})).status, 200);
  assert.deepEqual(tried, [proxies[9], proxies[0]]);
});

test('refreshes only after failure and tries replacements in the same request', async () => {
  let now = 0;
  let working = 'old';
  let lookups = 0;
  let webshareAvailable = true;
  const closed = [];
  const fetchCatalog = createCatalogProxyFetch(['old'], {
    now: () => now,
    makeAgent: (url) => ({ url, close: async () => { closed.push(url); } }),
    loadProxies: async () => {
      lookups++;
      if (!webshareAvailable) throw new Error('Webshare unavailable');
      return ['new'];
    },
    fetchImpl: async (_url, { dispatcher }) => {
      if (dispatcher.url !== working) throw new Error('Proxy unavailable');
      return new Response(dispatcher.url);
    },
  });

  assert.equal(await (await fetchCatalog('https://api.vuniper.com', {})).text(), 'old');
  assert.equal(lookups, 0);

  working = 'new';
  assert.equal(await (await fetchCatalog('https://api.vuniper.com', {})).text(), 'new');
  assert.equal(lookups, 1);
  assert.deepEqual(closed, ['old']);

  now += 5 * 60_000;
  working = null;
  webshareAvailable = false;
  await assert.rejects(fetchCatalog('https://api.vuniper.com', {}), /Proxy unavailable/);
  assert.equal(lookups, 2);
  assert.deepEqual(closed, ['old']);
  now += 5 * 60_000;
  working = 'new';
  assert.equal(await (await fetchCatalog('https://api.vuniper.com', {})).text(), 'new');
  assert.equal(lookups, 2);
});

test('an unresponsive proxy times out before the whole request budget is spent', async () => {
  let timedOut = false;
  const catalogFetch = createCatalogProxyFetch(['slow', 'working'], {
    makeAgent: (url) => url,
    attemptTimeoutMs: 15,
    fetchImpl: async (_url, { dispatcher, signal }) => {
      if (dispatcher === 'working') return new Response('working');
      await new Promise((_, reject) => {
        signal.addEventListener('abort', () => { timedOut = true; reject(signal.reason); }, { once: true });
        // AbortSignal.timeout is unref'd, as there is no network socket in this test.
        const keepAlive = setTimeout(() => reject(new Error('Proxy never timed out')), 300);
        signal.addEventListener('abort', () => clearTimeout(keepAlive), { once: true });
      });
    },
  });
  assert.equal(await (await catalogFetch('https://api.vuniper.com', {})).text(), 'working');
  assert.equal(timedOut, true);
});
