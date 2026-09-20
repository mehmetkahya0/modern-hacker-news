import { esc, timeAgo, fullDate, domainOf, nf, stripHtml, truncate, hueOf, createLimiter, setContentLang } from '../util.js';
import { isRead, isSaved, getVisit } from '../store.js';
import { getItem, hnItemUrl } from '../api.js';
import { translateText, getTargetLang } from '../translate.js';

// Kaynak kimliği: domain'e göre favicon; yüklenemezse harf monogramı kalır.
const faviconUrl = (domain) => `https://icons.duckduckgo.com/ip3/${domain}.ico`;

function sourceOf(story) {
  if (story.url) {
    const domain = domainOf(story.url);
    return { label: domain, domain, mono: (domain[0] || '?').toUpperCase() };
  }
  const title = story.title || '';
  if (story.type === 'job') return { label: 'İş ilanı', domain: '', mono: '💼' };
  if (/^ask hn/i.test(title)) return { label: 'Ask HN', domain: '', mono: '?' };
  if (/^show hn/i.test(title)) return { label: 'Show HN', domain: '', mono: '★' };
  if (story.type === 'poll') return { label: 'Anket', domain: '', mono: '≡' };
  return { label: 'metin', domain: '', mono: 'Y' };
}

// İlgi ısısı: saat başına puan. Taze ve hızlı tırmanan gönderileri öne çıkarır.
function heat(story) {
  if (story.score == null || !story.time) return null;
  const hours = Math.max(0.5, (Date.now() / 1000 - story.time) / 3600);
  const rate = story.score / hours;
  const pct = Math.min(1, rate / 50);
  const label = pct >= 0.6 ? 'çok canlı' : pct >= 0.3 ? 'canlı' : pct >= 0.12 ? 'ısınıyor' : 'sakin';
  return { pct, label, rate };
}

