# Irrigo

Irrigation control system. The repo contains:

- **`api/`** — Bun + TypeScript backend that generates irrigation schedules from weather data (Open-Meteo).
- **`app/`** — Expo / React Native client (NativeWind, Jest).
- **`shared/`** — Code shared between `api` and `app`. See `shared/CLAUDE.md` for code style conventions.

## General Code Guidelines

- Strict typing throughout. Prefer `unknown` over `any`. Treat state as readonly/immutable where possible.
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
