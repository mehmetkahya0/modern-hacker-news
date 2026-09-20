import { getItem, invalidateItem, hnItemUrl } from '../api.js';
import {
  esc, timeAgo, fullDate, domainOf, nf, sanitize, createLimiter,
  scrollBehavior, restartAnimation, pool, shareOrCopy, stripHtml, setContentLang,
} from '../util.js';
import { markRead, getVisit, recordVisit } from '../store.js';
import { skeletonList, loadingBox, errorBox, emptyBox } from './components.js';
import { translateText, translateHtml, getTargetLang } from '../translate.js';

const TOP_BATCH = 15;
const NODE_BUDGET = 600; // tek seferde çekilecek yorum üst sınırı
const TREE_CONCURRENCY = 12;
const POLL_MS = 60 * 1000;

// `run` tüm ağaç için tek kuyruk; özyineleme derinleştikçe sınır çarpılmaz.
async function loadNode(id, depth, job) {
  if (job.budget.count >= NODE_BUDGET) return { id, truncated: true, depth };
  job.budget.count++;
  const c = await job.run(() => getItem(id)).catch(() => null);
  if (!c || job.token.cancelled) return null;
  let children = [];
  if (c.kids?.length && !c.deleted) {
    // Zamanlama serbest, ağ değil: bekleyen sözler ucuz, isteği kuyruk tutuyor.
    children = (await Promise.all(c.kids.map((kid) => loadNode(kid, depth + 1, job)))).filter(Boolean);
  }
  return { ...c, depth, children };
}

function countNodes(node) {
  if (!node) return 0;
  return 1 + (node.children || []).reduce((a, c) => a + countNodes(c), 0);
}

