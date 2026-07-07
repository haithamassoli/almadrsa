# Deploy

## Environments

- **Convex dev**: `dev:dazzling-bass-155` (per-developer, `npm run dev:backend`).
- **Convex prod**: created automatically on first `npx convex deploy`.
- **Vercel**: previews per branch + production. Build command is set in
  `vercel.json` (`npx convex deploy --cmd 'npm run build'`) so every Vercel
  build pushes Convex functions for the matching environment.

## One-time Vercel setup (manual)

1. `npm i -g vercel && vercel login && vercel link`
2. In Vercel project settings → Environment Variables:
   - `CONVEX_DEPLOY_KEY` — production deploy key from the Convex dashboard
     (Settings → Deploy keys). Use a **preview** deploy key for the Preview
     environment so previews get isolated Convex backends.
   - `NEXT_PUBLIC_CONVEX_URL`, `NEXT_PUBLIC_CONVEX_SITE_URL` — filled by
     `npx convex deploy` automatically when using the build command above.
3. Convex prod env vars (Convex dashboard → Settings → Environment Variables):
   - `SITE_URL` — the production domain (e.g. `https://school.example.com`)
   - `BETTER_AUTH_SECRET` — `openssl rand -base64 32`

## Local dev

```bash
npm run dev:backend   # convex dev (watches convex/)
npm run dev           # next dev on http://localhost:3001
```

Port 3001 is pinned (3000 is commonly taken on this machine); `SITE_URL` on
the Convex dev deployment points there.

## Backups

Enable automatic backups on the prod deployment: Convex dashboard → Backups
(part of the M7 pilot checklist). Full click-by-click steps are in the
Production checklist below.

## Production checklist (M7)

Run this once to stand up production. Do the steps in order — Vercel needs the
Convex prod URLs, and Convex prod needs `SITE_URL` set to the real domain.

### 1. Link the Vercel project

```bash
npm i -g vercel        # or: pnpm add -g vercel
vercel login
vercel link            # from the repo root; pick/create the production project
```

The build command is already committed in `vercel.json`:

```json
{ "buildCommand": "npx convex deploy --cmd 'npm run build'" }
```

`npx convex deploy` pushes Convex functions to the deployment named by
`CONVEX_DEPLOY_KEY`, then runs `npm run build` with `NEXT_PUBLIC_CONVEX_URL`
and `NEXT_PUBLIC_CONVEX_SITE_URL` injected for that deployment. Do **not**
override the build command in the Vercel dashboard.

### 2. Create the Convex production deployment

```bash
npx convex deploy      # first run creates prod:<name> and prints its URLs
```

Note the two URLs it prints (the `.convex.cloud` and `.convex.site` URLs) — you
do not paste them into Vercel by hand; the build command injects them. You only
need them to fill Convex's own `SITE_URL` if you have no custom domain yet.

### 3. Set Vercel environment variables

Vercel project → Settings → Environment Variables:

- `CONVEX_DEPLOY_KEY` — **Production** environment. Generate it in the Convex
  dashboard: production deployment → Settings → Deploy Keys → Generate a
  production deploy key. Paste the value into Vercel. (For the **Preview**
  environment, generate a separate *preview* deploy key so PR previews get
  isolated Convex backends — never reuse the prod key for previews.)
- `NEXT_PUBLIC_CONVEX_URL` and `NEXT_PUBLIC_CONVEX_SITE_URL` — leave these
  **unset** in Vercel. `npx convex deploy --cmd` sets them for the build from
  the prod deployment automatically. Only add them manually if you ever move to
  a plain `npm run build` command.

Do not print or paste any secret values into docs, commits, or chat — set them
in the dashboard only.

### 4. Set Convex production environment variables

Convex dashboard → **production** deployment → Settings → Environment Variables.
The app reads these (names only — set the values in the dashboard, never commit
them):

- `SITE_URL` — the production origin the app is served from, e.g.
  `https://school.example.com` (no trailing slash). Used by
  `convex/auth.ts` (Better Auth `baseURL` + `trustedOrigins`) and by
  `convex/http.ts` for the CORS `Access-Control-Allow-Origin`. **Must** match
  the domain the browser actually loads, or staff login and code login break.
- `BETTER_AUTH_SECRET` — signing secret for Better Auth sessions. Generate with
  `openssl rand -base64 32` and paste the value into the dashboard.

`CONVEX_SITE_URL` (read in `convex/auth.config.ts`) is **provided
automatically** by Convex for every deployment — do not set it yourself.

After changing any Convex env var, redeploy (`npx convex deploy`, or push to
trigger a Vercel build) so functions pick up the new values.

### 5. Custom domain

If serving from a custom domain, add it in Vercel (Settings → Domains), then set
Convex prod `SITE_URL` to that exact `https://<domain>` and redeploy. Confirm a
staff login and a student code login both succeed on the real domain before
onboarding anyone.

### 6. Enable Convex automatic backups (dashboard only — no CLI)

Automatic/scheduled backups **cannot** be enabled from the CLI; you must use the
dashboard. Exact clicks:

1. Open <https://dashboard.convex.dev> and select the **production** deployment
   (the deployment switcher is top-left — make sure it is `prod:<name>`, not a
   dev deployment).
2. In the left sidebar, click **Backups**.
3. Toggle on **Scheduled backups** (also labelled *periodic/automatic backups*).
4. Set **Frequency** to **Daily**.
5. Set **Retention** to your policy (e.g. keep the last **7** daily backups).
6. Save. Verify the schedule shows as enabled and, optionally, click **Back up
   now** once to confirm a manual backup succeeds.

Re-check this after any deployment rename or plan change — scheduled backups are
per-deployment. This is a Phase-1 pilot go-live gate; do not onboard real
student data until backups are confirmed on.

### 7. Go-live smoke test

Before the pilot (see `docs/pilot-runbook.md`), on a phone against the prod URL:
staff login → create structure → issue a code → student code login → teacher
marks attendance → parent sees it; then one full exam cycle (publish → take →
result). If all pass, production is ready.
