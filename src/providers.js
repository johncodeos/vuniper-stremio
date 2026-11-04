const TMDB = 'https://api.themoviedb.org/3';
const TVDB = 'https://api4.thetvdb.com/v4';

async function readProvider(fetchImpl, url, bearer, signal, options = {}) {
  const response = await fetchImpl(url, {
    ...options, signal, redirect: 'error',
    headers: { ...options.headers, ...(bearer && { Authorization: `Bearer ${bearer}` }) },
  });
  if (!response.ok) {
    const error = new Error(`Metadata provider HTTP ${response.status}`);
    error.status = response.status;
    throw error;
  }
  return response.json();
}

async function loginTvdb(settings, fetchImpl, signal) {
  const { data } = await readProvider(fetchImpl, `${TVDB}/login`, null, signal, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ apikey: settings.tvdbKey, ...(settings.tvdbPin && { pin: settings.tvdbPin }) }),
  });
  if (!data?.token) throw new Error('Missing TVDB token');
  return data.token;
}

export async function testProviderCredentials(provider, settings, fetchImpl = fetch) {
  const credential = provider === 'tmdb' ? settings.tmdbToken : settings.tvdbKey;
  const name = provider === 'tmdb' ? 'TMDB' : 'TheTVDB';
  if (!credential) return `Enter a ${name} credential first.`;
  try {
    const signal = AbortSignal.timeout(4000);
    if (provider === 'tmdb') {
      await readProvider(fetchImpl, `${TMDB}/configuration`, credential, signal);
    } else {
      await loginTvdb(settings, fetchImpl, signal);
    }
    return `${name} credentials are valid.`;
  } catch (error) {
    return [401, 403].includes(error.status) ? `${name} rejected these credentials.`
      : `Could not reach ${name} or verify these credentials. Try again shortly.`;
  }
}

export function createProviderLookup(settings, fetchImpl) {
  let token;
  let login;
  const read = (url, bearer, signal) => readProvider(fetchImpl, url, bearer, signal);

  return async ({ type, id }, signal) => {
    if (type === 'movie' && settings.tmdbToken) {
      const find = await read(`${TMDB}/find/${id}?external_source=imdb_id`, settings.tmdbToken, signal);
      const movieId = find.movie_results?.[0]?.id;
      if (!Number.isSafeInteger(movieId)) return;
      const movie = await read(`${TMDB}/movie/${movieId}?append_to_response=credits`, settings.tmdbToken, signal);
      return {
        overview: movie.overview,
        cast: movie.credits?.cast?.slice(0, 10).map(({ name }) => name),
        director: movie.credits?.crew?.filter(({ job }) => job === 'Director').map(({ name }) => name),
      };
    }
    if (type === 'series' && settings.tvdbKey) {
      if (!token || token.expires <= Date.now()) {
        login ??= loginTvdb(settings, fetchImpl, AbortSignal.timeout(2000))
          .then((value) => { token = { value, expires: Date.now() + 23 * 60 * 60 * 1000 }; })
          .finally(() => { login = undefined; });
        await login;
      }
      const currentToken = token;
      const readTvdb = (url) => read(url, currentToken.value, signal).catch((error) => {
        if (error.status === 401 && token === currentToken) token = undefined;
        throw error;
      });
      const found = await readTvdb(`${TVDB}/search/remoteid/${id}`);
      const seriesId = found.data?.find(({ series }) => Number.isSafeInteger(series?.id))?.series.id;
      if (!seriesId) return;
      const { data } = await readTvdb(`${TVDB}/series/${seriesId}/extended`);
      return {
        overview: data?.overview,
        cast: data?.characters?.filter(({ peopleType }) => peopleType === 'Actor')
          .slice(0, 10).map(({ personName }) => personName),
      };
    }
  };
}