// `since`: son ziyaret zamanı (unix sn) — bundan sonra yazılan yorumlar işaretlenir.
function commentHtml(node, ctx) {
  if (node.truncated) {
    return `<li class="comment comment--more" style="--depth:${node.depth}">
      <a class="link" href="${hnItemUrl(node.id)}" target="_blank" rel="noopener noreferrer">Kalan yanıtları HN'de gör →</a>
    </li>`;
  }
  const dead = node.deleted || node.dead;
  const kidCount = countNodes(node) - 1;
  const isNew = Boolean(ctx.since) && node.time > ctx.since && !dead;
  const isOp = ctx.op && node.by === ctx.op;
  const body = dead ? `<p class="comment__dead">[silinmiş]</p>` : sanitize(node.text || '');

  return `
<li class="comment${isNew ? ' is-new' : ''}" style="--depth:${node.depth}" data-comment="${node.id}" tabindex="-1">
  <div class="comment__head">
    <button class="comment__toggle" data-toggle aria-expanded="true" title="Katla/aç">–</button>
    ${dead
      ? '<span class="comment__author">[silinmiş]</span>'
      : `<a class="comment__author" href="#/user/${encodeURIComponent(node.by || '')}">${esc(node.by || '')}</a>`}
    ${isOp ? '<span class="tag tag--op" title="gönderiyi paylaşan">OP</span>' : ''}
    ${isNew ? '<span class="tag tag--new">yeni</span>' : ''}
    <time class="comment__time" datetime="${new Date((node.time || 0) * 1000).toISOString()}" title="${fullDate(node.time)}">${timeAgo(node.time)}</time>
    <span class="comment__collapsed-info">${kidCount > 0 ? `${nf(kidCount)} yanıt` : 'katlandı'}</span>
    ${!dead ? `<button class="comment__translate icon-btn icon-btn--sm" data-translate-comment="${node.id}" title="Yorumu çevir (t)" aria-label="Yorumu çevir"><svg viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M2 3.5h7M5.5 2v1.5M3.5 13.5c1.5-2 3-4.5 5.5-6.5M3.5 7c1 1.5 2.5 3 4.5 4M10 14l3-7 3 7M11.2 11.5h4.6"/></svg></button>` : ''}
    <a class="comment__perma" href="#/item/${node.id}" title="Bu yanıt dalını aç">#</a>
  </div>
  <div class="comment__body" lang="en">${body}</div>
  ${node.children?.length ? `<ul class="comment__kids">${node.children.map((k) => commentHtml(k, ctx)).join('')}</ul>` : ''}
</li>`;
}

function storyHeader(story) {
  const url = story.url;
  const domain = url ? domainOf(url) : '';
  const text = story.text ? sanitize(story.text) : '';
  return `
<article class="item-head">
  <h1 class="item-head__title" lang="en">
    ${url
      ? `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(story.title || '')}</a>`
      : esc(story.title || '')}
  </h1>
  ${domain ? `<a class="item-head__domain" href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(domain)} ↗</a>` : ''}
  <div class="item-head__meta">
    ${story.score != null ? `<span class="meta meta--score"><svg viewBox="0 0 12 12" aria-hidden="true"><path d="M6 1.5 11 9H1z"/></svg>${nf(story.score)} puan</span>` : ''}
    ${story.by ? `<a class="meta meta--user" href="#/user/${encodeURIComponent(story.by)}">${esc(story.by)}</a>` : ''}
    <time class="meta" datetime="${new Date((story.time || 0) * 1000).toISOString()}" title="${fullDate(story.time)}">${timeAgo(story.time)}</time>
    <span class="meta">${nf(story.descendants ?? 0)} yorum</span>
    <button class="btn btn--ghost btn--small btn-translate-head" data-translate-head title="Başlık ve metni çevir (t)">
      <svg viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="width:14px;height:14px;display:inline-block;vertical-align:-2px;margin-right:3px;">
        <path d="M2 3.5h7M5.5 2v1.5M3.5 13.5c1.5-2 3-4.5 5.5-6.5M3.5 7c1 1.5 2.5 3 4.5 4M10 14l3-7 3 7M11.2 11.5h4.6"/>
      </svg>Çevir
    </button>
    ${shareButton()}
    <a class="meta meta--link" href="${hnItemUrl(story.id)}" target="_blank" rel="noopener noreferrer">HN'de aç ↗</a>
  </div>
  ${text ? `<div class="item-head__text prose" lang="en">${text}</div>` : ''}
  ${story.parts?.length ? '<div class="poll-slot" data-poll></div>' : ''}
</article>`;
}

// Paylaş: Web Share API varsa sistem sayfası, yoksa panoya kopyalama.
function shareButton() {
  return `<button class="btn btn--ghost btn--small" data-share-item type="button" title="Paylaş (Shift+S)">
      <svg viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="width:14px;height:14px;display:inline-block;vertical-align:-2px;margin-right:3px;">
        <circle cx="12" cy="3.5" r="2"/><circle cx="4" cy="8" r="2"/><circle cx="12" cy="12.5" r="2"/><path d="M5.8 7 10.2 4.5M5.8 9l4.4 2.5"/>
      </svg>Paylaş
    </button>`;
}

// Anket: seçenekler `parts` altında ayrı `pollopt` kayıtlarıdır.
// Çubuk en yüksek seçeneğe göre ölçeklenir (fark görünür kalsın), yüzde ise
// toplam oya göre yazılır. Sıra HN'deki sıradır; puana göre yeniden dizilmez.
function pollHtml(opts) {
  const total = opts.reduce((sum, o) => sum + (o.score || 0), 0);
  const max = Math.max(1, ...opts.map((o) => o.score || 0));
  return `
<section class="poll" aria-label="Anket sonuçları">
  <div class="poll__total">${nf(total)} oy · ${nf(opts.length)} seçenek</div>
  <ol class="poll__list">
    ${opts
      .map((o) => {
        const score = o.score || 0;
        const pct = total ? Math.round((score / total) * 100) : 0;
        const label = stripHtml(o.text || '') || '(boş seçenek)';
        return `
    <li class="poll__opt">
      <div class="poll__row">
        <span class="poll__text" lang="en">${sanitize(o.text || '') || esc(label)}</span>
        <span class="poll__score" title="${nf(score)} oy · toplamın %${pct}'i">${nf(score)}<span class="poll__pct">%${pct}</span></span>
      </div>
      <div class="poll__track"><i style="width:${Math.round((score / max) * 100)}%"></i></div>
    </li>`;
      })
      .join('')}
  </ol>
</section>`;
}

// Bir yorum bağlantısı doğrudan açıldığında: dalın kendisi başlık olur,
// üstünde kökü ve bir üst yanıtı gösteren bir iz kalır.
function commentHeader(node, root) {
  const dead = node.deleted || node.dead;
  const body = dead ? '<p class="comment__dead">[silinmiş]</p>' : sanitize(node.text || '');
  const rootHref = root ? `#/item/${root.id}` : node.parent ? `#/item/${node.parent}` : '#/top';
  const rootLabel = root ? root.title || 'Üst gönderi' : 'Üst gönderi';
  const upOne = node.parent && (!root || node.parent !== root.id);
  return `
<article class="item-head item-head--comment">
  <nav class="crumbs" aria-label="Bağlam">
    <span class="crumbs__kind">yanıt dalı</span>
    <span class="crumbs__sep" aria-hidden="true">·</span>
    <a class="crumbs__root" href="${rootHref}" lang="en">${esc(rootLabel)}</a>
  </nav>
  <div class="item-head__meta">
    ${node.by ? `<a class="meta meta--user" href="#/user/${encodeURIComponent(node.by)}">${esc(node.by)}</a>` : ''}
    <time class="meta" datetime="${new Date((node.time || 0) * 1000).toISOString()}" title="${fullDate(node.time)}">${timeAgo(node.time)}</time>
    ${upOne ? `<a class="meta meta--link" href="#/item/${node.parent}">↑ bir üst yanıt</a>` : ''}
    ${!dead
      ? `<button class="btn btn--ghost btn--small btn-translate-head" data-translate-head title="Yorumu çevir (t)">
      <svg viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="width:14px;height:14px;display:inline-block;vertical-align:-2px;margin-right:3px;">
        <path d="M2 3.5h7M5.5 2v1.5M3.5 13.5c1.5-2 3-4.5 5.5-6.5M3.5 7c1 1.5 2.5 3 4.5 4M10 14l3-7 3 7M11.2 11.5h4.6"/>
      </svg>Çevir
    </button>`
      : ''}
    ${shareButton()}
    <a class="meta meta--link" href="${hnItemUrl(node.id)}" target="_blank" rel="noopener noreferrer">HN'de aç ↗</a>
  </div>
  <div class="item-head__text prose" lang="en">${body}</div>
</article>`;
}

