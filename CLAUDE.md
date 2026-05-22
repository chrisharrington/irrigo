# Irrigo

Irrigation control system. The repo contains:

- **`api/`** — Bun + TypeScript backend that generates irrigation schedules from weather data (Open-Meteo).
- **`app/`** — Expo / React Native client (NativeWind, Jest).
- **`shared/`** — Code shared between `api` and `app`. See `shared/CLAUDE.md` for code style conventions.

## Local development

First-time setup:

1. `cp .env.example .env` — at the repo root. Docker Compose loads `.env` from the directory containing the compose file.
2. Edit `.env` and fill in the required values: `HA_URL` (your Home Assistant base URL) and `HA_TOKEN` (a long-lived access token from HA → Profile → Security → Long-Lived Access Tokens). Postgres / pgAdmin / port values have working defaults and only need to be set if you're overriding them. To opt into push notifications via Home Assistant, set `HA_NOTIFY_SERVICE` (e.g. `mobile_app_pixel_8`); the `NOTIFY_ON_WATERING_START` / `NOTIFY_ON_WATERING_END` / `NOTIFY_ON_ERROR` flags toggle each event type (defaults: `false`/`false`/`true`).
3. From the repo root, bring the stack up: `docker compose up` (or `bun --cwd=./api run up` for the variant that includes pgAdmin via the `tools` profile).

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

## Shell commands

- Never prepend `cd /app` (or any other current-directory `cd`) to a command. The working directory is already `/app` — run the command directly. Prepending `cd` triggers a separate permission prompt for every invocation.
- For commands that need a different cwd, prefer the tool's `--cwd` flag over `cd && …`, and **use a relative path** (`./api`, not `/app/api`) so the permission matcher can pre-approve by prefix across worktrees. The canonical form for `bun` is **always** `bun --cwd=./<dir> <command>` with the equals sign and the leading `./` — e.g. `bun --cwd=./api test`, `bun --cwd=./api run type-check`, `bun --cwd=./app typecheck`. Do not write the space form (`bun --cwd ./api …`) or omit the `./` prefix. Same shape for `docker compose --project-directory=./api …`.
- `git` always operates on the current working tree — never prefix git commands with `cd`.
- **No compound commands.** Don't chain shell expressions with `&&`, `||`, or `;` — each Bash call should run exactly one logical command so the permission matcher can pre-approve it by prefix. Run multi-step verification (type-check + tests) as separate Bash calls. The only exception is `git commit -m "$(cat <<'EOF' … EOF)"` heredoc for multi-line messages — that's still one logical command.
- **No `| tail` / `| head` / `2>&1` redirection.** The Bash tool already captures stdout + stderr in full. Trimming output in the shell triggers a fresh permission prompt for every distinct compound; if a result is too long for context, truncate it when summarizing rather than in the pipe.

## Testing

- **Test commands differ per subproject:**
  - **`api/`** uses Bun's native test runner. Run with `bun --cwd=./api test` (or `bun --cwd=./api test <pattern>` to filter). Do NOT use `bun run test` — the `run` prefix is unnecessary.
  - **`app/`** uses `jest` via the `jest-expo` preset (React Native + Flow types require it; Bun's native runner cannot transpile RN's source today). Run with `bun --cwd=./app run test` (or `bun --cwd=./app run test <pattern>`). The `run` prefix is required here — `bun --cwd=./app test` would invoke Bun's runner and fail.
- **Every change to a code file requires matching test coverage** — new behavior gets new tests, modified behavior gets updated tests. A change isn't complete until the tests cover it.
- Tests are behavior-driven acceptance tests. Verify via observable behavior (return values, rendered output), not by inspecting internal state.
- For UI tests, query elements by visible text, placeholder, or label — never by test IDs.
- Don't mock first-party components when rendering them in tests. Mock at external boundaries (network, time, third-party SDKs).
- Place test files alongside the source they test, named `test.ts` or `test.tsx`.
- **Folder-per-tested-subject.** Anything that requires tests gets its own folder. The subject is `index.(ts|tsx)`; the test is `.test.(ts|tsx)` inside the same folder — e.g. `app/api/client/index.ts` pairs with `app/api/client/.test.ts`. Hook folder names drop the `use-` prefix (the export inside is still `useSystem`), so the hook lives at `app/hooks/system/index.ts` with `app/hooks/system/.test.tsx` next to it. Plain modules that have no tests (type declarations, trivial factory functions, passthrough providers) stay as flat files.
- Run the project's test command after making changes.

Detailed React Native testing patterns (libraries, render helpers) live in `shared/CLAUDE.md`.

## Database

Postgres (service `db` in `docker-compose.yml`) is the data store; **Drizzle ORM** wraps it, **drizzle-kit** manages schema and migrations.

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

## Security

The api container exposes manual zone-control endpoints (`POST /zones/:id/open`, `/close`, `/run`) with **no authentication** — they assume a trusted LAN. Bind the api port to LAN-only or run it behind a VPN. **Never expose the api container's port to the public internet.**

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

## Running a second stack from a git worktree

To work on two branches in parallel without tearing down and re-bringing up Docker, use git worktrees as sibling directories of the primary checkout:

```
/home/chrisharrington/docker/stacks/
├── irrigo/                # primary checkout (main)
├── irrigo-API-60/         # worktree for feature/API-60
└── irrigo-bug-foo/        # worktree for bug/foo
```

`docker-compose.yml` derives container, network, and per-stack volume names from `COMPOSE_PROJECT_NAME`, which defaults to the directory basename. Sibling worktrees get distinct project names (`irrigo`, `irrigo-API-60`, …) for free.

### One-time host setup

The `irrigo-gradle` and `irrigo-android` volumes are declared `external: true` so the Android toolchain cache and ADB pairing state are shared across all stacks. Create them once on the host before any stack boots:

```bash
docker volume create irrigo-gradle
docker volume create irrigo-android
```

### Spinning up a worktree

```bash
# from the primary checkout
git worktree add ../irrigo-API-60 feature/API-60
cp .env ../irrigo-API-60/.env
```

Then edit `../irrigo-API-60/.env` and bump the host ports so the two stacks don't collide. Suggested offsets:

| Stack                | `PORT` | `METRO_PORT` | `PGADMIN_PORT` |
|----------------------|--------|--------------|----------------|
| Primary (`irrigo/`)  | 9753   | 9097         | 9754           |
| Worktree #1          | 9853   | 9098         | 9854           |
| Worktree #2          | 9953   | 9099         | 9954           |

Bring the worktree's stack up from inside that directory:

```bash
docker compose --project-directory ../irrigo-API-60 up -d
```

`docker ps` should show the new stack's containers prefixed with `irrigo-api-60-` (Compose normalizes the project name to lowercase + hyphens) alongside the primary's `irrigo-` containers.

### Removing a worktree

```bash
docker compose --project-directory ../irrigo-API-60 down -v   # drops per-stack db-data
git worktree remove ../irrigo-API-60
```

The shared `irrigo-gradle` / `irrigo-android` volumes survive because they're external; only the per-stack `db-data` volume is removed by `down -v`.

## Working in subprojects

- `shared/CLAUDE.md` — typing, components, comments, file structure, Tailwind/NativeWind.
