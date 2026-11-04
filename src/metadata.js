import { createProviderLookup } from './providers.js';

const CINEMETA = 'https://v3-cinemeta.strem.io';
const CACHE_LIMIT = 2000;
const CACHE_TTL = 6 * 60 * 60 * 1000;
const RETRY_TTL = 60 * 1000;

function searchLinks(category, names) {
  return names.map((name) => ({
    category,
    name,
    url: `stremio:///search?search=${encodeURIComponent(name)}`,
  }));
}

export function addPreviewLinks(meta, details) {
  const cast = details?.cast?.length ? details.cast : meta.cast;
  const overview = typeof details?.overview === 'string' ? details.overview.trim() : '';
  meta = {
    ...meta,
    description: overview || meta.description,
    ...(details?.runtime && { runtime: details.runtime }),
    ...(details?.releaseInfo && { releaseInfo: details.releaseInfo }),
    ...(details?.background && { background: details.background }),
  };
  const director = details?.director?.length ? details.director : meta.director;
  const rating = details?.imdbRating;
  const links = [
    ...searchLinks('Genres', meta.genres ?? []),
    ...searchLinks('Cast', cast ?? []),
    ...searchLinks('Directors', director ?? []),
  ];
  if (typeof rating === 'string' && /^(?:[0-9](?:\.\d+)?|10(?:\.0+)?)$/.test(rating)) {
    links.unshift({ category: 'imdb', name: rating, url: `https://imdb.com/title/${meta.id}` });
    return { ...meta, cast, director, imdbRating: rating, links };
  }
  return { ...meta, cast, director, links };
}

export function createMetadataService({ fetchImpl = fetch, settings = { imdb: true } } = {}) {
  const lookupProvider = createProviderLookup(settings, fetchImpl);
  const names = (value) => Array.isArray(value)
    ? value.filter((name) => typeof name === 'string' && name.trim()) : [];
  const cache = new Map();
  const inFlight = new Map();

  async function getDetails({ type, id }) {
    const key = `${type}/${id}`;
    const cached = cache.get(key);
    if (cached?.expires > Date.now()) return cached.details;
    if (inFlight.has(key)) return inFlight.get(key);

    const request = (async () => {
      const signal = AbortSignal.timeout(2000);
      const providerEnabled = type === 'movie' ? settings.tmdbToken : settings.tvdbKey;
      const providerRequest = lookupProvider({ type, id }, signal).catch(() => undefined);
      let details;
      try {
        if (settings.imdb) {
          const response = await fetchImpl(`${CINEMETA}/meta/${key}.json`, {
            signal,
          });
          if (response.ok) {
            const { meta } = await response.json();
            if (meta?.id === id && meta.type === type) {
              details = {
                cast: names(meta.cast),
                director: names(meta.director),
                imdbRating: meta.imdbRating,
                runtime: typeof meta.runtime === 'string' ? meta.runtime.trim() : undefined,
                releaseInfo: typeof meta.releaseInfo === 'string' ? meta.releaseInfo.trim() : undefined,
                background: typeof meta.background === 'string' && /^https?:\/\//i.test(meta.background)
                  ? meta.background : undefined,
              };
            }
          }
        }
      } catch {
        // A metadata failure should still leave the Vuniper catalog usable.
      }
      const provider = await providerRequest;
      const complete = (!settings.imdb || details) && (!providerEnabled || provider);
      if (provider) {
        const cast = names(provider.cast);
        const director = names(provider.director);
        details = {
          ...details,
          overview: provider.overview,
          cast: cast.length ? cast : details?.cast,
          director: director.length ? director : details?.director,
        };
      }
      cache.delete(key);
      cache.set(key, { details, expires: Date.now() + (complete ? CACHE_TTL : RETRY_TTL) });
      if (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value);
      return details;
    })().finally(() => inFlight.delete(key));
    inFlight.set(key, request);
    return request;
  }

  return async function enrich(metas) {
    if (!settings.imdb && !settings.tmdbToken && !settings.tvdbKey) {
      return metas.map((meta) => addPreviewLinks(meta));
    }
    const deadline = Date.now() + 2500;
    const result = metas.map((meta) => addPreviewLinks(meta));
    let next = 0;
    await Promise.all(Array.from({ length: Math.min(12, metas.length) }, async () => {
      while (next < metas.length && Date.now() < deadline) {
        const index = next++;
        result[index] = addPreviewLinks(metas[index], await getDetails(metas[index]));
      }
    }));
    return result;
  };
}
