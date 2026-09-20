import { FEEDS, hnItemUrl } from './api.js';
import { $, $$, scrollBehavior, shareOrCopy } from './util.js';
import {
  applyTheme, cycleTheme, getTheme, markRead, toggleSaved, isSaved,
  applyReading, getReading, setReading, resetReading, READING_LIMITS,
} from './store.js';
import { parseHash, onRoute, navigate } from './router.js';
import { renderList } from './views/list.js';
import { renderItem } from './views/item.js';
import { renderUser } from './views/user.js';
import { renderSearch } from './views/search.js';
import { errorBox, emptyBox, toggleStoryCardTranslation } from './views/components.js';
import { LANGUAGES, getTargetLang, setTargetLang } from './translate.js';

const app = $('#app');
const statusEl = $('#route-status');
let currentToken = { cancelled: true };
let cleanup = null;
let firstRender = true;

/* ---------------- Yönlendirme ---------------- */

// Tanınmayan adresler sessizce ana akışa düşmez; ne olduğunu söyleyip yol gösterir.
function renderNotFound({ container, params }) {
  container.innerHTML = emptyBox(
    'Böyle bir sayfa yok',
    `"${params.path}" adresini tanıyamadık. Üstteki sekmelerden bir akış seçebilirsin.`
  );
}

function safeDecode(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value; // bozuk yüzde kodlaması URIError atar
  }
}

function resolveRoute() {
  const { parts, query } = parseHash();
  const [first, second] = parts;

  if (!first || FEEDS[first]) {
    const feed = first || 'top';
    return { view: renderList, params: { feed }, nav: feed, title: FEEDS[feed].title };
  }
  if (first === 'saved') return { view: renderList, params: { feed: 'saved' }, nav: 'saved', title: 'Kaydedilenler' };
  if (first === 'item' && second) return { view: renderItem, params: { id: second }, nav: null, title: 'Gönderi' };
  if (first === 'user' && second) {
    return { view: renderUser, params: { id: second }, nav: null, title: `${safeDecode(second)} · profil` };
  }
  if (first === 'search') return { view: renderSearch, params: query, nav: null, title: 'Arama' };
  return { view: renderNotFound, params: { path: parts.join('/') }, nav: null, title: 'Sayfa bulunamadı' };
}

async function handleRoute() {
  currentToken.cancelled = true;
  cleanup?.();
  cleanup = null;

  const token = { cancelled: false };
  currentToken = token;

  const { view, params, nav, title } = resolveRoute();
  highlightNav(nav);
  document.title = `${title} · Modern HN`;
  window.scrollTo({ top: 0 });

  // Yeni bir görünüm her seferinde temiz bir kapsayıcıya çizilir;
  // böylece eski görünümün olay dinleyicileri de birlikte gider.
  const container = document.createElement('div');
  container.className = 'view-root';
  app.setAttribute('aria-busy', 'true');
  app.replaceChildren(container);

  try {
    cleanup = (await view({ container, token, params })) || null;
  } catch (err) {
    console.error(err);
    container.innerHTML = errorBox(err?.message || 'Bilinmeyen bir hata oluştu.');
  }

  if (token.cancelled) return;
  app.removeAttribute('aria-busy');
  setSelected(null);

  // Tek sayfa uygulamalarında adres değişimi kendiliğinden duyurulmaz.
  if (!firstRender) {
    app.focus({ preventScroll: true });
    if (statusEl) statusEl.textContent = document.title.replace(' · Modern HN', '');
  }
  firstRender = false;
}

