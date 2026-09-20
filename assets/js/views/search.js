import { search } from '../api.js';
import { esc } from '../util.js';
import { storyCard, commentCard, enhanceCards, teardownPreviews, skeletonList, loadingBox, errorBox, emptyBox } from './components.js';

function buildHash(q, sort, type) {
  const p = new URLSearchParams({ q });
  if (sort === 'date') p.set('sort', 'date');
  if (type === 'comment') p.set('type', 'comment');
  return `#/search?${p.toString()}`;
}

export async function renderSearch({ container, token, params }) {
  const query = params.q || '';
  const byDate = params.sort === 'date';
  const tags = params.type === 'comment' ? 'comment' : 'story';

  container.innerHTML = `
<section class="view">
  <header class="view__head">
    <h1 class="view__title">“${esc(query)}” için sonuçlar</h1>
  </header>
  <div class="filters" role="group" aria-label="Arama filtreleri">
    <a class="chip${tags === 'story' ? ' is-active' : ''}" href="${buildHash(query, params.sort, 'story')}">Gönderiler</a>
    <a class="chip${tags === 'comment' ? ' is-active' : ''}" href="${buildHash(query, params.sort, 'comment')}">Yorumlar</a>
    <span class="filters__sep"></span>
    <a class="chip${!byDate ? ' is-active' : ''}" href="${buildHash(query, 'relevance', params.type)}">İlgili</a>
    <a class="chip${byDate ? ' is-active' : ''}" href="${buildHash(query, 'date', params.type)}">En yeni</a>
  </div>
  <div class="stories" data-results>${skeletonList(6)}</div>
  <div class="list-foot" data-foot></div>
</section>`;

  const resultsEl = container.querySelector('[data-results]');
  const footEl = container.querySelector('[data-foot]');
  let page = 0;
  let pages = 0;
  let loading = false;

  // Algolia sonucunu Firebase API'sindeki gönderi şekline çevirip aynı kartı kullanıyoruz.
  function hitHtml(hit) {
    const id = Number(hit.objectID);
    if (tags === 'comment') {
      return commentCard({
        id,
        parentId: hit.story_id || id,
        by: hit.author,
        time: hit.created_at_i,
        text: hit.comment_text,
        contextLabel: hit.story_title ? `bağlam: ${hit.story_title}` : 'bağlamı gör',
      });
    }
    return storyCard({
      id,
      title: hit.title,
      url: hit.url,
      score: hit.points,
      by: hit.author,
      time: hit.created_at_i,
      descendants: hit.num_comments,
      text: hit.story_text,
      type: 'story',
    });
  }

  async function load(reset = false) {
    if (loading) return;
    loading = true;
    if (reset) {
      resultsEl.innerHTML = skeletonList(6);
      page = 0;
    }
    footEl.innerHTML = loadingBox('Aranıyor…');
    try {
      const data = await search(query, { page, tags, byDate });
      if (token.cancelled) return;
      if (reset) resultsEl.innerHTML = '';
      pages = data.nbPages || 0;
      if (!data.hits?.length && page === 0) {
        resultsEl.innerHTML = emptyBox('Sonuç bulunamadı', `“${esc(query)}” için sonuç yok. Farklı bir anahtar kelime dene.`);
        footEl.innerHTML = '';
        return;
      }
      resultsEl.insertAdjacentHTML('beforeend', data.hits.map(hitHtml).join(''));
      enhanceCards(resultsEl, token);
      page++;
      footEl.innerHTML = page < pages ? `<button class="btn btn--wide" data-more>Daha fazla sonuç</button>` : '';
    } catch (err) {
      footEl.innerHTML = errorBox(err.message);
    } finally {
      loading = false;
    }
  }

  container.addEventListener('click', (e) => {
    if (e.target.closest('[data-more]')) load();
    if (e.target.closest('[data-retry]')) load(true);
  });

  if (!query.trim()) {
    resultsEl.innerHTML = emptyBox('Arama yapmak için bir şeyler yaz', 'Üstteki arama kutusunu kullan (kısayol: /).');
    footEl.innerHTML = '';
    return;
  }

  document.title = `${query} · arama · Modern HN`;
  await load(true);
  return () => teardownPreviews(resultsEl);
}