// Bir yorumdan köke tırmanır. Zincir uzunsa erken durur: gövde zaten çizilmiş
// durumda olur, iz eksik kalır ama görünüm beklemez.
async function resolveRoot(node, max = 12) {
  let cur = node;
  for (let i = 0; i < max && cur?.type === 'comment' && cur.parent; i++) {
    cur = await getItem(cur.parent).catch(() => null);
  }
  return cur && cur.type !== 'comment' ? cur : null;
}

export async function renderItem({ container, token, params }) {
  const id = Number(params.id);
  if (!Number.isFinite(id) || id <= 0) {
    container.innerHTML = emptyBox('Geçersiz gönderi adresi', `"${params.id}" bir gönderi numarası değil.`);
    return null;
  }
  const visit = getVisit(id);
  const since = visit?.t || null; // ilk ziyarette hiçbir şey "yeni" sayılmaz

  container.innerHTML = `
<section class="view view--item">
  <a class="back-link" href="#/top">← Geri</a>
  <div data-head>${skeletonList(1)}</div>
  <div class="notice" data-live role="status" hidden></div>
  <div class="comments-head" data-comments-head hidden>
    <h2 class="comments-head__title" data-comments-title></h2>
    <div class="comments-head__tools" data-comments-tools></div>
  </div>
  <div class="thread-search" data-thread-search hidden>
    <svg class="thread-search__icon" viewBox="0 0 16 16" aria-hidden="true"><path d="M11 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0zm-.7 4.7a6 6 0 1 1 1.4-1.4l3.3 3.3-1.4 1.4z"/></svg>
    <input class="thread-search__input" type="search" data-search-input placeholder="Yüklü yorumlarda ara…" aria-label="Yorumlarda ara" autocomplete="off">
    <span class="thread-search__count" data-search-count aria-live="polite"></span>
    <button class="icon-btn icon-btn--sm" type="button" data-search-prev title="Önceki eşleşme (Shift+Enter)" aria-label="Önceki eşleşme">↑</button>
    <button class="icon-btn icon-btn--sm" type="button" data-search-next title="Sonraki eşleşme (Enter)" aria-label="Sonraki eşleşme">↓</button>
    <button class="icon-btn icon-btn--sm" type="button" data-search-close title="Aramayı kapat (Esc)" aria-label="Aramayı kapat">✕</button>
  </div>
  <ul class="comments" data-comments></ul>
  <div class="list-foot" data-foot></div>
</section>`;

  const headEl = container.querySelector('[data-head]');
  const commentsEl = container.querySelector('[data-comments]');
  const commentsHeadEl = container.querySelector('[data-comments-head]');
  const titleEl = container.querySelector('[data-comments-title]');
  const toolsEl = container.querySelector('[data-comments-tools]');
  const searchEl = container.querySelector('[data-thread-search]');
  const searchInput = container.querySelector('[data-search-input]');
  const footEl = container.querySelector('[data-foot]');
  const liveEl = container.querySelector('[data-live]');

  let story;
  let kids = [];
  let cursor = 0;
  let baseTotal = 0;
  let timer;
  let navIndex = -1;
  let loadingBatch = false;
  let sortMode = 'default';
  let allCollapsed = false;
  let orderSeq = 0;
  let searchHits = [];
  let searchIndex = -1;

  const ctx = { since, op: null };

  /* --- yorum yükleme --- */

  async function loadBatch() {
    if (loadingBatch || cursor >= kids.length) return;
    loadingBatch = true;
    // İmleci hemen ilerlet: eş zamanlı ikinci çağrı aynı dilimi tekrar çekmesin.
    const slice = kids.slice(cursor, cursor + TOP_BATCH);
    cursor += slice.length;
    footEl.innerHTML = loadingBox('Yorumlar yükleniyor…');
    try {
      const job = { budget: { count: 0 }, run: createLimiter(TREE_CONCURRENCY), token };
      // Sıra korunsun diye önce yer tutucular; her dal çözüldükçe yerine geçer.
      // Böylece ilk yorum, en derin dal beklenmeden okunabilir hale gelir.
      const slots = slice.map(() => {
        const li = document.createElement('li');
        li.className = 'comment comment--pending';
        li.innerHTML = '<span class="sk sk--source"></span><span class="sk sk--title"></span>';
        li.setAttribute('aria-hidden', 'true');
        return li;
      });
      commentsEl.append(...slots);

      let painted = false;
      await Promise.all(
        slice.map(async (kid, i) => {
          const node = await loadNode(kid, 0, job);
          if (token.cancelled || !slots[i].isConnected) return;
          if (!node) {
            slots[i].remove();
            return;
          }
          slots[i].outerHTML = commentHtml(node, ctx);
          // Başlık sayacını her dalda yeniden yazma: "Yeniye atla" düğmesi
          // yükleme sürerken elin altından kaybolmasın.
          if (!painted) {
            painted = true;
            paintNewSummary();
          }
        })
      );
      if (token.cancelled) return;

      footEl.innerHTML =
        cursor < kids.length
          ? `<button class="btn btn--wide" data-more>Daha fazla yorum (${nf(kids.length - cursor)})</button>`
          : '';
      paintNewSummary();
    } catch (err) {
      commentsEl.querySelectorAll('.comment--pending').forEach((n) => n.remove());
      cursor -= slice.length; // başarısız dilim tekrar denenebilir kalsın
      footEl.innerHTML = errorBox(err.message);
    } finally {
      loadingBatch = false;
    }
    // Yükleme bitti: yeni gelenler de damgalansın, açık sıralamaya ve
    // açık aramaya katılsın. `applySort` yükleme sürerken çalışmayı reddeder.
    if (token.cancelled) return;
    stampOrder();
    if (allCollapsed) {
      commentsEl.querySelectorAll(':scope > .comment').forEach((li) => setCollapsed(li, true));
    }
    if (sortMode !== 'default') applySort();
    if (searchInput.value.trim()) setSearch(searchInput.value);
  }

  // Anket seçenekleri ayrı kayıtlardır; başlık çizildikten sonra doldurulur.
  async function loadPoll(parts) {
    const slot = headEl.querySelector('[data-poll]');
    if (!slot) return;
    slot.innerHTML = loadingBox('Anket seçenekleri yükleniyor…');
    try {
      const opts = (await pool(parts, 8, (pid) => getItem(pid).catch(() => null))).filter(Boolean);
      if (token.cancelled || !slot.isConnected) return;
      slot.innerHTML = opts.length ? pollHtml(opts) : '';
    } catch {
      slot.innerHTML = ''; // anket kozmetik değil ama gönderiyi de engellememeli
    }
  }

  function shareCurrent() {
    if (!story) return;
    const isComment = story.type === 'comment';
    // Paylaşılan adres dışarıdan açılabilmeli: bağlantı gönderisinde makale,
    // metin gönderisinde ve yorumda HN sayfası.
    shareOrCopy({
      title: isComment ? `${story.by || 'HN'} — yorum` : story.title || 'Hacker News',
      text: isComment ? undefined : story.title,
      url: (!isComment && story.url) || hnItemUrl(story.id),
    });
  }

  // Başlık ve araçlar durumdan yeniden çizilir; sıralama seçimi ile katlama
  // durumu değişkenlerde durduğu için her çizimde sıfırlanmaz.
  function paintNewSummary() {
    const total = story?.descendants ?? kids.length;
    const newCount = commentsEl.querySelectorAll('.comment.is-new').length;
    commentsHeadEl.hidden = false;
    titleEl.innerHTML = `${nf(total)} yorum${
      newCount ? ` <span class="tag tag--new">${nf(newCount)} yeni</span>` : ''
    }`;
    const opt = (value, label) =>
      `<option value="${value}"${sortMode === value ? ' selected' : ''}>${label}</option>`;
    toolsEl.innerHTML = `
      <label class="thread-sort">
        <span class="sr-only">Üst düzey yorumların sırası</span>
        <select class="select" data-sort title="Üst düzey yorumların sırası">
          ${opt('default', 'HN sırası')}${opt('new', 'En yeni')}${opt('replies', 'En çok yanıt')}
        </select>
      </label>
      <button class="btn btn--ghost btn--small" data-search-toggle title="Yüklü yorumlarda ara (f)">Ara</button>
      <button class="btn btn--ghost btn--small" data-translate-all-comments title="Tüm yüklü yorumları çevir">Tümünü Çevir</button>
      ${newCount ? `<button class="btn btn--ghost btn--small" data-jump-new>Yeniye atla (n)</button>` : ''}
      <button class="btn btn--ghost btn--small" data-collapse-all>${allCollapsed ? 'Hepsini aç' : 'Hepsini katla'}</button>`;
  }

  /* --- katlama, sıralama, arama: hepsi yüklü ağaç üzerinde, ek istek yok --- */

  function setCollapsed(li, collapsed) {
    li.classList.toggle('is-collapsed', collapsed);
    const t = li.querySelector(':scope > .comment__head > [data-toggle]');
    if (t) {
      t.textContent = collapsed ? '+' : '–';
      t.setAttribute('aria-expanded', String(!collapsed));
    }
  }

  // HN sırası DOM sırasıdır; sıralama onu bozacağı için önce numaralanır.
  // Yalnızca çözülmüş kartlar damgalanır: yer tutucular yerlerini kaybetmesin.
  function stampOrder() {
    commentsEl
      .querySelectorAll(':scope > .comment[data-comment]:not([data-order])')
      .forEach((li) => {
        li.dataset.order = String(orderSeq++);
      });
  }

  function commentTime(li) {
    const value = li.querySelector(':scope > .comment__head > .comment__time')?.getAttribute('datetime');
    return value ? Date.parse(value) || 0 : 0;
  }

  function applySort() {
    if (loadingBatch) return; // yer tutucular dururken taşımak sırayı bozar
    const tops = [...commentsEl.querySelectorAll(':scope > .comment')];
    const sortable = tops.filter((li) => li.dataset.comment && li.dataset.order);
    const sortableSet = new Set(sortable);
    const rest = tops.filter((li) => !sortableSet.has(li));
    const keys = {
      default: (li) => Number(li.dataset.order),
      new: (li) => -commentTime(li),
      replies: (li) => -li.querySelectorAll('.comment[data-comment]').length,
    };
    const key = keys[sortMode] || keys.default;
    sortable.sort((a, b) => key(a) - key(b) || Number(a.dataset.order) - Number(b.dataset.order));
    commentsEl.append(...sortable, ...rest);
  }

  function paintSearchCount() {
    const countEl = searchEl.querySelector('[data-search-count]');
    if (!countEl) return;
    if (!searchInput.value.trim()) countEl.textContent = '';
    else if (!searchHits.length) countEl.textContent = 'eşleşme yok';
    else countEl.textContent = `${searchIndex >= 0 ? searchIndex + 1 : 0}/${nf(searchHits.length)}`;
  }

  // Eşleşen yorumlar ve onların üst zinciri kalır, gerisi gizlenir.
  // Katlanmış bir dalın içindeki eşleşme görünür olsun diye üst zincir açılır.
  function setSearch(raw) {
    const query = (raw || '').trim().toLowerCase();
    searchHits = [];
    searchIndex = -1;
    const all = [...commentsEl.querySelectorAll('.comment[data-comment]')];
    all.forEach((li) => li.classList.remove('is-hit', 'is-kept'));
    commentsEl.classList.toggle('is-filtered', Boolean(query));
    if (query) {
      for (const li of all) {
        const author = li.querySelector(':scope > .comment__head > .comment__author')?.textContent || '';
        const body = li.querySelector(':scope > .comment__body')?.textContent || '';
        if (!`${author}\n${body}`.toLowerCase().includes(query)) continue;
        li.classList.add('is-hit', 'is-kept');
        searchHits.push(li);
        for (let p = li.parentElement?.closest('.comment'); p; p = p.parentElement?.closest('.comment')) {
          p.classList.add('is-kept');
          setCollapsed(p, false);
        }
      }
    }
    paintSearchCount();
  }

  function jumpHit(step) {
    if (!searchHits.length) return;
    searchIndex = (searchIndex + step + searchHits.length) % searchHits.length;
    const el = searchHits[searchIndex];
    commentsEl.querySelectorAll('.is-focused').forEach((n) => n.classList.remove('is-focused'));
    el.classList.add('is-focused');
    restartAnimation(el.querySelector(':scope > .comment__head'));
    el.scrollIntoView({ block: 'center', behavior: scrollBehavior() });
    el.focus({ preventScroll: true });
    paintSearchCount();
  }

  function openSearch() {
    if (!commentsEl.children.length) return;
    searchEl.hidden = false;
    searchInput.focus();
    searchInput.select();
  }

  function closeSearch() {
    searchEl.hidden = true;
    searchInput.value = '';
    setSearch('');
    commentsEl.querySelectorAll('.is-focused').forEach((n) => n.classList.remove('is-focused'));
  }

  searchInput.addEventListener('input', () => {
    setSearch(searchInput.value);
    if (searchHits.length) jumpHit(1);
  });

  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      jumpHit(e.shiftKey ? -1 : 1);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation(); // yardım penceresi kapanmasın, önce arama kapansın
      closeSearch();
    }
  });

  async function reloadThread() {
    if (loadingBatch) return;
    liveEl.hidden = true;
    invalidateItem(id);
    const fresh = await getItem(id).catch(() => null);
    if (token.cancelled || !fresh) return;
    story = fresh;
    baseTotal = fresh.descendants ?? 0;
    kids = fresh.kids || [];
    cursor = 0;
    navIndex = -1;
    commentsEl.innerHTML = '';
    await loadBatch();
  }

  /* --- yeni yorumlar arasında gezinme (n / p) --- */

  function navTargets() {
    const fresh = [...commentsEl.querySelectorAll('.comment.is-new')];
    return fresh.length ? fresh : [...commentsEl.querySelectorAll(':scope > .comment')];
  }

  function jumpTo(step) {
    const targets = navTargets();
    if (!targets.length) return;
    navIndex = (navIndex + step + targets.length) % targets.length;
    const el = targets[navIndex];
    commentsEl.querySelectorAll('.is-focused').forEach((n) => n.classList.remove('is-focused'));
    el.classList.add('is-focused');
    // Tek hedef varsa aynı öğeye tekrar iniliyor olabilir: inişi yeniden oynat.
    restartAnimation(el.querySelector(':scope > .comment__head'));
    restartAnimation(el.querySelector(':scope > .comment__body'));
    el.scrollIntoView({ block: 'center', behavior: scrollBehavior() });
    el.focus({ preventScroll: true });
  }

  function onKey(e) {
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || '')) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === 'n') {
      e.preventDefault();
      jumpTo(1);
    } else if (e.key === 'p') {
      e.preventDefault();
      jumpTo(-1);
    } else if (e.key === 'f') {
      e.preventDefault();
      openSearch();
    } else if (e.key === 'S') {
      e.preventDefault();
      shareCurrent();
    }
  }
  document.addEventListener('keydown', onKey);

  const cleanup = () => {
    clearInterval(timer);
    document.removeEventListener('keydown', onKey);
    // Ayrılırken güncel yorum sayısını yaz: bir dahakine "yeni" bundan sonrası olur.
    if (story) recordVisit(id, story.descendants ?? 0);
  };

  /* --- ilk yükleme --- */

  try {
    story = await getItem(id);
    if (token.cancelled) return cleanup;
    if (!story) {
      headEl.innerHTML = emptyBox('Gönderi bulunamadı', `#${id} numaralı içerik yok ya da silinmiş.`);
      return cleanup;
    }

    markRead(story.id);
    document.title = `${story.title || 'Gönderi'} · Modern HN`;
    baseTotal = story.descendants ?? 0;

    if (story.type === 'comment') {
      // Dal görünümü: gövde hemen çizilir, kök zinciri arkadan tamamlanır.
      // OP rozeti kökün yazarına aittir; kök gelene kadar kimse OP değildir.
      ctx.op = null;
      headEl.innerHTML = commentHeader(story, null);
      const root = await resolveRoot(story);
      if (token.cancelled) return cleanup;
      if (root) {
        headEl.innerHTML = commentHeader(story, root);
        ctx.op = root.by || null;
        document.title = `${root.title || 'Yanıt dalı'} · yanıt dalı · Modern HN`;
      }
    } else {
      ctx.op = story.by || null;
      headEl.innerHTML = storyHeader(story);
      if (story.parts?.length) loadPoll(story.parts);
    }

    kids = story.kids || [];
    if (!kids.length) {
      footEl.innerHTML = emptyBox('Henüz yorum yok');
    } else {
      await loadBatch();
    }
    // Listedeki "+N yeni" rozeti bu gönderi için hemen sıfırlansın.
    recordVisit(id, story.descendants ?? 0);
  } catch (err) {
    headEl.innerHTML = errorBox(err.message);
    return cleanup;
  }

  /* --- canlı akış: yeni yorum geldi mi? --- */

  timer = setInterval(async () => {
    if (token.cancelled || document.hidden) return;
    try {
      invalidateItem(id);
      const fresh = await getItem(id);
      if (token.cancelled) return;
      const total = fresh?.descendants ?? 0;
      if (total > baseTotal) {
        liveEl.hidden = false;
        liveEl.innerHTML = `<span>${nf(total - baseTotal)} yeni yorum geldi.</span>
          <button class="btn btn--small" data-reload-thread>Getir</button>`;
      }
    } catch {
      /* sessiz geç */
    }
  }, POLL_MS);

  /* --- etkileşimler --- */

  container.addEventListener('click', (e) => {
    if (e.target.closest('[data-more]')) loadBatch();
    if (e.target.closest('[data-reload-thread]')) reloadThread();
    if (e.target.closest('[data-jump-new]')) jumpTo(1);
    if (e.target.closest('[data-retry]')) {
      // Yönlendiriciyi yeniden çalıştır: temizlik doğru şekilde yapılsın.
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    }

    const translateHeadBtn = e.target.closest('[data-translate-head]');
    if (translateHeadBtn) {
      const headArticle = translateHeadBtn.closest('.item-head');
      toggleHeadTranslation(headArticle);
      return;
    }

    const translateCommentBtn = e.target.closest('[data-translate-comment]');
    if (translateCommentBtn) {
      const commentLi = translateCommentBtn.closest('.comment');
      toggleCommentTranslation(commentLi);
      return;
    }

    const translateAllBtn = e.target.closest('[data-translate-all-comments]');
    if (translateAllBtn) {
      translateAllComments(commentsEl, translateAllBtn);
      return;
    }

    const toggle = e.target.closest('[data-toggle]');
    if (toggle) {
      const li = toggle.closest('.comment');
      const collapsed = li.classList.toggle('is-collapsed');
      toggle.textContent = collapsed ? '+' : '–';
      toggle.setAttribute('aria-expanded', String(!collapsed));
    }

    const collapseAll = e.target.closest('[data-collapse-all]');
    if (collapseAll) {
      allCollapsed = !allCollapsed;
      commentsEl.querySelectorAll(':scope > .comment').forEach((li) => setCollapsed(li, allCollapsed));
      collapseAll.textContent = allCollapsed ? 'Hepsini aç' : 'Hepsini katla';
    }

    if (e.target.closest('[data-share-item]')) {
      e.preventDefault();
      shareCurrent();
      return;
    }
    if (e.target.closest('[data-search-toggle]')) {
      openSearch();
      return;
    }
    if (e.target.closest('[data-search-next]')) {
      jumpHit(1);
      return;
    }
    if (e.target.closest('[data-search-prev]')) {
      jumpHit(-1);
      return;
    }
    if (e.target.closest('[data-search-close]')) {
      closeSearch();
      return;
    }
  });

  container.addEventListener('change', (e) => {
    const select = e.target.closest('[data-sort]');
    if (!select) return;
    sortMode = select.value;
    applySort();
  });

  return cleanup;
}