function highlightNav(nav) {
  $$('[data-nav]').forEach((a) => {
    const active = a.dataset.nav === nav;
    a.classList.toggle('is-active', active);
    if (active) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
}

/* ---------------- Üst çubuk ---------------- */

function buildNav() {
  const nav = $('#tabs');
  const links = [
    ...Object.entries(FEEDS).map(([key, conf]) => ({ key, label: conf.label })),
    { key: 'saved', label: 'Kayıtlar' },
  ];
  nav.innerHTML = links
    .map((l) => `<a class="tab" data-nav="${l.key}" href="#/${l.key}">${l.label}</a>`)
    .join('');
}

function setupTheme() {
  applyTheme();
  const btn = $('#theme-toggle');
  const labels = { system: 'Sistem', light: 'Açık', dark: 'Koyu' };
  const paint = (theme) => {
    btn.dataset.theme = theme;
    btn.title = `Tema: ${labels[theme]} (d)`;
    btn.setAttribute('aria-label', `Tema: ${labels[theme]}`);
  };
  paint(getTheme());
  btn.addEventListener('click', () => paint(cycleTheme()));
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => applyTheme());
}

function setupLangPicker() {
  const toggleBtn = $('#lang-toggle');
  const badge = $('#lang-badge');
  const dropdown = $('#lang-dropdown');
  if (!toggleBtn || !dropdown) return;

  const currentLang = getTargetLang();
  badge.textContent = currentLang.toUpperCase();

  dropdown.innerHTML = LANGUAGES.map(
    (l) => `
    <button class="lang-option${l.code === currentLang ? ' is-active' : ''}" data-lang="${l.code}" type="button" role="menuitem">
      <span class="lang-option__flag">${l.flag}</span>
      <span class="lang-option__name">${l.name}</span>
      <span class="lang-option__code">${l.code.toUpperCase()}</span>
    </button>`
  ).join('');

  const toggle = (show) => {
    const isHidden = show != null ? !show : !dropdown.hidden;
    if (!isHidden) toggleReadingPanel(false);
    dropdown.hidden = isHidden;
    toggleBtn.setAttribute('aria-expanded', String(!isHidden));
  };
  closeLangDropdown = () => toggle(false);

  toggleBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    toggle();
  });

  dropdown.addEventListener('click', (e) => {
    const opt = e.target.closest('[data-lang]');
    if (!opt) return;
    const lang = opt.dataset.lang;
    setTargetLang(lang);
    badge.textContent = lang.toUpperCase();

    dropdown.querySelectorAll('.lang-option').forEach((b) => {
      b.classList.toggle('is-active', b.dataset.lang === lang);
    });

    toggle(false);
  });

  document.addEventListener('click', (e) => {
    if (!e.target.closest('#lang-picker')) {
      toggle(false);
    }
  });

  window.addEventListener('langchange', (e) => {
    const lang = e.detail.lang;
    badge.textContent = lang.toUpperCase();
  });
}

// Okuma ayarları yalnızca belirteç yazar: ölçek, satır genişliği, yoğunluk, yüz.
// Değerler kök öğede durduğu için her görünüm ek koda gerek kalmadan uyar.
function setupReading() {
  applyReading();
  const btn = $('#reading-toggle');
  const panel = $('#reading-panel');
  if (!btn || !panel) return;

  const paint = () => {
    const r = getReading();
    const out = $('#reading-scale-value');
    if (out) out.textContent = `%${r.scale}`;
    const mark = (sel, matches) =>
      $$(sel, panel).forEach((b) => {
        const active = matches(b);
        b.classList.toggle('is-active', active);
        b.setAttribute('aria-pressed', String(active));
      });
    mark('[data-read-width]', (b) => Number(b.dataset.readWidth) === r.width);
    mark('[data-read-density]', (b) => b.dataset.readDensity === r.density);
    mark('[data-read-family]', (b) => b.dataset.readFamily === r.family);
    const { min, max } = READING_LIMITS.scale;
    $$('[data-read-scale]', panel).forEach((b) => {
      b.disabled = Number(b.dataset.readScale) > 0 ? r.scale >= max : r.scale <= min;
    });
  };

  const toggle = (show) => {
    const next = show != null ? show : panel.hidden;
    if (next) closeLangDropdown();
    panel.hidden = !next;
    btn.setAttribute('aria-expanded', String(next));
  };

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    toggle();
  });

  panel.addEventListener('click', (e) => {
    const step = e.target.closest('[data-read-scale]');
    if (step) {
      setReading({ scale: getReading().scale + Number(step.dataset.readScale) * READING_LIMITS.scale.step });
    }
    const width = e.target.closest('[data-read-width]');
    if (width) setReading({ width: Number(width.dataset.readWidth) });
    const density = e.target.closest('[data-read-density]');
    if (density) setReading({ density: density.dataset.readDensity });
    const family = e.target.closest('[data-read-family]');
    if (family) setReading({ family: family.dataset.readFamily });
    if (e.target.closest('[data-read-reset]')) resetReading();
    paint();
  });

  document.addEventListener('click', (e) => {
    if (!e.target.closest('#reading-picker')) toggle(false);
  });

  paint();
  toggleReadingPanel = toggle;
}

