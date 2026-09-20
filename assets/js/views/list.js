import { FEEDS, getFeed, getItem } from '../api.js';
import { pool, esc, scrollBehavior } from '../util.js';
import { getSaved } from '../store.js';
import { storyCard, enhanceCards, teardownPreviews, skeletonList, loadingBox, errorBox, emptyBox } from './components.js';

const PAGE_SIZE = 30;
const REFRESH_MS = 90 * 1000;

export async function renderList({ container, token, params }) {
  const feed = params.feed;
  const isSavedFeed = feed === 'saved';
  const conf = FEEDS[feed];
  const heading = isSavedFeed ? 'Kaydedilenler' : conf?.title || 'Gönderiler';

  container.innerHTML = `
<section class="view">
  <header class="view__head">
    <h1 class="view__title">${esc(heading)}</h1>
    <button class="btn btn--ghost" data-refresh>Yenile</button>
  </header>
  <div class="notice" data-notice role="status" hidden></div>
  <div class="stories" data-stories>${skeletonList()}</div>
  <div class="list-foot" data-foot></div>
</section>`;

  const listEl = container.querySelector('[data-stories]');
  const footEl = container.querySelector('[data-foot]');
  const noticeEl = container.querySelector('[data-notice]');

  let ids = [];
  let cursor = 0;
  let loading = false;
  let booting = false;
  let observer;
  let timer;

  const cleanup = () => {
    observer?.disconnect();
    teardownPreviews(listEl);
    clearInterval(timer);
  };

  async function loadIds(fresh = false) {
    if (isSavedFeed) return getSaved().map((s) => s.id);
    return getFeed(feed, { fresh });
  }

  async function renderPage() {
    if (loading || cursor >= ids.length) return;
    loading = true;
    footEl.innerHTML = loadingBox('Gönderiler yükleniyor…');

    const slice = ids.slice(cursor, cursor + PAGE_SIZE);
    try {
      const items = await pool(slice, 8, (id) => getItem(id).catch(() => null));
      if (token.cancelled) return;

      listEl.insertAdjacentHTML('beforeend', items.map(storyCard).join(''));
      enhanceCards(listEl, token);
      cursor += slice.length;

      if (cursor >= ids.length) {
        footEl.innerHTML = `<div class="list-end">Liste sonu — ${ids.length} gönderi</div>`;
      } else {
        footEl.innerHTML = `<button class="btn btn--wide" data-more>Daha fazla yükle</button><div data-sentinel class="sentinel"></div>`;
        watchSentinel();
      }
    } catch (err) {
      footEl.innerHTML = errorBox(err.message);
    } finally {
      loading = false;
    }
  }

  function watchSentinel() {
    observer?.disconnect();
    const sentinel = footEl.querySelector('[data-sentinel]');
    if (!sentinel) return;
    observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) renderPage();
      },
      { rootMargin: '600px 0px' }
    );
    observer.observe(sentinel);
  }

  async function boot(fresh = false) {
    if (booting) return; // "Yenile"ye üst üste basmak listeyi ikiye katlamamalı
    booting = true;
    listEl.innerHTML = skeletonList();
    footEl.innerHTML = '';
    cursor = 0;
    try {
      ids = (await loadIds(fresh)) || [];
      if (token.cancelled) return;
      listEl.innerHTML = '';
      if (!ids.length) {
        listEl.innerHTML = isSavedFeed
          ? emptyBox('Henüz kayıt yok', 'Gönderilerin sağındaki yer imi düğmesiyle listeye ekleyebilirsin.')
          : emptyBox('Gönderi bulunamadı');
        return;
      }
      await renderPage();
    } catch (err) {
      listEl.innerHTML = errorBox(err.message);
    } finally {
      booting = false;
    }
  }

  container.addEventListener('click', (e) => {
    if (e.target.closest('[data-more]')) renderPage();
    if (e.target.closest('[data-refresh]') || e.target.closest('[data-retry]')) {
      noticeEl.hidden = true;
      boot(true);
    }
    const noticeBtn = e.target.closest('[data-notice-reload]');
    if (noticeBtn) {
      noticeEl.hidden = true;
      boot(true);
      window.scrollTo({ top: 0, behavior: scrollBehavior() });
    }
  });

  // Canlı takip: akışın başında yeni gönderi belirdiyse haber ver.
  if (!isSavedFeed) {
    timer = setInterval(async () => {
      if (token.cancelled || document.hidden) return;
      try {
        const fresh = await getFeed(feed, { fresh: true });
        if (token.cancelled || !Array.isArray(fresh)) return;
        const known = new Set(ids.slice(0, PAGE_SIZE * 3));
        const count = fresh.slice(0, PAGE_SIZE).filter((id) => !known.has(id)).length;
        if (count > 0) {
          noticeEl.hidden = false;
          noticeEl.innerHTML = `<span>${count} yeni gönderi var.</span> <button class="btn btn--small" data-notice-reload>Yenile</button>`;
        }
      } catch {
        /* sessiz geç */
      }
    }, REFRESH_MS);
  }

  await boot();
  return cleanup;
}
