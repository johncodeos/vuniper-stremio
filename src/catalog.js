import { decode } from 'he';
import { fetchItems } from './vuniper.js';

export const CATALOG_ID = 'streaming-soon';
export const CATALOG_PAGE_SIZE = 100;
export const CATALOGS = [
  {
    id: 'movies-now-online', name: 'Now Streaming', type: 'movie', mediaType: 'movies',
    section: 'web', dateField: 'web', ribbon: null, dateLabel: 'Streaming', order: 'desc',
  },
  {
    id: CATALOG_ID, name: 'Streaming Soon', type: 'movie', mediaType: 'movies',
    section: 'soon', dateField: 'web', ribbon: 'streaming', dateLabel: 'Streaming',
    order: 'asc', readAll: true, alphabeticalTies: true,
  },
  {
    id: 'hidden-gems', name: 'Hidden Gems', type: 'movie', mediaType: 'movies',
    section: 'gems', dateField: 'web', ribbon: null, dateLabel: 'Streaming', order: 'desc',
  },
  {
    id: 'new-shows-seasons', name: 'New Shows & Seasons', type: 'series', mediaType: 'shows',
    section: 'new', dateField: 'last_season_date', ribbon: null, dateLabel: 'New show / season', order: 'desc',
  },
];
export const findCatalog = (id, type) => CATALOGS.find((catalog) => catalog.id === id
  && (type === undefined || catalog.type === type));
export const manifest = {
  // Keep the original ID so this remains an update of the same add-on.
  id: 'community.vuniper.streamingsoon',
  version: '0.4.4',
  name: 'Vuniper',
  logo: 'https://vuniper.com/icons/icon-192x192.png',
  description: 'Find out what’s streaming now and what’s coming soon, discover hidden gems, and keep up with new shows and seasons. Upcoming movie posters show when each title starts streaming. An unofficial Stremio add-on powered by Vuniper.',
  resources: ['catalog'],
  types: ['movie', 'series'],
  catalogs: CATALOGS.map(({ id, name, type }) => ({
    type,
    id,
    name,
    extra: [{ name: 'skip', isRequired: false }],
  })),
  behaviorHints: { adult: false, p2p: false },
};

const text = (value) => typeof value === 'string' ? decode(value).trim() : '';
const list = (value) => typeof value === 'string'
  ? value.split(',').map(text).filter(Boolean) : [];
const dateFormat = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC',
});

export function calendarDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}(?:[ T].*)?$/.test(value)) return null;
  const day = value.slice(0, 10);
  const parsed = new Date(`${day}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === day
    ? day : null;
}

export function buildEntries(items, {
  order = 'asc',
  type = 'movie',
  dateField = 'web',
  ribbon = 'streaming',
  dateLabel = 'Streaming',
  alphabeticalTies = order === 'asc',
} = {}) {
  const entries = [];
  for (const item of items) {
    const day = calendarDate(item[dateField]);
    const name = text(item.title);
    // IMDb IDs keep movie details and playback compatible with other add-ons.
    if (!/^tt\d{7,}$/.test(item.imdb_id ?? '') || !day || !name) continue;
    const isSeries = type === 'series';
    const poster = (isSeries ? /^s[a-z0-9]{7}$/ : /^m[a-z0-9]{7}$/).test(item.uid)
      && /^h[a-z0-9]{7}$/.test(item.img_hash ?? '')
      ? `https://img.vuniper.com/posters-${isSeries ? 'shows' : 'movies'}/${item.uid}_${item.img_hash}.jpg`
      : `https://images.metahub.space/poster/medium/${item.imdb_id}/img`;
    const meta = {
      id: item.imdb_id,
      type,
      name,
      poster,
      posterShape: 'poster',
      description: `${dateLabel}: ${dateFormat.format(new Date(`${day}T00:00:00Z`))} (Vuniper).${text(item.description) ? `\n\n${text(item.description)}` : ''}`,
      genres: list(item.genres),
      cast: list(item.actors),
      director: list(item.director),
    };
    if (/^\d{4}$/.test(String(item.year ?? ''))) {
      meta.releaseInfo = String(item.year);
      if (isSeries) {
        const endYear = /^\d{4}$/.test(String(item.year_end ?? '')) ? String(item.year_end) : '';
        meta.releaseInfo += `-${endYear}`;
      }
    }
    if (text(item.runtime) && item.runtime !== '404') meta.runtime = text(item.runtime);
    // Do not replace Stremio's initial-release metadata with a streaming date
    // or a returning season's date. Catalog order and poster ribbons carry it.
    entries.push({ releaseDate: day, ribbon, meta });
  }
  // Keep the source's stable same-day order for feeds loaded a page at a time.
  // Sorting a partial feed alphabetically could shift earlier pages as more
  // same-day rows arrive. Streaming Soon is read in full and can use title ties.
  entries.sort((a, b) => (order === 'desc' ? -1 : 1) * a.releaseDate.localeCompare(b.releaseDate)
    || (alphabeticalTies ? a.meta.name.localeCompare(b.meta.name, 'en') || a.meta.id.localeCompare(b.meta.id) : 0));
  const seen = new Set();
  return entries.filter(({ meta }) => {
    if (seen.has(meta.id)) return false;
    seen.add(meta.id);
    return true;
  });
}

export function createCatalogService({ loadItems = fetchItems, logger = console } = {}) {
  const inFlight = new Map();
  return {
    getSnapshot(catalogId = CATALOG_ID, minimumEntries = CATALOG_PAGE_SIZE) {
      const catalog = findCatalog(catalogId);
      if (!catalog) return Promise.reject(new Error('Unknown catalog.'));
      // Fetch the prefix needed for this Stremio page in large feeds, rather
      // than downloading their entire history or future release schedule.
      const targetCount = catalog.readAll ? Infinity : minimumEntries;
      const key = `${catalogId}:${targetCount}`;
      // Share simultaneous requests only. Once complete, the next request
      // always fetches again; there is no saved or timed catalog cache.
      if (!inFlight.has(key)) {
        const request = Promise.resolve().then(() => loadItems(catalog.section, {
          mediaType: catalog.mediaType,
          cursorField: catalog.dateField,
          hasEnough: (items) => buildEntries(items, catalog).length >= targetCount,
          maxPages: Number.isFinite(targetCount) ? Math.max(25, Math.ceil(targetCount / 20) + 5) : 25,
        })).then((items) => {
          const entries = buildEntries(items, catalog);
          if (items.length > 0 && entries.length === 0) {
            throw new Error('Vuniper returned items without usable IMDb IDs or release dates.');
          }
          if (entries.length !== items.length) {
            logger.warn(`Catalog: ${items.length - entries.length} duplicate or incomplete records omitted.`);
          }
          return { entries, fetchedAt: new Date().toISOString() };
        }).finally(() => { inFlight.delete(key); });
        inFlight.set(key, request);
      }
      return inFlight.get(key);
    },
  };
}