// Aynı anda tek açılır pencere: ikisi de üst çubuğun sağ ucunda duruyor.
let toggleReadingPanel = () => {};
let closeLangDropdown = () => {};

function setupSearch() {
  const form = $('#search-form');
  const input = $('#search-input');
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const q = input.value.trim();
    if (!q) return;
    navigate(`#/search?q=${encodeURIComponent(q)}`);
    input.blur();
  });
}

// "İçeriğe atla" bir adres değil, odak hareketi: yönlendiriciye hiç uğramamalı.
function setupSkipLink() {
  $('[data-skip]')?.addEventListener('click', (e) => {
    e.preventDefault();
    app.focus({ preventScroll: true });
    app.scrollIntoView({ block: 'start' });
  });
}

// Bağlantı koptuğunda önbellekten okumaya devam edilir; durum yine de söylenir.
function setupConnectivity() {
  const bar = $('#offline-bar');
  if (!bar) return;
  const paint = () => {
    bar.hidden = navigator.onLine !== false;
  };
  window.addEventListener('online', paint);
  window.addEventListener('offline', paint);
  paint();
}

/* ---------------- Genel etkileşimler ---------------- */

function paintSaveButton(btn, active) {
  btn.classList.toggle('is-active', active);
  btn.setAttribute('aria-pressed', String(active));
  const label = active ? 'Kayıtlardan çıkar' : 'Kaydet';
  btn.setAttribute('aria-label', label);
  btn.title = label;
}

function setupDelegation() {
  app.addEventListener('click', (e) => {
    const translateStoryBtn = e.target.closest('[data-translate-story]');
    if (translateStoryBtn) {
      e.preventDefault();
      const card = translateStoryBtn.closest('[data-story-card]');
      if (card) toggleStoryCardTranslation(card);
      return;
    }

    const saveBtn = e.target.closest('[data-save]');
    if (saveBtn) {
      e.preventDefault();
      const card = saveBtn.closest('[data-story-card]');
      const id = Number(saveBtn.dataset.save);
      const link = card?.querySelector('[data-story-link]');
      paintSaveButton(saveBtn, toggleSaved({ id, title: link?.textContent || '', url: link?.href || '' }));
      saveBtn.classList.remove('is-popping');
      void saveBtn.offsetWidth;
      saveBtn.classList.add('is-popping');
      return;
    }

    const shareBtn = e.target.closest('[data-share]');
    if (shareBtn) {
      e.preventDefault();
      const card = shareBtn.closest('[data-story-card]');
      const link = card?.querySelector('[data-story-link]');
      const title = link?.textContent.trim() || 'Hacker News';
      // Kart başlığı metin gönderilerinde uygulama içine bakar; dışarıya
      // paylaşılacak adres o durumda HN tartışma sayfasıdır.
      const href = link?.getAttribute('href') || '';
      const external = Boolean(href) && !href.startsWith('#');
      shareOrCopy({ title, text: title, url: external ? link.href : hnItemUrl(Number(shareBtn.dataset.share)) });
      return;
    }

    const storyLink = e.target.closest('[data-story-link]');
    if (storyLink) {
      const card = storyLink.closest('[data-story-card]');
      if (card) {
        markRead(Number(card.dataset.id));
        card.classList.add('is-read');
      }
    }
  });
}

/* ---------------- Klavye kısayolları ---------------- */

