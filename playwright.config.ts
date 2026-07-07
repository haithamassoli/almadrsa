import { defineConfig, devices } from "@playwright/test";

/**
 * M7 smoke tests. They run against the ALREADY-RUNNING dev servers
 * (`next dev -p 3001` + `convex dev`) — `reuseExistingServer: true` makes the
 * webServer block attach to them instead of spawning a second instance.
 *
 * The suite is intentionally serial (one project, one worker): both specs
 * share the seeded demo dataset and each `seed:e2eBootstrap` call rotates the
 * demo student's access code.
 */
export default defineConfig({
  testDir: "./tests",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: "list",
  // Long, multi-actor flows on a dev server that compiles routes on demand.
  timeout: 120_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL: "http://localhost:3001",
    trace: "retain-on-failure",
  },
  projects: [
    {
      // Phone-sized Chromium: iPhone 13 metrics (390×844, mobile, touch)
      // rendered by the Chromium engine.
      name: "chromium",
      use: { ...devices["iPhone 13"], browserName: "chromium" },
    },
  ],
  webServer: {
    command: "npm run dev",
    url: "http://localhost:3001",
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
