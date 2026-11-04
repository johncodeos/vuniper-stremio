import { isIPv4 } from 'node:net';
import { ProxyAgent } from 'undici';

const DEFAULT_COOLDOWN_MS = 5 * 60 * 1000;
const REFRESH_COOLDOWN_MS = 5 * 60 * 1000;

export async function loadWebshareProxies(token) {
  const response = await fetch('https://proxy.webshare.io/api/v2/proxy/list/?mode=direct&page_size=25', {
    headers: { Authorization: `Token ${token}` },
    redirect: 'error',
    signal: AbortSignal.timeout(3000),
  });
  if (!response.ok) throw new Error(`Webshare proxy list returned HTTP ${response.status}`);
  const { results } = await response.json();
  return results.filter(({ valid, proxy_address, port, username, password }) => valid === true
    && isIPv4(proxy_address) && Number.isInteger(port) && port > 0 && port <= 65535
    && typeof username === 'string' && username && typeof password === 'string' && password)
    .slice(0, 10)
    .map(({ proxy_address, port, username, password }) =>
      `http://${encodeURIComponent(username)}:${encodeURIComponent(password)}@${proxy_address}:${port}/`);
}

function retryTime(header, now) {
  if (header && /^\d+$/.test(header)) return now + Number(header) * 1000;
  const date = Date.parse(header);
  return date > now ? date : now + DEFAULT_COOLDOWN_MS;
}

export function createCatalogProxyFetch(proxyUrls, {
  fetchImpl = fetch,
  makeAgent = (url) => new ProxyAgent(url),
  now = Date.now,
  loadProxies,
  attemptTimeoutMs = 2500,
} = {}) {
  const makeProxy = (url) => ({ url, dispatcher: makeAgent(url), retryAt: 0 });
  let proxies = proxyUrls.map(makeProxy);
  let preferred = proxies[0];
  let nextRefresh = 0;
  let refreshing;
  let active = 0;
  const retired = [];

  async function refresh() {
    try {
      const urls = [...new Set(await loadProxies())];
      if (urls.length) {
        const next = urls.map((url) => proxies.find((proxy) => proxy.url === url) ?? makeProxy(url));
        retired.push(...proxies.filter((proxy) => !next.includes(proxy)));
        proxies = next;
        console.info(`Webshare proxy list refreshed with ${next.length} endpoints.`);
        if (!proxies.includes(preferred)) preferred = proxies[0];
      }
    } catch {
      console.warn('Webshare proxy list refresh failed. Keeping the current endpoints.');
    }
  }

  function refreshAfterFailure() {
    if (refreshing) return refreshing;
    if (!loadProxies || now() < nextRefresh) return undefined;
    nextRefresh = now() + REFRESH_COOLDOWN_MS;
    refreshing = refresh().finally(() => {
      refreshing = undefined;
      if (active === 0) closeRetired();
    });
    return refreshing;
  }

  return async (url, init) => {
    const tried = new Set();
    let refreshRequest;
    let lastError;
    let rateLimited = false;
    active++;
    try {
      // Walk the current pool first. If Webshare found replacements, try those once.
      for (let pass = 0; pass < 2; pass++) {
        const pool = proxies;
        const start = Math.max(0, pool.indexOf(preferred));
        for (let offset = 0; offset < pool.length; offset++) {
          init.signal?.throwIfAborted();
          const proxy = pool[(start + offset) % pool.length];
          if (proxy.retryAt > now() || tried.has(proxy.url)) continue;
          tried.add(proxy.url);

          let response;
          try {
            const timeout = AbortSignal.timeout(attemptTimeoutMs);
            const signal = init.signal ? AbortSignal.any([init.signal, timeout]) : timeout;
            response = await fetchImpl(url, { ...init, signal, dispatcher: proxy.dispatcher, redirect: 'error' });
          } catch (error) {
            init.signal?.throwIfAborted();
            lastError = error;
            proxy.retryAt = Math.max(proxy.retryAt, now() + DEFAULT_COOLDOWN_MS);
            refreshRequest ??= refreshAfterFailure();
            continue;
          }

          if (response.status !== 429) {
            if (response.ok && proxies.includes(proxy)) preferred = proxy;
            return response;
          }

          rateLimited = true;
          proxy.retryAt = Math.max(proxy.retryAt, retryTime(response.headers.get('retry-after'), now()));
          refreshRequest ??= refreshAfterFailure();
          await response.body?.cancel();
        }

        if (pass === 0) {
          refreshRequest ??= refreshAfterFailure();
          if (!refreshRequest) break;
          await refreshRequest;
        }
      }

      if (lastError && !rateLimited) throw lastError;
      return new Response(null, { status: 429 });
    } finally {
      active--;
      // A refresh may finish after a request has already succeeded.
      if (active === 0) closeRetired();
    }
  };

  function closeRetired() {
    for (const proxy of retired.splice(0)) void proxy.dispatcher.close().catch(() => {});
  }
}