export function storyCard(story) {
  if (!story || story.deleted) return '';

  const id = story.id;
  const external = Boolean(story.url);
  const url = story.url || `#/item/${id}`;
  const src = sourceOf(story);
  const h = heat(story);
  const comments = story.descendants ?? 0;
  // Daha önce açtıysan: o günden bu yana kaç yorum eklenmiş?
  const visit = getVisit(id);
  const newComments = visit && comments > visit.c ? comments - visit.c : 0;
  // Metin gönderilerinde önizleme hazır; bağlantı gönderilerinde en üst yorum sonradan çekilir.
  const ownText = story.text ? truncate(stripHtml(story.text), 155) : '';
  const saved = isSaved(id);
  const savedLabel = saved ? 'Kayıtlardan çıkar' : 'Kaydet';

  return `
<article class="story${isRead(id) ? ' is-read' : ''}" data-id="${id}" data-story-card${
    comments > 0 && !ownText ? ` data-needs-preview="${(story.kids || []).slice(0, 3).join(',')}"` : ''
  }>
  <div class="avatar" style="--hue:${hueOf(src.label)}" aria-hidden="true">
    <span class="avatar__mono">${esc(src.mono)}</span>
    ${src.domain ? `<img class="avatar__img" src="${faviconUrl(src.domain)}" alt="" loading="lazy" decoding="async" data-favicon>` : ''}
  </div>

  <div class="story__main">
    <div class="story__source">
      <span class="story__domain"${story.url ? ` title="${esc(story.url)}"` : ''}>${esc(src.label)}</span>
      <span class="dot">·</span>
      <time datetime="${new Date((story.time || 0) * 1000).toISOString()}" title="${fullDate(story.time)}">${timeAgo(story.time)}</time>
      ${story.by ? `<span class="dot">·</span><a class="story__by" href="#/user/${encodeURIComponent(story.by)}">${esc(story.by)}</a>` : ''}
    </div>

    <h2 class="story__title">
      <a class="story__link" lang="en" href="${esc(url)}"${external ? ' target="_blank" rel="noopener noreferrer"' : ''} data-story-link>${esc(story.title || '(başlıksız)')}</a>
    </h2>

    <div class="story__meta">
      ${story.score != null
        ? `<span class="meta meta--score" title="puan"><svg viewBox="0 0 12 12" aria-hidden="true"><path d="M6 1.5 11 9H1z"/></svg>${nf(story.score)}</span>`
        : ''}
      <a class="meta meta--comments" href="#/item/${id}">${comments > 0 ? `${nf(comments)} yorum` : 'yorum yok'}</a>
      ${newComments ? `<a class="tag tag--new" href="#/item/${id}" title="son okumandan beri">+${nf(newComments)} yeni</a>` : ''}
      ${h
        ? `<span class="heat" title="saatte ≈${nf(Math.round(h.rate))} puan">
             <span class="heat__track"><i style="width:${Math.round(h.pct * 100)}%"></i></span>
             <span class="heat__label">${h.label}</span>
           </span>`
        : ''}
    </div>

    ${ownText ? `<p class="story__preview story__preview--self" lang="en">${esc(ownText)}</p>` : ''}
  </div>

  <div class="story__actions">
    <button class="icon-btn btn-translate" data-translate-story="${id}" title="Çevir (t)" aria-label="Çevir">
      <svg viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
        <path d="M2 3.5h7M5.5 2v1.5M3.5 13.5c1.5-2 3-4.5 5.5-6.5M3.5 7c1 1.5 2.5 3 4.5 4M10 14l3-7 3 7M11.2 11.5h4.6"/>
      </svg>
    </button>
    <button class="icon-btn${saved ? ' is-active' : ''}" data-save="${id}" title="${savedLabel}" aria-label="${savedLabel}" aria-pressed="${saved}">
      <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 2h8a1 1 0 0 1 1 1v11l-5-3-5 3V3a1 1 0 0 1 1-1z"/></svg>
    </button>
    <button class="icon-btn" data-share="${id}" title="Paylaş (Shift+S)" aria-label="Paylaş">
      <svg viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="3.5" r="2"/><circle cx="4" cy="8" r="2"/><circle cx="12" cy="12.5" r="2"/>
        <path d="M5.8 7 10.2 4.5M5.8 9l4.4 2.5"/>
      </svg>
    </button>
    <a class="icon-btn" href="${hnItemUrl(id)}" target="_blank" rel="noopener noreferrer" title="HN'de aç" aria-label="Hacker News'te aç">
      <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M6 2h8v8h-2V5.4L5.4 12 4 10.6 10.6 4H6z"/><path d="M2 5h3v2H4v6h6v-1h2v3H2z"/></svg>
    </a>
  </div>
</article>`;
}

// Kullanıcı ve arama görünümlerinde yorumlar için alıntı kartı.
export function commentCard({ id, parentId, by, time, text, contextLabel = 'bağlamı gör' }) {
  return `
<article class="story story--comment" data-id="${id}">
  <div class="avatar avatar--quote" style="--hue:${hueOf(by || '')}" aria-hidden="true">
    <span class="avatar__mono">”</span>
  </div>
  <div class="story__main">
    <div class="story__source">
      <span class="story__domain">yorum</span>
      <span class="dot">·</span>
      <time datetime="${new Date((time || 0) * 1000).toISOString()}" title="${fullDate(time)}">${timeAgo(time)}</time>
      ${by ? `<span class="dot">·</span><a class="story__by" href="#/user/${encodeURIComponent(by)}">${esc(by)}</a>` : ''}
    </div>
    <p class="story__preview story__preview--self" lang="en">${esc(truncate(stripHtml(text || ''), 320))}</p>
    <div class="story__meta">
      <a class="meta meta--comments" href="#/item/${parentId}">${esc(contextLabel)}</a>
    </div>
  </div>
  <div class="story__actions">
    <button class="icon-btn btn-translate" data-translate-comment="${id}" title="Yorumu çevir (t)" aria-label="Yorumu çevir">
      <svg viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
        <path d="M2 3.5h7M5.5 2v1.5M3.5 13.5c1.5-2 3-4.5 5.5-6.5M3.5 7c1 1.5 2.5 3 4.5 4M10 14l3-7 3 7M11.2 11.5h4.6"/>
      </svg>
    </button>
  </div>
</article>`;
}

