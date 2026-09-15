/* Link Preview — content script (no build, no deps).
 * Shows a live iframe preview bottom-right of the cursor on link hover.
 * Isolated via Shadow DOM so page CSS can't break the glass UI.
 */
(() => {
  "use strict";

  const RENDER_W = 800;
  const RENDER_H = 600;
  const OFFSET_X = 14;
  const OFFSET_Y = 16;
  const HIDE_GRACE_MS = 350;
  const AUTO_DISMISS_MS = 8000;
  const LOAD_TIMEOUT_MS = 7000;

  const SIZES = {
    S: { visibleW: 280 },
    M: { visibleW: 320 },
    L: { visibleW: 400 },
  };

  const DEFAULTS = { enabled: true, delay: 300, size: "M" };
  let settings = { ...DEFAULTS };

  let shadowHost = null;
  let shadow = null;
  let card = null;
  let scaler = null;
  let frame = null;
  let spinner = null;
  let fallback = null;
  let domainLabel = null;
  let faviconImg = null;

  let hoverLink = null;
  let lastMouse = { x: 0, y: 0 };
  let showTimer = null;
  let hideTimer = null;
  let autoDismissTimer = null;
  let loadTimer = null;
  let currentUrl = null;
  let hoveringCard = false;

  function scaleFor(size) {
    const cfg = SIZES[size] || SIZES.M;
    return cfg.visibleW / RENDER_W;
  }

  function visibleH(size) {
    return Math.round(RENDER_H * scaleFor(size));
  }

  function visibleW(size) {
    return (SIZES[size] || SIZES.M).visibleW;
  }

  async function loadSettings() {
    try {
      const stored = await chrome.storage.sync.get(DEFAULTS);
      settings = { ...DEFAULTS, ...stored };
    } catch {
      settings = { ...DEFAULTS };
    }
  }

  function isPreviewable(href) {
    if (!href) return null;
    const t = href.trim();
    if (!t || t.startsWith("#")) return null;
    const lower = t.toLowerCase();
    for (const p of ["javascript:", "mailto:", "tel:", "sms:", "data:", "blob:", "file:"]) {
      if (lower.startsWith(p)) return null;
    }
    try {
      const u = new URL(t, location.href);
      if (u.protocol !== "http:" && u.protocol !== "https:") return null;
      return u.href;
    } catch {
      return null;
    }
  }

  function ensureDom() {
    if (shadowHost) return;
    shadowHost = document.createElement("div");
    shadowHost.id = "link-preview-shadow";
    // Keep extension UI above page content but below nothing critical.
    shadowHost.style.cssText =
      "position:fixed;top:0;left:0;width:0;height:0;z-index:2147483647;pointer-events:none;";
    document.documentElement.appendChild(shadowHost);
    shadow = shadowHost.attachShadow({ mode: "closed" });

    const style = document.createElement("style");
    style.textContent = `
      .lp-card {
        position: fixed;
        pointer-events: auto;
        width: var(--lp-w);
        border-radius: 16px;
        overflow: hidden;
        background: rgba(255,255,255,0.55);
        -webkit-backdrop-filter: blur(18px) saturate(1.4);
        backdrop-filter: blur(18px) saturate(1.4);
        border: 1px solid rgba(255,255,255,0.65);
        box-shadow: 0 12px 40px rgba(0,0,0,0.22), inset 0 1px 0 rgba(255,255,255,0.6);
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        color: #111;
        opacity: 0;
        transform: translateY(4px) scale(0.98);
        transition: opacity 140ms ease, transform 140ms ease;
      }
      .lp-card.lp-show { opacity: 1; transform: translateY(0) scale(1); }
      @media (prefers-color-scheme: dark) {
        .lp-card { background: rgba(28,28,32,0.55); border-color: rgba(255,255,255,0.18); color: #f2f2f2; }
        .lp-header { background: rgba(255,255,255,0.06); border-color: rgba(255,255,255,0.1); }
        .lp-url { color: rgba(255,255,255,0.65); }
      }
      .lp-header {
        display: flex; align-items: center; gap: 8px;
        padding: 7px 10px;
        background: rgba(255,255,255,0.5);
        border-bottom: 1px solid rgba(0,0,0,0.06);
        font-size: 12px; font-weight: 600;
        white-space: nowrap; overflow: hidden;
      }
      .lp-header img { width: 16px; height: 16px; border-radius: 4px; flex: none; }
      .lp-domain { overflow: hidden; text-overflow: ellipsis; flex: 1; }
      .lp-url { font-weight: 400; opacity: 0.7; font-size: 11px; overflow: hidden; text-overflow: ellipsis; }
      .lp-close {
        border: 0; background: rgba(0,0,0,0.08); color: inherit;
        width: 20px; height: 20px; border-radius: 50%;
        cursor: pointer; font-size: 12px; line-height: 20px; flex: none; padding: 0;
      }
      .lp-close:hover { background: rgba(0,0,0,0.18); }
      .lp-viewport { position: relative; width: var(--lp-w); height: var(--lp-h); background: #fff; }
      .lp-scaler { width: ${RENDER_W}px; height: ${RENDER_H}px; transform-origin: top left; }
      .lp-scaler iframe { width: ${RENDER_W}px; height: ${RENDER_H}px; border: 0; background: #fff; display: block; }
      .lp-loading {
        position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
        background: rgba(255,255,255,0.4); font-size: 12px; gap: 8px;
      }
      .lp-spinner {
        width: 16px; height: 16px; border-radius: 50%;
        border: 2px solid rgba(0,0,0,0.15); border-top-color: rgba(0,0,0,0.55);
        animation: lp-spin 0.8s linear infinite;
      }
      @keyframes lp-spin { to { transform: rotate(360deg); } }
      .lp-fallback {
        display: none; padding: 14px; font-size: 12px; line-height: 1.5;
        background: rgba(255,255,255,0.7); color: #333;
      }
      .lp-fallback.lp-on { display: block; }
      .lp-fallback code { display: block; margin-top: 6px; word-break: break-all; font-size: 11px; opacity: 0.8; }
    `;
    shadow.appendChild(style);

    card = document.createElement("div");
    card.className = "lp-card";
    card.innerHTML = `
      <div class="lp-header">
        <img class="lp-favicon" alt="" />
        <span class="lp-domain"></span>
        <button class="lp-close" title="Close preview (Esc)">✕</button>
      </div>
      <div class="lp-viewport">
        <div class="lp-scaler"><iframe sandbox="allow-scripts allow-same-origin allow-forms allow-popups" loading="lazy" referrerpolicy="no-referrer" title="Link preview"></iframe></div>
        <div class="lp-loading"><div class="lp-spinner"></div><span>Loading preview…</span></div>
        <div class="lp-fallback"><span class="lp-fallback-msg">This site blocks embedding, so a live preview isn't available.</span><code class="lp-url"></code></div>
      </div>
    `;
    shadow.appendChild(card);

    scaler = card.querySelector(".lp-scaler");
    frame = card.querySelector("iframe");
    spinner = card.querySelector(".lp-loading");
    fallback = card.querySelector(".lp-fallback");
    domainLabel = card.querySelector(".lp-domain");
    faviconImg = card.querySelector(".lp-favicon");

    card.querySelector(".lp-close").addEventListener("click", (e) => {
      e.stopPropagation();
      hidePreview();
    });
    card.addEventListener("mouseenter", () => {
      hoveringCard = true;
      clearTimeout(hideTimer);
    });
    card.addEventListener("mouseleave", () => {
      hoveringCard = false;
      scheduleHide(HIDE_GRACE_MS);
    });
    frame.addEventListener("load", () => {
      clearTimeout(loadTimer);
      if (spinner) spinner.style.display = "none";
    });
  }

  function clampPosition(x, y, w, h) {
    const pad = 8;
    let px = x + OFFSET_X;
    let py = y + OFFSET_Y;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    if (px + w > vw - pad) px = x - w - 12;
    if (py + h > vh - pad) py = y - h - 12;
    px = Math.max(pad, Math.min(px, vw - w - pad));
    py = Math.max(pad, Math.min(py, vh - h - pad));
    return { px, py };
  }

  function positionCard() {
    if (!card || !currentUrl) return;
    const w = visibleW(settings.size);
    const h = visibleH(settings.size) + 34; // + header
    const { px, py } = clampPosition(lastMouse.x, lastMouse.y, w, h);
    card.style.left = `${px}px`;
    card.style.top = `${py}px`;
  }

  function showPreview(url) {
    ensureDom();
    const scale = scaleFor(settings.size);
    const w = visibleW(settings.size);
    const h = visibleH(settings.size);

    card.style.setProperty("--lp-w", `${w}px`);
    card.style.setProperty("--lp-h", `${h}px`);
    scaler.style.transform = `scale(${scale})`;
    // Hide stale frame while new one loads to avoid showing old site.
    if (currentUrl !== url) {
      try {
        frame.removeAttribute("src");
      } catch { /* noop */ }
      if (spinner) spinner.style.display = "flex";
      fallback.classList.remove("lp-on");
    }
    currentUrl = url;

    let domain = "";
    try {
      domain = new URL(url).hostname;
    } catch {
      domain = url;
    }
    domainLabel.textContent = domain;
    domainLabel.title = url;
    const urlEl = card.querySelector(".lp-fallback .lp-url");
    if (urlEl) urlEl.textContent = url;
    faviconImg.style.display = "";
    faviconImg.src = `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=32`;
    faviconImg.onerror = () => {
      faviconImg.style.display = "none";
    };

    positionCard();
    card.classList.add("lp-show");

    // Kick off navigation after positioning so first paint is placed correctly.
    if (frame.getAttribute("src") !== url) {
      frame.setAttribute("src", url);
    }

    clearTimeout(loadTimer);
    loadTimer = setTimeout(() => {
      // Site may block framing (X-Frame-Options). Keep trying but surface hint.
      if (spinner) spinner.style.display = "none";
      fallback.classList.add("lp-on");
    }, LOAD_TIMEOUT_MS);

    clearTimeout(autoDismissTimer);
    autoDismissTimer = setTimeout(hidePreview, AUTO_DISMISS_MS);
  }

  function hidePreview() {
    clearTimeout(showTimer);
    clearTimeout(hideTimer);
    clearTimeout(autoDismissTimer);
    clearTimeout(loadTimer);
    currentUrl = null;
    hoverLink = null;
    if (card) card.classList.remove("lp-show");
    // Destroy navigation so video/audio in preview stops.
    if (frame) {
      // Defer src removal until fade-out finishes.
      setTimeout(() => {
        if (!currentUrl) {
          try {
            frame.removeAttribute("src");
          } catch { /* noop */ }
        }
      }, 160);
    }
  }

  function scheduleHide(ms) {
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => {
      if (!hoveringCard) hidePreview();
    }, ms);
  }

  function onMouseOver(e) {
    if (!settings.enabled) return;
    const link = e.target && e.target.closest ? e.target.closest("a[href]") : null;
    if (!link) return;
    // Don't preview links inside our own shadow UI.
    if (shadowHost && shadowHost.contains(e.target)) return;
    const url = isPreviewable(link.getAttribute("href"));
    if (!url) return;
    hoverLink = link;
    lastMouse = { x: e.clientX, y: e.clientY };
    clearTimeout(hideTimer);
    clearTimeout(showTimer);
    if (currentUrl === url && card && card.classList.contains("lp-show")) {
      positionCard();
      return;
    }
    showTimer = setTimeout(() => showPreview(url), Math.max(0, settings.delay));
  }

  function onMouseMove(e) {
    lastMouse = { x: e.clientX, y: e.clientY };
    if (card && card.classList.contains("lp-show") && currentUrl) {
      positionCard();
    }
  }

  function onMouseOut(e) {
    if (!hoverLink) return;
    const to = e.relatedTarget;
    // Still inside the same link (e.g. moved across child nodes) — keep waiting.
    if (to && to.closest && hoverLink.contains(to)) return;
    // Moving into our preview card — don't hide.
    if (shadowHost && to instanceof Node && shadowHost.contains(to)) return;
    clearTimeout(showTimer);
    scheduleHide(HIDE_GRACE_MS);
  }

  function onScroll() {
    if (currentUrl) hidePreview();
  }

  function onKey(e) {
    if (e.key === "Escape") hidePreview();
  }

  async function init() {
    await loadSettings();
    try {
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== "sync") return;
        if (changes.enabled) settings.enabled = changes.enabled.newValue;
        if (changes.delay) settings.delay = changes.delay.newValue;
        if (changes.size) settings.size = changes.size.newValue;
        if (!settings.enabled) hidePreview();
      });
    } catch { /* storage events unavailable — settings still apply on reload */ }
    document.addEventListener("mouseover", onMouseOver, true);
    document.addEventListener("mousemove", onMouseMove, true);
    document.addEventListener("mouseout", onMouseOut, true);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onScroll, true);
    document.addEventListener("keydown", onKey, true);
  }

  init();
})();
