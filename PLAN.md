# link-preview — Hover Link Preview for Chromium

## 1. Vision
A Manifest V3 Chromium extension that shows a small, live preview of a hyperlink's
destination when you hover a link. The preview appears bottom-right of the cursor
in a translucent "liquid glass" bounding box, scaled down so you get the gist
without losing context. It disappears when the cursor leaves the link (grace
period) or after a timeout.

## 2. UX Spec (from request)
- **Trigger:** hover over `<a href="http(s)...">`. Small debounce (~250-350ms)
  so casual mouse-passes don't flash previews.
- **Placement:** `position:fixed` at `cursor.x + 14px, cursor.y + 16px`,
  clamped to viewport so it never overflows off-screen.
- **Size:** default ~320x200 visible box, rendering an 800x600 page scaled
  with `transform: scale()` so text/layout is recognizable but small.
- **Style:** liquid-glass: `backdrop-filter: blur(18px) saturate(1.4)`,
  `rgba(255,255,255,0.55)` / dark-mode aware, 16px radius, 1px translucent
  border, soft shadow, header bar with favicon + domain + close button.
- **Dismiss:** mouse leaves link (350ms grace to allow moving into preview),
  `scroll` / `resize` / `Esc` hides immediately, hard auto-dismiss ~8s safety,
  moving to another link swaps preview.
- **Toggle:** toolbar popup with Enable/Disable, delay slider, size selector.
  Persisted in `chrome.storage.sync`.
- **Safety:** ignore `javascript:`, `mailto:`, `tel:`, `#`, empty hrefs.
  Resolve relative URLs via `new URL(href, location.href)`. Same-tab navigation
  is never triggered by preview. `sandbox="allow-scripts allow-same-origin"`
  + `allow="autoplay 'none'"` style lockdown, no `allow-top-navigation`.

## 3. Technical Approach
- **MV3, no build step, no npm deps at runtime.** Plain JS/CSS/HTML for
  easy review and fast load.
- **Content script (`src/content.js`, `<all_urls>`, `run_at: document_idle`):**
  - `mouseover` / `mousemove` / `mouseout` on document (capture), find
    `e.target.closest('a[href]')`.
  - Shadow DOM host (`#link-preview-shadow`) isolates preview CSS from page.
  - Preview DOM: container > header (favicon img, domain label, URL tooltip,
    close btn) + scaler div > iframe (`src = resolvedUrl`).
  - Viewport clamping logic + `transform-origin: top left` scaling.
  - Loading spinner -> `iframe.onload` hides spinner; `onerror` / 6s timeout
    -> fallback card ("Preview blocked by site (X-Frame-Options) — open link
    to view") with domain + full URL. This is expected for google/github/etc.
  - Caches last URL to avoid re-creating iframe on mousemove over same link.
- **Why iframe, not Ajax fetch + srcdoc?**
  Ajax (`fetch` page HTML) fails on CORS for 99% of cross-origin sites and
  loses CSS/JS/images/subresources. `iframe[src=url]` lets the browser do a
  normal navigation with correct base URL, cookies, CSP. Tradeoff: sites
  sending `X-Frame-Options: DENY/SAMEORIGIN` won't render — we show graceful
  fallback. Future: optional screenshot service / `chrome.tabs.captureVisibleTab`
  thumbnail mode (requires activeTab + host permission, v2).
- **Popup (`src/popup.html/js`):** toggle, delay (0-1000ms), size
  (S/M/L), persisted via `chrome.storage.sync`, content script reads on load
  + `chrome.storage.onChanged` live update. No background service worker
  needed for MVP (keeps permissions minimal).
- **Permissions:** `storage` only. No `<all_urls>` host permissions needed
  because iframe navigation doesn't require them. Content-script `matches`
  is `<all_urls>` so hover works everywhere (Gmail/Docs excluded by Chrome
  Web Store policy automatically where CSP blocks injection — acceptable).

## 4. File Layout
```
manifest.json
src/content.js
src/popup.html
src/popup.js
src/popup.css
icons/icon16.png, icon48.png, icon128.png (placeholder, generated)
test/manual.html (local page with sample links for dev)
test/preview.spec.mjs (Playwright: load unpacked ext in Chromium, hover, assert preview appears)
README.md
PLAN.md (this file)
```

## 5. Milestones / Commits
1. `docs: add project plan` (this commit)
2. `feat: scaffold MV3 extension shell + glass UI + hover preview`
3. `feat: popup settings + storage sync + polish (dark mode, clamp, fallback)`
4. `test: manual page + Playwright unpacked-extension test`
5. `fix: review pass from test run (positioning, dismiss, CSP edge cases)`
- Push each to `main` on `github.com/cyprusad/link-preview` (public).

## 6. Testing Strategy
- `npx playwright install chromium` (isolated test browser, does NOT touch
  user's `/usr/bin/chromium` profile).
- Playwright `chromium.launchPersistentContext('', { args: [--disable-extensions-except, --load-extension] })`,
  goto `test/manual.html` + `example.com`, hover link, assert
  `#link-preview-shadow` exists, iframe `src` matches, box is bottom-right of
  cursor and inside viewport, mouse-away hides it.
- Manual: `chrome://extensions` -> Developer mode -> Load unpacked -> hover
  links on wikipedia/news/blog, check glass look in light/dark, check blocked-
  frame fallback on google.com/github.com.

## 7. Non-goals (v1)
- No link prefetching/scraping backend, no tracking, no remote code.
- No mobile/touch long-press (desktop hover only).
- No full-page screenshots — iframe live render only.
- No per-site allow/deny list UI (v2).

## 8. Risks
- **Framing blocked:** many big sites block iframes — fallback card mitigates.
- **Perf:** one iframe at a time, destroyed on hide; debounce + cache.
- **Page CSS collisions:** Shadow DOM + unique prefix mitigates.
- **CSP `frame-src` on some pages:** content script still runs, iframe src
  is extension-isolated frame — generally allowed.
