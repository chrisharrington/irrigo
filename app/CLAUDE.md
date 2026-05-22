# Irrigo App

Expo / React Native client for Irrigo — **Expo SDK 54, React Native 0.81, NativeWind, Jest**. Single-screen-at-a-time operator UI for the homeowner; talks to the `irrigo_api` backend.

Shared conventions (typing, shell rules, ticket workflow, git workflow) live in the root `CLAUDE.md`. Detailed frontend conventions (component structure, hooks, comments, NativeWind organization, testing patterns) live in `shared/CLAUDE.md`. This file holds client-only guidance and the scripts table.

## Expo has changed

Read the exact versioned docs at <https://docs.expo.dev/versions/v54.0.0/> before writing any code that touches Expo APIs.

## Scripts

Always invoke via `bun --cwd=./app run <script>`. Never the bare `bun --cwd=./app <script>` form — see the root `CLAUDE.md` "Running package.json scripts" section. In particular, **`bun --cwd=./app test` is broken** for this project: it triggers Bun's native test runner, which can't parse React Native's flow type syntax and dies on the first import of `react-native`. Use `bun --cwd=./app run test` so Bun dispatches to the `test` script and Jest takes over.

| Script | Purpose |
|---|---|
| `start` | `expo start` — launch Metro and the Expo dev tools. |
| `android` | `expo run:android` — build & run on a connected Android device/emulator. |
| `ios` | `expo run:ios` — build & run on an iOS simulator. |
| `web` | `expo start --web` — run the app in the browser. |
| `test` | `jest` — run the test suite. Use `run test`, not bare `test`. |
| `test:watch` | `jest --watch`. |
| `typecheck` | `tsc --noEmit`. Run before declaring work complete. |
| `lint` | `expo lint`. |
| `reset-project` | Reset the Expo project scaffolding (rarely used). |

If a common operation needs an entry, add a script to `app/package.json` rather than running it ad-hoc — the allow-list entry `Bash(bun --cwd=./app run *)` picks new scripts up automatically.
