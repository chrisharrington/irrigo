# Irrigo API

Backend daemon for the Irrigo irrigation control system — **Bun + TypeScript + Fastify + Drizzle + Postgres**. Reads forecasts from Open-Meteo, computes irrigation schedules, controls relays via Home Assistant, and exposes a Fastify API for the client.

Shared conventions (typing, shell rules, ticket workflow, git workflow) live in the root `CLAUDE.md`. This file holds backend-only guidance.

## Database

Postgres (service `db` in `docker-compose.yml`) is the data store; **Drizzle ORM** wraps it, **drizzle-kit** manages schema and migrations.

- Schema lives in `api/db/schema/` — one file per table plus a barrel `index.ts`.
- Migrations are written to `api/drizzle/` by `bun --cwd=./api run db:generate` after schema changes — commit these.
- The runtime client is the typed `db` exported from `api/db/index.ts`. It reads `DATABASE_URL` from the environment; `api/docker-compose.yml` plumbs a default into the api container.
- A fresh environment runs `bun --cwd=./api run db:migrate` (schema-only) and then `bun --cwd=./api run seed` (API-6, JSON-driven).
- Inside Docker, run migrations with `docker compose run --rm api bun run db:migrate`. Migrations are applied via this explicit step — not on app startup — to keep startup deterministic for the single-instance deploy.

## Conventions

- **Every database table includes `created_at` and `updated_at` `timestamptz` columns** (both default `now()`). Use Drizzle's `defaultNow()` for `created_at` and `$onUpdate(() => new Date())` for `updated_at` so the timestamps maintain themselves on insert and update. Applies to all schema migrations going forward.
- **The daemon runs unattended.** Logs are the only window into what it's doing — log liberally via `console.log` / `console.warn` / `console.error` for external calls (Open-Meteo, HA), state transitions (zone open/close), scheduling decisions, and errors. Prefer the noisy log over the quiet one; nobody is watching the terminal in real time.

## Security

The api container exposes manual zone-control endpoints (`POST /zones/:id/open`, `/close`, `/run`) with **no authentication** — they assume a trusted LAN. Bind the api port to LAN-only or run it behind a VPN. **Never expose the api container's port to the public internet.**

## Scripts

Always invoke via `bun --cwd=./api run <script>`. Never the bare `bun --cwd=./api <script>` form — see the root `CLAUDE.md` "Running package.json scripts" section.

| Script | Purpose |
|---|---|
| `start` | Boot the API (`bun index.ts`). |
| `dev` | Boot with `--watch` for local development. |
| `test` | Run the test suite (Bun's native test runner — fine for backend; the bundle has no flow syntax). |
| `type-check` | `tsc --noEmit`. Run before declaring work complete. |
| `seed` | Seed the database from JSON fixtures (API-6). |
| `db:generate` | Generate a migration from the current schema diff. Commit the new file in `api/drizzle/`. |
| `db:migrate` | Apply pending migrations. |
| `db:push` | Push the schema directly to the DB (dev only — bypasses migrations). |
| `db:studio` | Launch Drizzle Studio against `DATABASE_URL`. |
| `up` | `docker compose --profile tools up -d` from the api directory (brings up pgAdmin too). |
| `down` | Tear down the stack. |
| `logs` | Tail the api container's logs (last 100 lines, follow). |
| `replan` | Operator script — re-run the planner from current state. |
| `next-runs` | Operator script — list the next scheduled cycle starts. |
| `enable-schedule` / `disable-schedule` | Toggle a named schedule active/inactive. |
| `toggle-zone` | Manually flip a zone's relay state via HA. |

If a common operation needs an entry, add a script to `api/package.json` rather than running it ad-hoc — the allow-list entry `Bash(bun --cwd=./api run *)` picks new scripts up automatically.
