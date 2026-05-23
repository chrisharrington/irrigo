# Irrigo

Irrigation control system. The repo contains:

- **`api/`** — Bun + TypeScript backend that generates irrigation schedules from weather data (Open-Meteo). See `api/CLAUDE.md` for backend-specific conventions.
- **`app/`** — Expo / React Native client (NativeWind, Jest). See `app/CLAUDE.md` for client-specific conventions.
- **`shared/`** — Code shared between `api` and `app`. See `shared/CLAUDE.md` for code style conventions.

## Local development

First-time setup:

1. `cp .env.example .env` — at the repo root. Docker Compose loads `.env` from the directory containing the compose file.
2. Edit `.env` and fill in the required values: `HA_URL` (your Home Assistant base URL) and `HA_TOKEN` (a long-lived access token from HA → Profile → Security → Long-Lived Access Tokens). Postgres / pgAdmin / port values have working defaults and only need to be set if you're overriding them. To opt into push notifications via Home Assistant, set `HA_NOTIFY_SERVICE` (e.g. `mobile_app_pixel_8`); the `NOTIFY_ON_WATERING_START` / `NOTIFY_ON_WATERING_END` / `NOTIFY_ON_ERROR` flags toggle each event type (defaults: `false`/`false`/`true`).
3. From the repo root, bring the stack up: `docker compose up` (or `bun --cwd=./api run up` for the variant that includes pgAdmin via the `tools` profile).

`.env` is gitignored — never commit credentials.

## General Code Guidelines

- Strict typing throughout. Prefer `unknown` over `any`. Treat state as readonly/immutable where possible.
- Object property names are **lowerCamelCase** in TS, JSON, and config files alike. The only place snake_case is allowed is when a contract is owned by an external system (DB column names at the SQL level, third-party API request/response bodies, etc.).
- Single quotes for string literals. If a string contains an apostrophe, use backticks (`) instead of double quotes to avoid escaping.
- Dates as ISO-8601 UTC; align DTOs with server contracts. This codebase uses `dayjs` for date handling.
- Type-check after making changes — run the project's type-check script before declaring work complete.
- Log liberally via `console.log` / `console.warn` / `console.error` for external calls, state transitions, errors, and significant decisions.
- **Imports**: use the `@/` path alias for any import that would otherwise cross two or more parent boundaries (i.e. `'../../foo'` or deeper). Both `api/tsconfig.json` and `app/tsconfig.json` map `@/*` to the subproject root. Single-parent (`'../foo'`) and sibling (`'./foo'`, `'.'`) imports stay relative — single-step relatives are still readable. Order imports as: external packages → `@/`-rooted imports → sibling relatives.

## Shell commands

- Never prepend `cd /app` (or any other current-directory `cd`) to a command. The working directory is already `/app` — run the command directly. Prepending `cd` triggers a separate permission prompt for every invocation.
- For commands that need a different cwd, prefer the tool's `--cwd` flag over `cd && …`, and **use a relative path** (`./api`, not `/app/api`) so the permission matcher can pre-approve by prefix across worktrees. The canonical form for `bun` is **always** `bun --cwd=./<dir> run <command>` with the equals sign and the leading `./` — e.g. `bun --cwd=./api run test`, `bun --cwd=./api run type-check`, `bun --cwd=./app run typecheck`. Do not write the space form (`bun --cwd ./api …`) or omit the `./` prefix. Same shape for `docker compose --project-directory=./api …`.
- `git` always operates on the current working tree — never prefix git commands with `cd`.
- **No compound commands.** Don't chain shell expressions with `&&`, `||`, or `;` — each Bash call should run exactly one logical command so the permission matcher can pre-approve it by prefix. Run multi-step verification (type-check + tests) as separate Bash calls. The only exception is `git commit -m "$(cat <<'EOF' … EOF)"` heredoc for multi-line messages — that's still one logical command.
- **No `| tail` / `| head` / `2>&1` redirection.** The Bash tool already captures stdout + stderr in full. Trimming output in the shell triggers a fresh permission prompt for every distinct compound; if a result is too long for context, truncate it when summarizing rather than in the pipe.

## Running package.json scripts

- **Always invoke package.json scripts as `bun --cwd=./<dir> run <script>`** — never the bare `bun --cwd=./<dir> <script>` form. The bare form invokes Bun's own subcommands (e.g. `bun test` runs Bun's native test runner, not the `test` script), which silently does the wrong thing in `app/` where Jest is required to parse React Native flow syntax.
- If a one-off command isn't already a script, **add it to the relevant `package.json` first** and then call it via `run`. Don't sprinkle ad-hoc `bun <command>` invocations across the codebase — each fresh shape triggers a permission prompt and erodes the allow-list discipline.
- The corresponding allow-list entries in `.claude/settings.json` are `Bash(bun --cwd=./api run *)` and `Bash(bun --cwd=./app run *)`. Any new script you add is covered automatically; you don't have to touch `settings.json`.
- Subproject-specific script tables live in `api/CLAUDE.md` and `app/CLAUDE.md`.

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

## Tickets

Tickets are tracked in **Plane**, across two projects:

- `irrigo_api` (`API-XXX` keys) — backend work.
- `irrigo_app` (`APP-XXX` keys) — client work.

Categorization is via labels, not work-item types — every ticket gets exactly one of Epic / Feature / Bug.

Invoke the `/plane` skill before creating, searching, or updating tickets. Use `/write-ticket` to draft a new one.

**Don't create or update tickets unless explicitly asked**, except for state transitions tied to workflow actions (e.g., moving to `Done` after a PR merges).

## Git workflow

- **Main branch**: `main`
- **Branch naming**: `(feature|bug)/<short-description>` — e.g., `feature/weather-cache`, `bug/schedule-overlap`. Keep descriptions lowercase, hyphenated. When tied to a ticket, the convention is `feature/<KEY-XXX>` or `bug/<KEY-XXX>` (e.g. `feature/API-12`, `bug/APP-15`).
- **Commit messages**: short and direct. Include the ticket reference (`API-XXX` or `APP-XXX`) when the work is tied to a ticket (e.g., `API-12: Cache Open-Meteo responses for 1h`, `APP-15: Add depletion battery primitive`).
- **PR title**: short and descriptive. Prefix with `[API-XXX]` or `[APP-XXX]` when there's a ticket.
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

- `api/CLAUDE.md` — backend conventions: Postgres / Drizzle, security, daemon-specific logging, available scripts.
- `app/CLAUDE.md` — client conventions: Expo versioned-docs reminder, available scripts.
- `shared/CLAUDE.md` — typing, components, comments, file structure, Tailwind/NativeWind.