/* ---------------------------------------------------------
   Kart zenginleştirme: favicon yedeği + tembel yorum alıntısı
   --------------------------------------------------------- */

// Önizlemeler kozmetiktir: ne ana ağ kuyruğunu doldurmalı ne de terk edilmiş bir
// görünüm adına çalışmaya devam etmeli. Her görünümün kendi gözlemcisi ve kendi
// küçük kuyruğu var; görünüm gidince ikisi de susuyor.
const previewJobs = new WeakMap();

function jobFor(container, token) {
  let job = previewJobs.get(container);
  if (!job) {
    job = { run: createLimiter(3), token, cancelled: false, observer: null };
    if (typeof IntersectionObserver !== 'undefined') {
      job.observer = new IntersectionObserver(
        (entries, obs) => {
          for (const entry of entries) {
            if (!entry.isIntersecting) continue;
            obs.unobserve(entry.target);
            loadPreview(entry.target, job);
          }
        },
        { rootMargin: '200px 0px' }
      );
    }
    previewJobs.set(container, job);
  }
  if (token) job.token = token;
  return job;
}

// Görünüm sökülürken çağrılır: bekleyen alıntı istekleri boşa çalışmasın.
export function teardownPreviews(container) {
  const job = previewJobs.get(container);
  if (!job) return;
  job.cancelled = true;
  job.observer?.disconnect();
  previewJobs.delete(container);
}

const isDead = (job, card) => job.cancelled || job.token?.cancelled || !card.isConnected;

async function loadPreview(card, job) {
  // Akış kartları çocuk kimliklerini yanlarında getirir; gönderiyi ikinci kez
  // çekmek gerekmez. Arama/profil kartlarında bilinmez, orada tek istek eklenir.
  let kids = (card.dataset.needsPreview || '').split(',').filter(Boolean);
  card.removeAttribute('data-needs-preview');
  try {
    if (!kids.length) {
      const story = await job.run(() => getItem(Number(card.dataset.id)));
      if (isDead(job, card)) return;
      kids = (story?.kids || []).slice(0, 3).map(String);
    }
    for (const kid of kids) {
      if (isDead(job, card)) return;
      const comment = await job.run(() => getItem(Number(kid)));
      if (isDead(job, card)) return;
      if (!comment || comment.deleted || comment.dead || !comment.text) continue;
      const text = truncate(stripHtml(comment.text), 150);
      if (text.length < 25) continue;
      card.querySelector('.story__main')?.insertAdjacentHTML(
        'beforeend',
        `<p class="story__preview"><span class="story__quote" lang="en">${esc(text)}</span><span class="story__quote-by">— ${esc(comment.by || '')}</span></p>`
      );
      return;
    }
  } catch {
    /* önizleme kozmetik: hata sessizce yutulur */
  }
}

// Kartlar DOM'a eklendikten sonra çağrılır.
export function enhanceCards(container, token) {
  container.querySelectorAll('[data-favicon]:not([data-wired])').forEach((img) => {
    img.dataset.wired = '1';
    img.addEventListener('error', () => img.remove(), { once: true });
    img.addEventListener('load', () => img.classList.add('is-loaded'), { once: true });
  });

  const job = jobFor(container, token);
  container.querySelectorAll('[data-needs-preview]').forEach((card) =>
    job.observer ? job.observer.observe(card) : loadPreview(card, job)
  );
}


