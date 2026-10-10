# Spark

A mobile-first dating PWA for discovering people, sharing likes and sparks, and managing a dating profile.

## Run & Operate

- `pnpm --filter @workspace/spark run dev` — run the Spark preview
- `pnpm --filter @workspace/spark run build` — build the GitHub Pages site into `docs/`
- `pnpm --filter @workspace/spark run typecheck` — typecheck the Spark app

## Stack

- pnpm workspace, React, Vite, TypeScript
- Supabase Auth, RPCs, and Storage; the Supabase backend already exists
- Tailwind CSS, Framer Motion, and vite-plugin-pwa
- GitHub Pages static hosting from the committed root `docs/` directory

## Where things live

- `artifacts/spark/` — web app source and build configuration
- `artifacts/spark/src/config.ts` — the only application configuration file; contains the public Supabase URL/key and app name
- `docs/` — generated GitHub Pages site; do not ignore or omit it from commits

## Architecture decisions

- Supabase is the existing system of record; do not create tables, SQL, migrations, or edge functions.
- Use HashRouter, relative Vite base paths, and `docs/` output for the GitHub Pages project site.
- Keep application configuration in `artifacts/spark/src/config.ts`; do not introduce environment variables or Replit Secrets.

## Product

Spark provides email/password authentication, profile onboarding and editing, swipe-based discovery, Likes, a Sparks placeholder for part 2, travel mode, mood settings, streak display, and account deletion.

## User preferences

- Email/password authentication only; no magic links and no password-reset flow.
- Profile photos are limited to three, compressed in the browser, and stored in Supabase's `photos` bucket.

## Gotchas

- Run the Spark build after code/config changes so the committed GitHub Pages `docs/` output stays current.
- `.gitignore` should contain only `node_modules`; keep `docs/` tracked.

## Pointers

- See the `pnpm-workspace` skill for workspace structure and package details.