/* --- Çeviri Yardımcı İşlevleri --- */

export async function toggleCommentTranslation(li) {
  if (!li || li.classList.contains('comment--pending') || li.classList.contains('comment--more')) return;
  const bodyEl = li.querySelector('.comment__body');
  const headEl = li.querySelector('.comment__head');
  const btn = li.querySelector('[data-translate-comment]');
  if (!bodyEl) return;

  const targetLang = getTargetLang();

  if (li.dataset.translated === 'true') {
    if (li.dataset.originalHtml) {
      bodyEl.innerHTML = li.dataset.originalHtml;
    }
    setContentLang(bodyEl, 'en');
    delete li.dataset.translated;
    li.classList.remove('is-translated');
    const badge = headEl?.querySelector('.tag--translated');
    if (badge) badge.remove();
    if (btn) {
      btn.title = 'Yorumu çevir (t)';
      btn.classList.remove('is-active');
    }
    return;
  }

  if (btn) {
    btn.classList.add('is-loading');
    btn.disabled = true;
  }

  if (!li.dataset.originalHtml) {
    li.dataset.originalHtml = bodyEl.innerHTML;
  }

  try {
    const translated = await translateHtml(li.dataset.originalHtml, targetLang);
    bodyEl.innerHTML = translated;
    setContentLang(bodyEl, targetLang);
    li.dataset.translated = 'true';
    li.classList.add('is-translated');

    if (headEl && !headEl.querySelector('.tag--translated')) {
      const badge = document.createElement('span');
      badge.className = 'tag tag--translated';
      badge.textContent = targetLang.toUpperCase();
      const timeEl = headEl.querySelector('.comment__time');
      if (timeEl) headEl.insertBefore(badge, timeEl);
      else headEl.appendChild(badge);
    }

    if (btn) {
      btn.title = `Orijinali göster (${targetLang.toUpperCase()})`;
      btn.classList.add('is-active');
    }
  } catch (err) {
    console.error('Yorum çeviri hatası:', err);
  } finally {
    if (btn) {
      btn.classList.remove('is-loading');
      btn.disabled = false;
    }
  }
}

