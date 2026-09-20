// Küçük yardımcılar: DOM, kaçış, tarih, sanitizasyon, eşzamanlılık havuzu.

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function el(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export function esc(value = '') {
  return String(value).replace(/[&<>"']/g, (c) => ESCAPES[c]);
}

export function timeAgo(unix) {
  if (!unix) return '';
  const s = Math.max(0, Math.floor(Date.now() / 1000 - unix));
  if (s < 60) return 'az önce';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} dk önce`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} sa önce`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d} gün önce`;
  const mo = Math.floor(d / 30);
  if (mo < 12) return `${mo} ay önce`;
  return `${Math.floor(mo / 12)} yıl önce`;
}

export function fullDate(unix) {
  if (!unix) return '';
  return new Date(unix * 1000).toLocaleString('tr-TR', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

export function domainOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

export function nf(n) {
  return new Intl.NumberFormat('tr-TR').format(n ?? 0);
}

// HN metinleri sınırlı HTML içerir; beyaz liste dışındaki her şeyi düz metne indiriyoruz.
const ALLOWED_TAGS = new Set(['A', 'P', 'I', 'EM', 'B', 'STRONG', 'CODE', 'PRE', 'BLOCKQUOTE', 'BR', 'U', 'S', 'SPAN', 'UL', 'OL', 'LI']);
const ALLOWED_ATTRS = { A: ['href', 'title'] };

export function sanitize(html) {
  const tpl = document.createElement('template');
  tpl.innerHTML = html || '';

  const walk = (node) => {
    for (const child of [...node.childNodes]) {
      if (child.nodeType === Node.TEXT_NODE) continue;
      if (child.nodeType !== Node.ELEMENT_NODE) {
        child.remove();
        continue;
      }
      if (!ALLOWED_TAGS.has(child.tagName)) {
        child.replaceWith(document.createTextNode(child.textContent || ''));
        continue;
      }
      const allowed = ALLOWED_ATTRS[child.tagName] || [];
      for (const attr of [...child.attributes]) {
        if (!allowed.includes(attr.name.toLowerCase())) child.removeAttribute(attr.name);
      }
      if (child.tagName === 'A') {
        const href = child.getAttribute('href') || '';
        if (!/^(https?:|mailto:)/i.test(href)) child.removeAttribute('href');
        child.setAttribute('target', '_blank');
        child.setAttribute('rel', 'noopener noreferrer nofollow');
      }
      walk(child);
    }
  };

  walk(tpl.content);
  return tpl.innerHTML;
}

// Tüm bir ağaç için TEK kuyruk. pool() her çağrıda yeni bir sınır kurar; iç içe
// çağrılınca sınırlar çarpılır (6 yerine 6^derinlik). Limiter bir kez kurulur ve
// özyinelemenin her seviyesi aynı kuyruğu paylaşır.
export function createLimiter(max) {
  let active = 0;
  const queue = [];

  const pump = () => {
    while (active < max && queue.length) {
      const job = queue.shift();
      active++;
      Promise.resolve()
        .then(job.fn)
        .then(job.resolve, job.reject)
        .finally(() => {
          active--;
          pump();
        });
    }
  };

  const run = (fn) =>
    new Promise((resolve, reject) => {
      queue.push({ fn, resolve, reject });
      pump();
    });

  run.pending = () => queue.length + active;
  return run;
}

// Aynı anda `limit` kadar istek: HN API tek tek item döndürdüğü için şart.
export async function pool(items, limit, fn) {
  const results = [];
  const running = new Set();
  for (const [i, item] of items.entries()) {
    const p = Promise.resolve().then(() => fn(item, i));
    results.push(p);
    running.add(p);
    p.then(
      () => running.delete(p),
      () => running.delete(p)
    );
    if (running.size >= limit) await Promise.race(running);
  }
  return Promise.all(results);
}

// CSS'in scroll-behavior'ı JS ile verilen `behavior:'smooth'`i geçersiz kılamaz;
// tercih burada da okunmalı.
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
export const prefersReducedMotion = () => reduceMotion.matches;
export const scrollBehavior = () => (reduceMotion.matches ? 'auto' : 'smooth');

// Aynı öğeye yeniden atlanınca CSS animasyonu kendiliğinden baştan başlamaz.
export function restartAnimation(el) {
  if (!el || prefersReducedMotion()) return;
  el.style.animation = 'none';
  void el.offsetWidth; // yeniden akış: tarayıcı animasyonu sıfırlasın
  el.style.animation = '';
}

export function debounce(fn, ms = 250) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

// HTML metni düz yazıya indirger (varlıkları da çözer) — önizleme alıntıları için.
export function stripHtml(html) {
  const tpl = document.createElement('template');
  tpl.innerHTML = String(html || '')
    .replace(/<\/p>/gi, ' ')
    .replace(/<br\s*\/?>/gi, ' ');
  return (tpl.content.textContent || '').replace(/\s+/g, ' ').trim();
}

export function truncate(text, max) {
  if (!text || text.length <= max) return text || '';
  return `${text.slice(0, max).replace(/\s+\S*$/, '')}…`;
}

// Kaynak adından kararlı bir renk tonu — favicon yoksa monogram rengi olarak kullanılır.
/* Metnin dili, metinle birlikte değişir.
   HN içeriği İngilizce gelir ve öyle işaretlenir; çevrildiğinde işaret de
   çevrilmezse tireleme İngilizce kalıplarla Türkçe kelimeyi kırar ve ekran
   okuyucu metni İngilizce telaffuz eder. Kök öğe ile birlikte içindeki
   işaretli parçalar da güncellenir; ters çevirmede "en" geri gelir. */
export function setContentLang(root, lang) {
  if (!root) return;
  const targets = root.matches?.('[lang]') ? [root, ...root.querySelectorAll('[lang]')]
                                          : [...root.querySelectorAll('[lang]')];
  targets.forEach((node) => node.setAttribute('lang', lang));
}

export function hueOf(str = '') {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) % 360;
  return h;
}

// Kısa geri bildirim: kopyalama gibi sessiz işlemler görünmez kalmasın.
let toastTimer;
export function toast(message) {
  let host = document.querySelector('.toast');
  if (!host) {
    host = document.createElement('div');
    host.className = 'toast';
    host.setAttribute('role', 'status');
    host.setAttribute('aria-live', 'polite');
    document.body.appendChild(host);
  }
  host.textContent = message;
  host.classList.remove('is-on');
  void host.offsetWidth; // yeniden akış: art arda çağrılarda animasyon baştan başlasın
  host.classList.add('is-on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => host.classList.remove('is-on'), 2200);
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    /* izin yok ya da güvenli olmayan bağlam: eski yola düş */
  }
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  ta.style.cssText = 'position:fixed;top:-1000px;opacity:0';
  document.body.appendChild(ta);
  ta.select();
  let ok = false;
  try {
    ok = document.execCommand('copy');
  } catch {
    ok = false;
  }
  ta.remove();
  return ok;
}

// Web Share API varsa sistem paylaşım sayfası; yoksa panoya kopyalama.
// Paylaşılan adres her zaman dışarıdan açılabilen bir adrestir (makale ya da HN),
// uygulamanın kendi adresi değil: alıcı localhost'a bakamaz.
export async function shareOrCopy({ title, url, text } = {}) {
  if (!url) return 'noop';
  if (navigator.share) {
    try {
      await navigator.share({ title, text, url });
      return 'shared';
    } catch (err) {
      if (err?.name === 'AbortError') return 'cancelled';
      /* paylaşım reddedildi/desteklenmedi: kopyalamaya düş */
    }
  }
  const ok = await copyText(url);
  toast(ok ? 'Bağlantı kopyalandı' : 'Kopyalanamadı — adres: ' + url);
  return ok ? 'copied' : 'failed';
}
