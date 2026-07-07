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
(part of the M7 pilot checklist).
