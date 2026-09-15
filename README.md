# Link Preview

Hover any hyperlink and get a live, glassy preview bottom-right of your cursor.

Chromium MV3 extension. No build step, no runtime dependencies, no tracking.

## Install (dev)

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. **Load unpacked** → select this repo folder
4. Hover any `http(s)` link. Esc / scroll / moving away dismisses.

## Settings

Click the toolbar icon:

- Enable/disable previews
- Hover delay (0–1000ms)
- Size S/M/L

Stored in `chrome.storage.sync`.

## How it works

- `src/content.js` listens for `mouseover` on `a[href]`, debounces, resolves the
  URL, and renders an `800×600` iframe scaled down into a ~`320px` glass card
  positioned bottom-right of the cursor with viewport clamping.
- UI lives in a closed Shadow DOM (`#link-preview-shadow`) so page CSS can't
  break it. Liquid-glass styling via `backdrop-filter: blur + saturate`.
- `sandbox="allow-scripts allow-same-origin ..."` with no `allow-top-navigation`
  so previews can't hijack your tab. Non-http(s) links (`mailto:`, `javascript:`,
  `#`, …) are ignored.
- Sites sending `X-Frame-Options: DENY / SAMEORIGIN` (Google, GitHub, …) can't
  be framed — a fallback card with the domain + URL is shown instead.

## Test

```sh
npm install
npm test
```

Playwright launches an isolated Chromium with the unpacked extension loaded,
hovers a link on `test/manual.html`, and asserts the preview appears
bottom-right of the cursor, then hides on mouse-away.

Manual page: open `test/manual.html` in Chromium with the extension loaded.

## Layout

```
manifest.json
src/content.js   — hover detection, glass preview card, dismiss logic
src/popup.html/js/css — settings UI
icons/           — extension icons
test/manual.html — dev page with sample links
test/preview.spec.mjs — Playwright unpacked-extension test
PLAN.md          — product/technical plan
```