export async function toggleHeadTranslation(article) {
  if (!article) return;
  const titleEl = article.querySelector('.item-head__title');
  const textEl = article.querySelector('.item-head__text');
  const btn = article.querySelector('[data-translate-head]');

  const targetLang = getTargetLang();

  if (article.dataset.translated === 'true') {
    if (article.dataset.originalTitle && titleEl) {
      const link = titleEl.querySelector('a');
      if (link) link.textContent = article.dataset.originalTitle;
      else titleEl.textContent = article.dataset.originalTitle;
    }
    if (article.dataset.originalText && textEl) {
      textEl.innerHTML = article.dataset.originalText;
    }
    setContentLang(titleEl, 'en');
    setContentLang(textEl, 'en');
    delete article.dataset.translated;
    article.classList.remove('is-translated');
    if (btn) {
      btn.innerHTML = `<svg viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="width:14px;height:14px;display:inline-block;vertical-align:-2px;margin-right:3px;"><path d="M2 3.5h7M5.5 2v1.5M3.5 13.5c1.5-2 3-4.5 5.5-6.5M3.5 7c1 1.5 2.5 3 4.5 4M10 14l3-7 3 7M11.2 11.5h4.6"/></svg>Çevir`;
      btn.classList.remove('btn--primary');
      btn.classList.add('btn--ghost');
    }
    return;
  }

  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Çevriliyor…';
  }

  if (titleEl && !article.dataset.originalTitle) {
    const link = titleEl.querySelector('a');
    article.dataset.originalTitle = link ? link.textContent.trim() : titleEl.textContent.trim();
  }
  if (textEl && !article.dataset.originalText) {
    article.dataset.originalText = textEl.innerHTML;
  }

  try {
    if (titleEl && article.dataset.originalTitle) {
      const translatedTitle = await translateText(article.dataset.originalTitle, targetLang);
      const link = titleEl.querySelector('a');
      if (link) link.textContent = translatedTitle;
      else titleEl.textContent = translatedTitle;
    }
    if (textEl && article.dataset.originalText) {
      const translatedText = await translateHtml(article.dataset.originalText, targetLang);
      textEl.innerHTML = translatedText;
    }
    setContentLang(titleEl, targetLang);
    setContentLang(textEl, targetLang);
    article.dataset.translated = 'true';
    article.classList.add('is-translated');
    if (btn) {
      btn.innerHTML = `Orijinali Göster (${targetLang.toUpperCase()})`;
      btn.classList.remove('btn--ghost');
      btn.classList.add('btn--primary');
    }
  } catch (err) {
    console.error('Başlık çeviri hatası:', err);
    if (btn) btn.textContent = 'Çevir';
  } finally {
    if (btn) btn.disabled = false;
  }
}

async function translateAllComments(commentsEl, btn) {
  if (!commentsEl) return;
  const untranslated = [...commentsEl.querySelectorAll('.comment[data-comment]:not([data-translated="true"])')];
  if (!untranslated.length) {
    const translated = [...commentsEl.querySelectorAll('.comment[data-translated="true"]')];
    for (const li of translated) {
      await toggleCommentTranslation(li);
    }
    if (btn) btn.textContent = 'Tümünü Çevir';
    return;
  }

  if (btn) {
    btn.disabled = true;
    btn.textContent = `Çevriliyor… (0/${untranslated.length})`;
  }

  let done = 0;
  const poolSize = 5;
  for (let i = 0; i < untranslated.length; i += poolSize) {
    const batch = untranslated.slice(i, i + poolSize);
    await Promise.all(
      batch.map(async (li) => {
        await toggleCommentTranslation(li);
        done++;
        if (btn) btn.textContent = `Çevriliyor… (${done}/${untranslated.length})`;
      })
    );
  }

  if (btn) {
    btn.disabled = false;
    btn.textContent = 'Orijinallere dön';
  }
}
