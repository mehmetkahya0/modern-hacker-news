// Çeviri servisi: Google Translate GTX API + MyMemory yedek servisi
// Tarayıcı belleğinde önbellekleme ve DOM HTML duyarlı çeviri desteği.

import { getLang, setLang } from './store.js';
import { sanitize } from './util.js';

export const LANGUAGES = [
  { code: 'tr', name: 'Türkçe', flag: '🇹🇷' },
  { code: 'en', name: 'English', flag: '🇬🇧' },
  { code: 'es', name: 'Español', flag: '🇪🇸' },
  { code: 'de', name: 'Deutsch', flag: '🇩🇪' },
  { code: 'fr', name: 'Français', flag: '🇫🇷' },
  { code: 'it', name: 'Italiano', flag: '🇮🇹' },
  { code: 'pt', name: 'Português', flag: '🇵🇹' },
  { code: 'ru', name: 'Русский', flag: '🇷🇺' },
  { code: 'ja', name: '日本語', flag: '🇯🇵' },
  { code: 'zh-CN', name: '中文 (简体)', flag: '🇨🇳' },
];

const translationCache = new Map();

export function getTargetLang() {
  return getLang() || 'tr';
}

export function setTargetLang(code) {
  setLang(code);
  window.dispatchEvent(new CustomEvent('langchange', { detail: { lang: code } }));
}

export function getLangInfo(code = getTargetLang()) {
  return LANGUAGES.find((l) => l.code === code) || LANGUAGES[0];
}

/**
 * Düz metni hedef dile çevirir.
 */
export async function translateText(text, targetLang = getTargetLang(), sourceLang = 'en') {
  if (!text || !text.trim()) return text;
  if (sourceLang === targetLang) return text;

  const trimmed = text.trim();
  const cacheKey = `${sourceLang}:${targetLang}:${trimmed}`;

  if (translationCache.has(cacheKey)) {
    return translationCache.get(cacheKey);
  }

  // 1. Birincil Servis: Google Translate GTX endpoint (ücretsiz, hızlı, çok dilli)
  const gtxUrl = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${encodeURIComponent(
    sourceLang
  )}&tl=${encodeURIComponent(targetLang)}&dt=t&q=${encodeURIComponent(trimmed)}`;

  try {
    const res = await fetch(gtxUrl);
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data) && Array.isArray(data[0])) {
        const translated = data[0]
          .map((chunk) => (Array.isArray(chunk) ? chunk[0] : ''))
          .filter(Boolean)
          .join('');

        if (translated) {
          translationCache.set(cacheKey, translated);
          return translated;
        }
      }
    }
  } catch (err) {
    console.warn('Google Translate API hatası, yedek servise geçiliyor:', err);
  }

  // 2. İkincil Yedek Servis: MyMemory Translation API (en|tr gibi 2 harfli ISO kodları kullanır)
  try {
    const src = sourceLang || 'en';
    const myMemoryUrl = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(
      trimmed
    )}&langpair=${encodeURIComponent(src)}|${encodeURIComponent(targetLang)}`;
    const res = await fetch(myMemoryUrl);
    if (res.ok) {
      const data = await res.json();
      if (data.responseStatus === 200 && data.responseData?.translatedText) {
        const translated = data.responseData.translatedText;
        translationCache.set(cacheKey, translated);
        return translated;
      }
    }
  } catch (err) {
    console.error('Tüm çeviri servisleri başarısız oldu:', err);
  }

  // Çevrilememişse orijinal metne geri dön
  return text;
}

/**
 * HTML yapısını (paragraflar, bağlantılar, stil etiketleri) koruyarak metin düğümlerini çevirir.
 */
export async function translateHtml(html, targetLang = getTargetLang()) {
  if (!html || !html.trim()) return html;

  const parser = new DOMParser();
  const doc = parser.parseFromString(`<div>${html}</div>`, 'text/html');
  const container = doc.body.firstElementChild;

  const textNodes = [];

  function collectTextNodes(node) {
    if (node.nodeType === Node.TEXT_NODE) {
      const txt = node.textContent || '';
      if (txt.trim().length > 0) {
        textNodes.push(node);
      }
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      // Kod bloklarının içindeki kod örneklerini doğrudan bozmamak için atla
      const tag = node.tagName.toUpperCase();
      if (tag === 'PRE' || tag === 'CODE') return;
      for (const child of node.childNodes) {
        collectTextNodes(child);
      }
    }
  }

  collectTextNodes(container);

  if (textNodes.length === 0) return html;

  // Benzersiz metin parçalarını eşzamanlı çevir
  const uniqueTexts = [...new Set(textNodes.map((n) => n.textContent.trim()))];
  const translations = new Map();

  await Promise.all(
    uniqueTexts.map(async (srcText) => {
      const res = await translateText(srcText, targetLang);
      translations.set(srcText, res);
    })
  );

  for (const node of textNodes) {
    const srcText = node.textContent.trim();
    const translated = translations.get(srcText);
    if (translated) {
      // Orijinaldeki baş/son boşlukları koru
      const leading = (node.textContent || '').match(/^\s*/)?.[0] || '';
      const trailing = (node.textContent || '').match(/\s*$/)?.[0] || '';
      node.textContent = leading + translated + trailing;
    }
  }

  return sanitize(container.innerHTML);
}
