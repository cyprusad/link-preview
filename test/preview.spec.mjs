import { test, expect, chromium } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EXT_PATH = path.resolve(__dirname, "..");
const MANUAL = "file://" + path.join(__dirname, "manual.html");

test("hover shows glass preview bottom-right of cursor, mouse-away hides it", async () => {
  const context = await chromium.launchPersistentContext("", {
    headless: true,
    args: [
      `--disable-extensions-except=${EXT_PATH}`,
      `--load-extension=${EXT_PATH}`,
      "--no-sandbox",
    ],
  });
  const page = context.pages()[0] || (await context.newPage());
  await page.goto(MANUAL);
  await page.waitForTimeout(1000);

  const link = page.getByRole("link", { name: /example\.com/ });
  const box = await link.boundingBox();
  expect(box).toBeTruthy();
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;

  await page.mouse.move(cx, cy, { steps: 5 });
  // content script debounces (default 300ms) + iframe navigation
  await page.waitForFunction(
    () => !!document.getElementById("link-preview-shadow"),
    null,
    { timeout: 15000 }
  );

  const info = await page.evaluate(() => {
    const host = document.getElementById("link-preview-shadow");
    if (!host) return null;
    const root = host.shadowRoot;
    const card = root && root.querySelector(".lp-card");
    if (!card) return null;
    const r = card.getBoundingClientRect();
    const iframe = root.querySelector("iframe");
    return {
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

  expect(info).toBeTruthy();
  expect(info.visible).toBe(true);
  expect(info.src).toContain("https://example.com");
  // bottom-right of cursor
  expect(info.x).toBeGreaterThan(cx);
  expect(info.y).toBeGreaterThan(cy);
  // inside viewport
  expect(info.x + info.w).toBeLessThanOrEqual(info.vw);
  expect(info.y + info.h).toBeLessThanOrEqual(info.vh);

  // moving away should hide (350ms grace + fade)
  await page.mouse.move(5, 5, { steps: 5 });
  await page.waitForFunction(
    () => {
      const host = document.getElementById("link-preview-shadow");
      const card = host && host.shadowRoot && host.shadowRoot.querySelector(".lp-card");
      return !card || !card.classList.contains("lp-show");
    },
    null,
    { timeout: 10000 }
  );

  await context.close();
});

test("non-previewable links do not trigger a preview", async () => {
  const context = await chromium.launchPersistentContext("", {
    headless: true,
    args: [
      `--disable-extensions-except=${EXT_PATH}`,
      `--load-extension=${EXT_PATH}`,
      "--no-sandbox",
    ],
  });
  const page = context.pages()[0] || (await context.newPage());
  await page.goto(MANUAL);
  await page.waitForTimeout(1000);

  const link = page.getByRole("link", { name: /mailto/ });
  const box = await link.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 3 });
  await page.waitForTimeout(1200);

  const visible = await page.evaluate(() => {
    const host = document.getElementById("link-preview-shadow");
    const card = host && host.shadowRoot && host.shadowRoot.querySelector(".lp-card");
    return !!card && card.classList.contains("lp-show");
  });
  expect(visible).toBe(false);
  await context.close();
});
