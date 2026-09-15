import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: ".",
  testMatch: "preview.spec.mjs",
  timeout: 60000,
  reporter: "line",
});
