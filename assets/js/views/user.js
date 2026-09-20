import { getUser, getItem, hnUserUrl } from '../api.js';
import { esc, fullDate, nf, sanitize, pool } from '../util.js';
import { storyCard, commentCard, enhanceCards, teardownPreviews, skeletonList, loadingBox, errorBox, emptyBox } from './components.js';

const BATCH = 20;

export async function renderUser({ container, token, params }) {
  // Bozuk yüzde kodlaması (ör. #/user/%) decodeURIComponent'i patlatır.
  let id;
  try {
    id = decodeURIComponent(params.id);
  } catch {
    id = params.id;
  }
  container.innerHTML = `
<section class="view">
  <a class="back-link" href="#/top">← Geri</a>
  <div data-profile>${skeletonList(1)}</div>
  <h2 class="section-title" data-sub-title hidden>Son paylaşımlar</h2>
  <div class="stories" data-stories></div>
  <div class="list-foot" data-foot></div>
</section>`;

  const profileEl = container.querySelector('[data-profile]');
  const listEl = container.querySelector('[data-stories]');
  const footEl = container.querySelector('[data-foot]');
  const subTitle = container.querySelector('[data-sub-title]');

  let submitted = [];
  let cursor = 0;
  let loading = false;

  // Dinleyici görünüm kurulurken bir kez bağlanır; yeniden çizim onu çoğaltmamalı.
  container.addEventListener('click', (e) => {
    if (e.target.closest('[data-more]')) loadBatch();
    // Yeniden denemeyi yönlendiriciye bırak: eski görünüm düzgünce sökülsün.
    if (e.target.closest('[data-retry]')) window.dispatchEvent(new HashChangeEvent('hashchange'));
  });

  async function loadBatch() {
    if (loading || cursor >= submitted.length) return;
    loading = true;
    footEl.innerHTML = loadingBox('Paylaşımlar yükleniyor…');
    const slice = submitted.slice(cursor, cursor + BATCH);
    let items;
    try {
      items = (await pool(slice, 8, (itemId) => getItem(itemId).catch(() => null))).filter(Boolean);
    } catch (err) {
      footEl.innerHTML = errorBox(err.message);
      loading = false;
      return;
    }
    if (token.cancelled) {
      loading = false;
      return;
    }

    const html = items
      .map((item) => {
        if (item.type === 'comment') {
          return commentCard({
            id: item.id,
            parentId: item.parent,
            by: item.by,
            time: item.time,
            text: item.text,
          });
        }
        return storyCard(item);
      })
      .join('');

    listEl.insertAdjacentHTML('beforeend', html);
    enhanceCards(listEl, token);
    cursor += slice.length;
    footEl.innerHTML =
      cursor < submitted.length ? `<button class="btn btn--wide" data-more>Daha fazla</button>` : '';
    loading = false;
  }

  try {
    const user = await getUser(id);
    if (token.cancelled) return;
    if (!user) {
      profileEl.innerHTML = emptyBox('Kullanıcı bulunamadı', `"${id}" adlı kullanıcı yok.`);
      return;
    }
    document.title = `${user.id} · Modern HN`;

    profileEl.innerHTML = `
<div class="profile">
  <h1 class="profile__name">${esc(user.id)}</h1>
  <div class="profile__stats">
    <span class="meta"><strong>${nf(user.karma)}</strong> karma</span>
    <span class="meta">katılım: ${fullDate(user.created)}</span>
    <span class="meta">${nf(user.submitted?.length || 0)} paylaşım</span>
    <a class="meta meta--link" href="${hnUserUrl(user.id)}" target="_blank" rel="noopener noreferrer">HN profili ↗</a>
  </div>
  ${user.about ? `<div class="profile__about prose" lang="en">${sanitize(user.about)}</div>` : ''}
</div>`;

    submitted = user.submitted || [];
    if (!submitted.length) {
      footEl.innerHTML = emptyBox('Paylaşım yok');
      return;
    }
    subTitle.hidden = false;
    await loadBatch();
  } catch (err) {
    profileEl.innerHTML = errorBox(err.message);
  }

  return () => teardownPreviews(listEl);
}
