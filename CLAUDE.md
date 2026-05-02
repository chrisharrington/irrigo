# Irrigo

Irrigation control system. The repo contains:

- **`api/`** — Bun + TypeScript backend that generates irrigation schedules from weather data (Open-Meteo).
- **`app/`** — Expo / React Native client (NativeWind, Jest).
- **`shared/`** — Code shared between `api` and `app`. See `shared/CLAUDE.md` for code style conventions.

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
