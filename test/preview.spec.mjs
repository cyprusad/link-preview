import { test, expect } from "@playwright/test";
import path from "node:path";
import http from "node:http";
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

let server;
let baseURL;

test.beforeAll(async () => {
  server = http.createServer(async (req, res) => {
    const urlPath = req.url.split("?")[0];
    const rel = urlPath === "/" ? "manual.html" : urlPath.slice(1);
    // Serve src/content.js for direct injection harness (see below).
    const file = rel.startsWith("src/")
      ? path.join(ROOT, rel)
      : path.join(__dirname, rel);
    try {
      const data = await fs.readFile(file);
      const type = file.endsWith(".html")
        ? "text/html"
        : file.endsWith(".js")
          ? "text/javascript"
          : "text/plain";
      res.writeHead(200, { "Content-Type": type });
      res.end(data);
    } catch {
      res.writeHead(404);
      res.end("not found");
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  baseURL = `http://127.0.0.1:${port}`;
});

test.afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
});

async function gotoWithContentScript(page) {
  // NOTE: Playwright headless (no Xvfb here) cannot --load-extension.
  // Instead we stub chrome.storage.sync and inject the exact content script
  // file the extension ships. Logic under test is identical.
  await page.addInitScript(() => {
    window.__lpStore = { enabled: true, delay: 100, size: "M" };
    // @ts-ignore
    window.chrome = {
      storage: {
        sync: {
          get: async (defaults) => ({ ...defaults, ...window.__lpStore }),
          set: async (obj) => Object.assign(window.__lpStore, obj),
        },
        onChanged: { addListener: () => {} },
      },
    };
  });
  await page.goto(`${baseURL}/manual.html`);
  await page.waitForTimeout(500);
  const src = await fs.readFile(path.join(ROOT, "src", "content.js"), "utf8");
  await page.evaluate(src);
  await page.waitForTimeout(300);
}

async function previewInfo(page) {
  return page.evaluate(() => {
    const host = document.getElementById("link-preview-shadow");
    if (!host) return null;
    const root = host.shadowRoot;
    const card = root && root.querySelector(".lp-card");
    if (!card) return null;
    const r = card.getBoundingClientRect();
    const iframe = root.querySelector("iframe");
    return {
      present: true,
      visible: card.classList.contains("lp-show"),
      x: r.x,
      y: r.y,
      w: r.width,
      h: r.height,
      src: iframe && iframe.getAttribute("src"),
      vw: window.innerWidth,
      vh: window.innerHeight,
    };
  });
}

test("hover shows glass preview bottom-right of cursor, mouse-away hides it", async ({
  page,
}) => {
  await gotoWithContentScript(page);

  const link = page.getByTestId("local-target");
  const box = await link.boundingBox();
  expect(box).toBeTruthy();
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;

  await page.mouse.move(cx, cy, { steps: 5 });
  await page.waitForFunction(
    () => {
      const host = document.getElementById("link-preview-shadow");
      const card =
        host && host.shadowRoot && host.shadowRoot.querySelector(".lp-card");
      return !!card && card.classList.contains("lp-show");
    },
    null,
    { timeout: 10000 }
  );

  const info = await previewInfo(page);
  expect(info).toBeTruthy();
  expect(info.visible).toBe(true);
  expect(info.src).toContain("/target.html");
  expect(info.x).toBeGreaterThan(cx);
  expect(info.y).toBeGreaterThan(cy);
  expect(info.x + info.w).toBeLessThanOrEqual(info.vw);
  expect(info.y + info.h).toBeLessThanOrEqual(info.vh);

  await page.mouse.move(5, 5, { steps: 5 });
  await page.waitForFunction(
    () => {
      const host = document.getElementById("link-preview-shadow");
      const card =
        host && host.shadowRoot && host.shadowRoot.querySelector(".lp-card");
      return !card || !card.classList.contains("lp-show");
    },
    null,
    { timeout: 10000 }
  );
});

test("non-previewable links do not trigger a preview", async ({ page }) => {
  await gotoWithContentScript(page);

  const link = page.getByRole("link", { name: /mailto/ });
  const box = await link.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, {
    steps: 3,
  });
  await page.waitForTimeout(1000);

  const info = await previewInfo(page);
  expect(!info || info.visible === false).toBe(true);
});

test("manifest is valid MV3 with content script + popup", async () => {
  const raw = await fs.readFile(path.join(ROOT, "manifest.json"), "utf8");
  const m = JSON.parse(raw);
  expect(m.manifest_version).toBe(3);
  expect(m.content_scripts[0].js).toContain("src/content.js");
  expect(m.action.default_popup).toBe("src/popup.html");
  for (const f of [
    "src/content.js",
    "src/popup.html",
    "src/popup.js",
    "src/popup.css",
    "icons/icon16.png",
    "icons/icon48.png",
    "icons/icon128.png",
  ]) {
    await fs.access(path.join(ROOT, f));
  }
});