let selectedIndex = -1;

function cards() {
  return $$('.story', app);
}

function setSelected(index) {
  const list = cards();
  list.forEach((c) => c.classList.remove('is-selected'));
  if (index == null || index < 0 || !list.length) {
    selectedIndex = -1;
    return;
  }
  selectedIndex = Math.min(index, list.length - 1);
  const card = list[selectedIndex];
  card.classList.add('is-selected');
  card.scrollIntoView({ block: 'nearest', behavior: scrollBehavior() });
}

// Odaktaki öğe Enter'ı kendi işliyorsa kısayol araya girip iki iş birden yapmamalı.
function activeElementHandlesEnter() {
  const node = document.activeElement;
  if (!node || node === document.body) return false;
  if (/^(INPUT|TEXTAREA|SELECT|BUTTON|A|SUMMARY)$/.test(node.tagName)) return true;
  return node.isContentEditable === true;
}

function setupKeyboard() {
  document.addEventListener('keydown', (e) => {
    const typing =
      /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || '') ||
      document.activeElement?.isContentEditable === true;
    if (e.key === 'Escape') {
      if (typing) document.activeElement.blur();
      toggleReadingPanel(false);
      closeLangDropdown();
      closeHelp();
      return;
    }
    if (typing || e.metaKey || e.ctrlKey || e.altKey) return;

    switch (e.key) {
      case '/':
        e.preventDefault();
        $('#search-input').focus();
        break;
      case 'j':
        e.preventDefault();
        setSelected(selectedIndex + 1);
        break;
      case 'k':
        e.preventDefault();
        setSelected(Math.max(0, selectedIndex - 1));
        break;
      case 'o':
      case 'Enter': {
        if (e.key === 'Enter' && activeElementHandlesEnter()) return;
        const card = cards()[selectedIndex];
        card?.querySelector('.story__link')?.click();
        break;
      }
      case 'c': {
        const card = cards()[selectedIndex];
        const href = card?.querySelector('.meta--comments')?.getAttribute('href');
        if (href) navigate(href);
        break;
      }
      case 't': {
        e.preventDefault();
        const focusedComment = document.activeElement?.closest('.comment');
        if (focusedComment) {
          focusedComment.querySelector('[data-translate-comment]')?.click();
          break;
        }
        const card = cards()[selectedIndex];
        if (card) {
          card.querySelector('[data-translate-story]')?.click();
          break;
        }
        const headTranslateBtn = app.querySelector('[data-translate-head]');
        if (headTranslateBtn) {
          headTranslateBtn.click();
        }
        break;
      }
      case 's': {
        const card = cards()[selectedIndex];
        card?.querySelector('[data-save]')?.click();
        break;
      }
      case 'S': {
        const card = cards()[selectedIndex];
        card?.querySelector('[data-share]')?.click();
        break;
      }
      case ',':
        e.preventDefault();
        toggleReadingPanel();
        break;
      case 'd':
        $('#theme-toggle').click();
        break;
      case 'g':
        window.scrollTo({ top: 0, behavior: scrollBehavior() });
        break;
      case '?':
        toggleHelp();
        break;
      default:
        break;
    }
  });
}

function toggleHelp() {
  const dialog = $('#help');
  if (dialog.hasAttribute('open')) dialog.close();
  else dialog.showModal();
}

function closeHelp() {
  const dialog = $('#help');
  if (dialog?.hasAttribute('open')) dialog.close();
}

/* ---------------- Başlangıç ---------------- */

buildNav();
setupTheme();
setupReading();
setupLangPicker();
setupSearch();
setupSkipLink();
setupConnectivity();
setupDelegation();
setupKeyboard();
$('#help-btn').addEventListener('click', toggleHelp);
$('#help-close').addEventListener('click', closeHelp);
onRoute(handleRoute);

// Kayıt durumu başka sekmede değişirse düğmeleri tazele.
window.addEventListener('storage', () => {
  $$('[data-save]', app).forEach((btn) => paintSaveButton(btn, isSaved(Number(btn.dataset.save))));
});
