export const API_URL = 'https://api.vuniper.com';
const PAGE_SIZE = 21;
const SECTIONS = new Set(['movies:soon', 'movies:web', 'movies:gems', 'shows:new']);

export class VuniperError extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = 'VuniperError';
  }
}

// The website uses the last row's original category date as its pagination cursor.
// These are anonymous read requests; no user sessions or credentials are sent.
export async function fetchItems(section, {
  mediaType = 'movies',
  cursorField = mediaType === 'shows' ? 'last_season_date' : 'web',
  fetchImpl = fetch,
  timeoutMs = 20_000,
  maxPages = 25,
  hasEnough = () => false,
} = {}) {
  if (!SECTIONS.has(`${mediaType}:${section}`)) throw new VuniperError('Unsupported Vuniper category.');
  const signal = AbortSignal.timeout(timeoutMs);
  const movies = new Map();
  const cursors = new Set();
  let paginationCursor;

  for (let page = 0; page < maxPages; page += 1) {
    let response;
    let data;
    try {
      response = await fetchImpl(API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: 'https://vuniper.com',
          Accept: 'application/json',
        },
        body: JSON.stringify(page === 0 && section !== 'soon' ? {
          // Match the website's curated initial feed. In particular, a plain
          // `web` query also includes future dates and is not Movies Now Online.
          action: 'GET_MANY_ITEMS_KV',
          kvName: `${mediaType}_${section}`,
          streamItems: false,
        } : {
          action: 'GET_MANY_ITEMS',
          mediaType,
          section,
          streamItems: false,
          ...(paginationCursor === undefined ? {} : { paginationCursor }),
        }),
        signal,
      });
      // Vuniper's client treats 404 on a subsequent page as the end of the feed.
      if (response.status === 404 && page > 0) return [...movies.values()];
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      data = await response.json();
    } catch (cause) {
      throw new VuniperError('Could not fetch the latest Vuniper list.', { cause });
    }

    if (data?.ok !== true || !Array.isArray(data.items)
      || data.items.some((item) => !item || typeof item !== 'object' || Array.isArray(item)
        || typeof item.uid !== 'string')) {
      throw new VuniperError('Vuniper returned an unexpected item list.');
    }

    const previousSize = movies.size;
    for (const item of data.items) movies.set(item.uid, item);
    const collected = [...movies.values()];
    if (data.items.length < PAGE_SIZE || hasEnough(collected)) return collected;

    const cursor = data.items.at(-1)[cursorField];
    if (typeof cursor !== 'string' || !cursor || cursors.has(cursor)
      || movies.size === previousSize) {
      throw new VuniperError('Vuniper pagination stopped making progress.');
    }
    cursors.add(cursor);
    paginationCursor = cursor;
  }

  // Never present a silently truncated feed as a complete, sorted catalog.
  throw new VuniperError(`Vuniper exceeded the ${maxPages}-page safety limit.`);
}

export const fetchMovies = (section, options) => fetchItems(section, { ...options, mediaType: 'movies' });
export const fetchSoonMovies = (options) => fetchMovies('soon', options);
