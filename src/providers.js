const TMDB = 'https://api.themoviedb.org/3';
const TVDB = 'https://api4.thetvdb.com/v4';

export function createProviderLookup(settings, fetchImpl) {
  let token;
  let login;
  async function read(url, bearer, signal, options = {}) {
    const response = await fetchImpl(url, {
      ...options, signal, redirect: 'error',
      headers: { ...options.headers, ...(bearer && { Authorization: `Bearer ${bearer}` }) },
    });
    if (!response.ok) throw new Error(`Metadata provider HTTP ${response.status}`);
    return response.json();
  }

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
        login ??= read(`${TVDB}/login`, null, AbortSignal.timeout(2000), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ apikey: settings.tvdbKey, ...(settings.tvdbPin && { pin: settings.tvdbPin }) }),
        }).then(({ data }) => {
          if (!data?.token) throw new Error('Missing TVDB token');
          token = { value: data.token, expires: Date.now() + 23 * 60 * 60 * 1000 };
        }).finally(() => { login = undefined; });
        await login;
      }
      const found = await read(`${TVDB}/search/remoteid/${id}`, token.value, signal);
      const seriesId = found.data?.find(({ series }) => Number.isSafeInteger(series?.id))?.series.id;
      if (!seriesId) return;
      const { data } = await read(`${TVDB}/series/${seriesId}/extended`, token.value, signal);
      return {
        overview: data?.overview,
        cast: data?.characters?.filter(({ peopleType }) => peopleType === 'Actor')
          .slice(0, 10).map(({ personName }) => personName),
      };
    }
  };
}