export function skeletonList(count = 8) {
  return `<div class="skeletons" aria-hidden="true">${Array.from(
    { length: count },
    () => `
    <div class="sk-story">
      <div class="sk sk--avatar"></div>
      <div class="sk-story__body">
        <div class="sk sk--source"></div>
        <div class="sk sk--title"></div>
        <div class="sk sk--meta"></div>
      </div>
    </div>`
  ).join('')}</div>`;
}

// Yükleniyor da bir durum: sessizce dönen bir çark ekran okuyucuya hiçbir şey söylemez.
export function loadingBox(label = 'Yükleniyor…') {
  return `<div class="loading" role="status">
  <span class="spinner" aria-hidden="true"></span> ${esc(label)}
</div>`;
}

// Hata metnini API katmanı yazar; burada yalnızca kurtarma yolu eklenir.
export function errorBox(message, retryLabel = 'Tekrar dene') {
  return `
<div class="state state--error" role="alert">
  <div class="state__title">Veri alınamadı</div>
  <p class="state__text">${esc(message)}</p>
  <button class="btn" data-retry>${esc(retryLabel)}</button>
</div>`;
}

export function emptyBox(title, text = '') {
  return `
<div class="state">
  <div class="state__title">${esc(title)}</div>
  ${text ? `<p class="state__text">${esc(text)}</p>` : ''}
</div>`;
}

export async function toggleStoryCardTranslation(card) {
  if (!card) return;
  const linkEl = card.querySelector('.story__link');
  const previewEl = card.querySelector('.story__preview');
  const btn = card.querySelector('[data-translate-story]');

  const targetLang = getTargetLang();

  if (card.dataset.translated === 'true') {
    if (card.dataset.originalTitle && linkEl) {
      linkEl.textContent = card.dataset.originalTitle;
    }
    if (card.dataset.originalPreview && previewEl) {
      const quoteEl = previewEl.querySelector('.story__quote') || previewEl;
      quoteEl.textContent = card.dataset.originalPreview;
    }
    setContentLang(linkEl, 'en');
    setContentLang(previewEl, 'en');
    delete card.dataset.translated;
    card.classList.remove('is-translated');
    const badge = card.querySelector('.tag--translated');
    if (badge) badge.remove();
    if (btn) {
      btn.classList.remove('is-active');
      btn.title = 'Çevir (t)';
    }
    return;
  }

  if (btn) {
    btn.classList.add('is-loading');
    btn.disabled = true;
  }

  if (linkEl && !card.dataset.originalTitle) {
    card.dataset.originalTitle = linkEl.textContent.trim();
  }
  if (previewEl && !card.dataset.originalPreview) {
    const quoteEl = previewEl.querySelector('.story__quote') || previewEl;
    card.dataset.originalPreview = quoteEl.textContent.trim();
  }

  try {
    if (linkEl && card.dataset.originalTitle) {
      const translatedTitle = await translateText(card.dataset.originalTitle, targetLang);
      linkEl.textContent = translatedTitle;
    }
    if (previewEl && card.dataset.originalPreview) {
      const quoteEl = previewEl.querySelector('.story__quote') || previewEl;
      const translatedPreview = await translateText(card.dataset.originalPreview, targetLang);
      quoteEl.textContent = translatedPreview;
    }
    setContentLang(linkEl, targetLang);
    setContentLang(previewEl, targetLang);
    card.dataset.translated = 'true';
    card.classList.add('is-translated');

    const sourceEl = card.querySelector('.story__source');
    if (sourceEl && !sourceEl.querySelector('.tag--translated')) {
      const badge = document.createElement('span');
      badge.className = 'tag tag--translated';
      badge.textContent = targetLang.toUpperCase();
      sourceEl.appendChild(badge);
    }

    if (btn) {
      btn.classList.add('is-active');
      btn.title = `Orijinali göster (${targetLang.toUpperCase()})`;
    }
  } catch (err) {
    console.error('Kart çeviri hatası:', err);
  } finally {
    if (btn) {
      btn.classList.remove('is-loading');
      btn.disabled = false;
    }
  }
}
