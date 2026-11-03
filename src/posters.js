import sharp from 'sharp';
import { calendarDate } from './catalog.js';

const width = 300;
const height = 450;
const maxSourceBytes = 2 * 1024 * 1024;
const ribbons = { streaming: 'STREAMING', release: 'RELEASE', season: 'NEW SHOW / SEASON' };
const dateFormat = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC',
});

// The image URL includes both source identity and release date. When Vuniper
// changes a date or artwork hash, clients receive a different poster URL.
export function datedPosterPath(source, day, ribbon = 'streaming') {
  if (calendarDate(day) !== day) throw new Error('Invalid release date.');
  if (!Object.hasOwn(ribbons, ribbon)) throw new Error('Invalid ribbon label.');
  const vuniper = /^https:\/\/img\.vuniper\.com\/posters-(movies|shows)\/([ms][a-z0-9]{7}_h[a-z0-9]{7})\.jpg$/.exec(source);
  const imdb = /^https:\/\/images\.metahub\.space\/poster\/medium\/(tt\d{7,})\/img$/.exec(source);
  if (vuniper && (vuniper[1] === 'shows') !== vuniper[2].startsWith('s')) {
    throw new Error('Unsupported poster source.');
  }
  const id = vuniper?.[2] ?? imdb?.[1];
  if (!id) throw new Error('Unsupported poster source.');
  return ribbon === 'streaming' ? `/poster/v3/${day}/${id}.jpg`
    : `/poster/v2/${ribbon}/${day}/${id}.jpg`;
}

export function parsePosterPath(path) {
  const legacy = /^\/poster\/v[13]\/(\d{4}-\d{2}-\d{2})\/([ms][a-z0-9]{7}_h[a-z0-9]{7}|tt\d{7,})\.jpg$/.exec(path);
  const labeled = /^\/poster\/v2\/(release|season)\/(\d{4}-\d{2}-\d{2})\/([ms][a-z0-9]{7}_h[a-z0-9]{7}|tt\d{7,})\.jpg$/.exec(path);
  if (!legacy && !labeled) return null;
  const [day, id] = legacy ? legacy.slice(1) : labeled.slice(2);
  const ribbon = legacy ? 'streaming' : labeled[1];
  if (calendarDate(day) !== day) return null;
  return {
    day,
    ribbon,
    source: id.startsWith('tt')
      ? `https://images.metahub.space/poster/medium/${id}/img`
      : `https://img.vuniper.com/posters-${id.startsWith('s') ? 'shows' : 'movies'}/${id}.jpg`,
  };
}

export async function renderDatedPoster(input, day, ribbon = 'streaming') {
  if (calendarDate(day) !== day) throw new Error('Invalid release date.');
  if (!Object.hasOwn(ribbons, ribbon)) throw new Error('Invalid ribbon label.');
  const date = dateFormat.format(new Date(`${day}T00:00:00Z`));
  const strip = Buffer.from(`<svg width="300" height="450" xmlns="http://www.w3.org/2000/svg">
    <rect x="0" y="374" width="300" height="76" fill="#15131e"/>
    <rect x="0" y="374" width="300" height="2" fill="#bdabf3"/>
    <text x="150" y="398" text-anchor="middle" font-family="Arial, DejaVu Sans, sans-serif" font-size="11" font-weight="700" letter-spacing="2" fill="#c7b8ef">${ribbons[ribbon]}</text>
    <text x="150" y="422" text-anchor="middle" font-family="Arial, DejaVu Sans, sans-serif" font-size="21" font-weight="700" fill="#ffffff">${date}</text>
  </svg>`);
  return sharp(input, { limitInputPixels: 20_000_000 })
    .rotate()
    .resize(width, height, { fit: 'cover' })
    .composite([{ input: strip }])
    .jpeg({ quality: 82 })
    .toBuffer();
}

async function readImage(response) {
  if (Number(response.headers.get('content-length')) > maxSourceBytes) {
    await response.body?.cancel();
    throw new Error('Poster exceeds the image size limit.');
  }
  const chunks = [];
  let size = 0;
  if (!response.body) throw new Error('Poster response is empty.');
  const reader = response.body.getReader();
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxSourceBytes) {
        await reader.cancel();
        throw new Error('Poster exceeds the image size limit.');
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  return Buffer.concat(chunks);
}

export function createPosterService({ fetchImpl = fetch, maxCached = 128, now = Date.now } = {}) {
  const cache = new Map();
  const inFlight = new Map();
  return {
    async getPoster(path) {
      const poster = parsePosterPath(path);
      if (!poster) throw new Error('Invalid poster path.');
      const cached = cache.get(path);
      if (cached && cached.expires > now()) {
        cache.delete(path);
        cache.set(path, cached);
        return cached.buffer;
      }
      cache.delete(path);
      if (inFlight.has(path)) return inFlight.get(path);
      const request = (async () => {
        const response = await fetchImpl(poster.source, { signal: AbortSignal.timeout(10_000) });
        if (!response.ok) throw new Error(`Poster source returned HTTP ${response.status}.`);
        const buffer = await renderDatedPoster(await readImage(response), poster.day, poster.ribbon);
        cache.set(path, { buffer, expires: now() + 6 * 60 * 60 * 1000 });
        while (cache.size > maxCached) cache.delete(cache.keys().next().value);
        return buffer;
      })().finally(() => inFlight.delete(path));
      inFlight.set(path, request);
      return request;
    },
  };
}
