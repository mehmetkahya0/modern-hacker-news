# Modern HN

A readability-focused Hacker News interface powered by the [official Hacker News API](https://github.com/HackerNews/API). No build step, no dependencies — plain HTML/CSS/JS. Deploys to GitHub Pages as-is.

## Features

- **Live data** — all content is fetched in real time from `hacker-news.firebaseio.com/v0`; caching is short-lived (60 s for lists, 5 min for items).
- **Feeds** — Top, New, Best, Ask HN, Show HN, Jobs, plus a local "Saved" list.
- **Rich list layout** — every row has an identity instead of being a flat text stack:
  - *source anchor*: the domain's favicon, falling back to a stable colored monogram derived from the domain name if it fails to load,
  - *source line*: domain · time · author,
  - *interest heat*: points-per-hour (`calm` → `very active`) shown as a small bar,
  - *context quote*: for text posts, the post's own body; for link posts, a two-line excerpt from the top comment — so you can see where the discussion is heading before clicking.
- **New post notifications** — while a feed tab is open, it's checked every 90 seconds; a banner appears at the top when new items show up.
- **New comment tracking** — for every post, the last-read time and comment count at that moment are stored:
  - a `+N new` badge on posts you've visited, shown in the feed,
  - a `new` tag, highlighted author name, and left border on comments written after your last read, shown in the thread,
  - `n` / `p` to jump only between new comments (or top-level comments if there are none),
  - an `OP` badge on comments from the person who submitted the post.
- **Live thread** — an open post page is polled every 60 seconds; if the comment count has increased, a "N new comments — Fetch" strip appears, and clicking it refreshes the tree with incoming comments marked as `new`.
- **Readable comment tree** — collapsible headers, depth lines, adjustable line width, incremental loading.
- **Thread controls** — all operate on the already-loaded tree, no extra requests:
  - sort top-level comments by *HN order* / *newest* / *most replies*,
  - `f` to search within comments: matches and their parent chain remain, everything else is filtered out, collapsed branches auto-expand, `Enter` / `Shift+Enter` jump between matches,
  - collapse all / expand all.
- **Reply-branch view** — the `#` link next to a comment now goes to the app's own `#/item/<comment>` address instead of HN: the branch becomes the page title, a breadcrumb trail up to the root post is shown, and the `OP` badge is computed relative to the root's author.
- **Polls** — for `poll` posts, options (`parts` → `pollopt`) are fetched; each option shows its vote count, its percentage of the total, and a bar scaled to the highest-voted option.
- **Reading settings** (`,`) — font size (85–150%), line width (narrow / medium / wide), density (comfortable / compact), and font (sans / serif). Settings are written to the root element as design tokens and persisted in `localStorage`.
- **Sharing** — uses the system share sheet via the Web Share API if available, otherwise copies to clipboard. The shared address is always one that can be opened externally: the article for link posts, the HN page for text posts/polls/comments.
- **Search** — post/comment search via the [HN Search (Algolia) API](https://hn.algolia.com/api), sortable by relevance or date.
- **Theme** — system / light / dark; preference stored in `localStorage`.
- **Read tracking and saving** — kept locally in the browser, no account required.
- **Keyboard shortcuts** — `j` `k` navigate, `Enter`/`o` open, `c` comments, `n` `p` new comments, `t` translate, `s` save, `Shift+s` share, `f` search within comments, `,` reading settings, `/` search, `d` theme, `g` go to top, `?` help.
- Accessibility: skip link, focus rings, `aria` labels, `prefers-reduced-motion` support.

## Tunable points

- **Quote preview** costs 1 extra request per post; it's only fetched once the card enters the viewport (via IntersectionObserver). To disable it, remove the condition that produces the `data-needs-preview` attribute in `assets/js/views/components.js`.
- **Favicons** come from `icons.duckduckgo.com` — the only third-party request in the app. If you'd rather not use it, change the `faviconUrl` function in `components.js` to return `null`; the monogram fallback is already in place, so the UI keeps working the same way.
- **Heat thresholds** are set in a single line in the `heat()` function in `components.js` (`rate / 50`).
- **Live polling intervals**: `POLL_MS` (60 s) in `views/item.js` and `REFRESH_MS` (90 s) in `views/list.js`. Both pause while the tab is in the background (`document.hidden`).
- **Visit history** is capped at the most recent 400 posts (`store.js` → `recordVisit`); it's entirely local and never sent anywhere.
- **Reading setting defaults and limits** live in `READING_DEFAULTS` and `READING_LIMITS` in `store.js`. Values are written to the root element via `applyReading()` as `--read-scale`, `--read-width`, `data-density`, `data-reading`; a new view doesn't need to handle these separately, since the relevant CSS rules already read from these tokens.
- **Poll options** cost an extra request per post (each `pollopt` is a separate record), but they're only fetched for `type: "poll"` posts and only after the title has rendered, so they don't delay the post from appearing.

## Running locally

Since ES modules are used, you need a small server instead of opening the file directly (`file://`):

```bash
python -m http.server 8080
# or
npx serve .
```

Then open: <http://localhost:8080>

## Publishing to GitHub Pages

1. Push this folder to a GitHub repository:

   ```bash
   git init
   git add .
   git commit -m "Modern HN"
   git branch -M main
   git remote add origin https://github.com/mehmetkahya0/modern-hacker-news.git
   git push -u origin main
   ```

2. In the repo, go to **Settings → Pages → Build and deployment → Source: GitHub Actions**.
   The `.github/workflows/deploy.yml` in this repo publishes the site on every push to `main`.

   Alternative: you can instead choose **Deploy from a branch → main / (root)** as the source; in that case the workflow isn't needed.

3. Address: `https://mehmetkahya0.github.io/modern-hacker-news/`

All paths are relative (`assets/...`) and routing is hash-based (`#/item/123`), so no extra configuration is needed for subdirectories or custom domains. The `.nojekyll` file disables Jekyll processing.

## File layout

```
index.html                 app shell markup
assets/css/style.css       design tokens + all styles
assets/js/api.js           HN API client (caching, retry)
assets/js/store.js         theme, reading settings, read state, saves (localStorage)
assets/js/router.js        hash-based routing
assets/js/util.js          helpers + HTML sanitization + request pool
assets/js/app.js           shell: tabs, search, shortcuts, routing
assets/js/views/           list, item, user, search views
```

## Notes

- The HN API requires no authentication or API key and has CORS open, so requests are made directly from the browser.
- The API doesn't return bulk content in one call — each post is a separate request. Requests are therefore limited with a concurrency pool (8 at a time).
- Comment bodies contain HTML from HN's side; tags outside the whitelist are stripped down to plain text by `sanitize()` in `assets/js/util.js`.
- This project is not affiliated with Y Combinator.
