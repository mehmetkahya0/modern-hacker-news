// Hacker News resmi Firebase API'si: https://github.com/HackerNews/API
// Ek olarak arama için resmi HN Search (Algolia) API'si kullanılıyor.

const BASE = 'https://hacker-news.firebaseio.com/v0';
const SEARCH_BASE = 'https://hn.algolia.com/api/v1';

const ITEM_TTL = 5 * 60 * 1000;
const LIST_TTL = 60 * 1000;
const TIMEOUT_MS = 12 * 1000;

const cache = new Map();
const inflight = new Map();

// Kullanıcıya ham "HTTP 500" göstermek yerine ne olduğunu ve ne yapabileceğini söyler.
export class ApiError extends Error {
  constructor(message, { status = 0, kind = 'network', retryable = true } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.kind = kind;
    this.retryable = retryable;
  }
}

function errorForStatus(status) {
  if (status === 404) {
    return new ApiError('Bu içerik Hacker News tarafında bulunamadı.', { status, kind: 'notfound', retryable: false });
  }
  if (status === 429) {
    return new ApiError('Çok fazla istek gönderildi. Birkaç saniye sonra tekrar dene.', { status, kind: 'ratelimit' });
  }
  if (status >= 500) {
    return new ApiError('Hacker News sunucusu şu an yanıt vermiyor.', { status, kind: 'server' });
  }
  if (status >= 400) {
    return new ApiError('İstek geçersiz görünüyor.', { status, kind: 'client', retryable: false });
  }
  return new ApiError('Beklenmeyen bir yanıt alındı.', { status });
}

// AbortSignal.timeout her yerde yok; denk düşen küçük bir yedek.
function timeoutSignal(ms) {
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(), ms);
  return { signal: ctrl.signal, done: () => clearTimeout(id) };
}

async function request(url, tries = 2) {
  for (let attempt = 0; ; attempt++) {
    if (navigator.onLine === false) {
      throw new ApiError('İnternet bağlantısı yok. Bağlanınca tekrar dene.', { kind: 'offline' });
    }

    const t = timeoutSignal(TIMEOUT_MS);
    let err;
    try {
      const res = await fetch(url, { headers: { Accept: 'application/json' }, signal: t.signal });
      if (!res.ok) throw errorForStatus(res.status);
      return await res.json();
    } catch (caught) {
      // Zaman aşımı ile gerçek iptali ayır: ikisi de AbortError olarak gelir.
      if (caught?.name === 'AbortError') {
        err = new ApiError('İstek zaman aşımına uğradı. Bağlantı yavaş olabilir.', { kind: 'timeout' });
      } else if (caught instanceof ApiError) {
        err = caught;
      } else {
        err = new ApiError('Hacker News API’sine ulaşılamadı.', { kind: 'network' });
      }
    } finally {
      t.done();
    }

    if (!err.retryable || attempt >= tries) throw err;
    await new Promise((r) => setTimeout(r, 300 * (attempt + 1)));
  }
}

function cached(key, url, ttl) {
  const now = Date.now();
  const hit = cache.get(key);
  if (hit && now - hit.time < ttl) return Promise.resolve(hit.value);
  if (inflight.has(key)) return inflight.get(key);

  const p = request(url)
    .then((value) => {
      cache.set(key, { value, time: Date.now() });
      inflight.delete(key);
      return value;
    })
    .catch((err) => {
      inflight.delete(key);
      if (hit) return hit.value; // ağ hatasında bayat veriyle devam et
      throw err;
    });

  inflight.set(key, p);
  return p;
}

export const FEEDS = {
  top: { endpoint: 'topstories', label: 'Popüler', title: 'Popüler gönderiler' },
  new: { endpoint: 'newstories', label: 'Yeni', title: 'En yeni gönderiler' },
  best: { endpoint: 'beststories', label: 'En İyi', title: 'En iyi gönderiler' },
  ask: { endpoint: 'askstories', label: 'Ask HN', title: 'Ask HN' },
  show: { endpoint: 'showstories', label: 'Show HN', title: 'Show HN' },
  job: { endpoint: 'jobstories', label: 'İşler', title: 'İş ilanları' },
};

export function getFeed(feed, { fresh = false } = {}) {
  const conf = FEEDS[feed];
  if (!conf) return Promise.reject(new ApiError(`Bilinmeyen akış: ${feed}`, { kind: 'client', retryable: false }));
  const key = `feed:${feed}`;
  if (fresh) cache.delete(key);
  return cached(key, `${BASE}/${conf.endpoint}.json`, LIST_TTL);
}

export function getItem(id) {
  return cached(`item:${id}`, `${BASE}/item/${id}.json`, ITEM_TTL);
}

export function getUser(id) {
  return cached(`user:${id}`, `${BASE}/user/${encodeURIComponent(id)}.json`, ITEM_TTL);
}

export function getUpdates() {
  return cached('updates', `${BASE}/updates.json`, 30 * 1000);
}

export function search(query, { page = 0, tags = 'story', byDate = false } = {}) {
  const path = byDate ? 'search_by_date' : 'search';
  const url = `${SEARCH_BASE}/${path}?query=${encodeURIComponent(query)}&tags=${tags}&page=${page}&hitsPerPage=30`;
  return cached(`search:${path}:${tags}:${query}:${page}`, url, LIST_TTL);
}

export function invalidateItem(id) {
  cache.delete(`item:${id}`);
}

export const hnItemUrl = (id) => `https://news.ycombinator.com/item?id=${id}`;
export const hnUserUrl = (id) => `https://news.ycombinator.com/user?id=${encodeURIComponent(id)}`;
