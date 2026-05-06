# Irrigo

Irrigation control system. The repo contains:

- **`api/`** — Bun + TypeScript backend that generates irrigation schedules from weather data (Open-Meteo).
- **`app/`** — Expo / React Native client (NativeWind, Jest).
- **`shared/`** — Code shared between `api` and `app`. See `shared/CLAUDE.md` for code style conventions.

## Local development

First-time setup:

1. `cp .env.example .env` — at the repo root. Docker Compose loads `.env` from the directory containing the compose file.
2. Edit `.env` and fill in the required values: `HA_URL` (your Home Assistant base URL) and `HA_TOKEN` (a long-lived access token from HA → Profile → Security → Long-Lived Access Tokens). Postgres / pgAdmin / port values have working defaults and only need to be set if you're overriding them.
3. From the repo root, bring the stack up: `docker compose up` (or `bun --cwd api run up` for the variant that includes pgAdmin via the `tools` profile).

`.env` is gitignored — never commit credentials.

## General Code Guidelines

- Strict typing throughout. Prefer `unknown` over `any`. Treat state as readonly/immutable where possible.
- Object property names are **lowerCamelCase** in TS, JSON, and config files alike — matches the existing Drizzle TS layer and `api/models.ts`. The only place snake_case is allowed is when a contract is owned by an external system (DB column names at the SQL level, third-party API request/response bodies, etc.).
- Single quotes for string literals. If a string contains an apostrophe, use backticks (`) instead of double quotes to avoid escaping.
- Dates as ISO-8601 UTC; align DTOs with server contracts. This codebase uses `dayjs` for date handling.
- Type-check after making changes — run the project's type-check script before declaring work complete.
- Log liberally via `console.log` / `console.warn` / `console.error` — external calls, state transitions, errors, scheduling decisions. The daemon runs unattended; logs are the only window into what it's doing.
- Every database table includes `created_at` and `updated_at` `timestamptz` columns (both default `now()`). Use Drizzle's `defaultNow()` for `created_at` and `$onUpdate(() => new Date())` for `updated_at` so the timestamps maintain themselves on insert and update. Applies to all schema migrations going forward.

Detailed frontend conventions (component structure, hooks, Tailwind/NativeWind) live in `shared/CLAUDE.md`.

## Testing

- **Every change to a code file requires matching test coverage** — new behavior gets new tests, modified behavior gets updated tests. A change isn't complete until the tests cover it.
- Tests are behavior-driven acceptance tests. Verify via observable behavior (return values, rendered output), not by inspecting internal state.
- For UI tests, query elements by visible text, placeholder, or label — never by test IDs.
- Don't mock first-party components when rendering them in tests. Mock at external boundaries (network, time, third-party SDKs).
- Place test files alongside the source they test, named `test.ts` or `test.tsx`.
- Run the project's test command after making changes.

Detailed React Native testing patterns (libraries, render helpers) live in `shared/CLAUDE.md`.

## Database

Postgres (container `irrigo_db`) is the data store; **Drizzle ORM** wraps it, **drizzle-kit** manages schema and migrations.

- Schema lives in `api/db/schema/` — one file per table plus a barrel `index.ts`.
- Migrations are written to `api/drizzle/` by `bun run db:generate` after schema changes — commit these.
- The runtime client is the typed `db` exported from `api/db/index.ts`. It reads `DATABASE_URL` from the environment; `api/docker-compose.yml` plumbs a default into the api container.
- A fresh environment runs `bun run db:migrate` (schema-only) and then `bun run seed` (API-6, JSON-driven).
- Inside Docker, run migrations with `docker compose run --rm api bun run db:migrate`. Migrations are applied via this explicit step — not on app startup — to keep startup deterministic for the single-instance deploy.

Available scripts (run from `api/`):

- `bun run db:generate` — generate a migration from the current schema diff
- `bun run db:migrate` — apply pending migrations
- `bun run db:push` — push the schema directly to the database (dev only; bypasses migrations)
- `bun run db:studio` — launch Drizzle Studio against `DATABASE_URL`

## Tickets

Tickets are tracked in **Plane**, in the `api` project (`API-XXX` keys). Categorization is via labels, not work-item types — every ticket gets exactly one of Epic / Feature / Bug.

Invoke the `/plane` skill before creating, searching, or updating tickets. Use `/write-ticket` to draft a new one.

**Don't create or update tickets unless explicitly asked**, except for state transitions tied to workflow actions (e.g., moving to `Done` after a PR merges).

## Git workflow

- **Main branch**: `main`
- **Branch naming**: `(feature|bug)/<short-description>` — e.g., `feature/weather-cache`, `bug/schedule-overlap`. Keep descriptions lowercase, hyphenated.
- **Commit messages**: short and direct. Include the `API-XXX` reference when the work is tied to a ticket (e.g., `API-12: Cache Open-Meteo responses for 1h`).
- **PR title**: short and descriptive. Prefix with `[API-XXX]` when there's a ticket.
- **PR body**: link the ticket if there is one. Brief summary of the change. No template required.
- After a PR for a ticket merges, update the ticket's state to `Done` via `mcp__plane__update_work_item`.

## Working in subprojects

- `shared/CLAUDE.md` — typing, components, comments, file structure, Tailwind/NativeWind.
