# api

To install dependencies:

```bash
bun install
```

To run:

```bash
bun run index.ts
```

This project was created using `bun init` in bun v1.2.21. [Bun](https://bun.com) is a fast all-in-one JavaScript runtime.

## Safety: HA-side dead-man automation

The api process reconciles cycle and relay state at every startup (see `api/daemon/reconcile.ts`). That covers the case where the daemon comes back. It does **not** cover the case where the daemon stays down — host offline, DB unreachable, container crash-looping, or a network partition between Irrigo and Home Assistant. In any of those scenarios, a relay that was on at the moment of the failure stays on indefinitely, with hours of unintended watering as the worst-case outcome.

To guard against that, configure a Home Assistant automation, **independent of Irrigo**, that force-closes any managed switch that has been on for longer than the longest legitimate cycle. Suggested shape:

- **Trigger**: managed entity in state `on` for longer than `N` minutes — pick a value comfortably above the longest legitimate cycle (60 minutes is a safe default).
- **Action**: `switch.turn_off` on the offending entity, plus a notification so the operator sees the safety net fire.
- **Mode**: `single` per entity — don't pile up if the relay refuses to close.
- **Scope**: one automation per managed zone, **or** a single automation iterating the configured entity list — both are acceptable.

The automation lives entirely in Home Assistant and is not committed to this repo. Confirm it is configured for every managed zone before running unattended; this is the last line of defense against a stuck-on valve.
