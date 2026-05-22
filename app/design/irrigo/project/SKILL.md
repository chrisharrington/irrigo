---
name: irrigo-design
description: Use this skill to generate well-branded interfaces and assets for Irrigo (residential lawn-irrigation operator app), either for production or throwaway prototypes/mocks. Contains design tokens, type, color, form controls, the depletion-battery domain primitive, and a mobile UI kit.
user-invocable: true
---

Read `README.md` first. The full system lives in `colors_and_type.css` (tokens) and `components.css` (form controls + cards + modal + battery). Domain components and the reference mobile app are in `ui_kit/`.

When creating visual artifacts (slides, mocks, throwaway prototypes), copy `colors_and_type.css` and `components.css` into the output and link them; copy `ui_kit/components.jsx` if you need the depletion battery, cycle strip, lawn patch, or alert row.

When working on production code, treat `colors_and_type.css` as the source of truth for tokens and lift values into your CSS-in-JS / NativeWind config. The hex codes and font stacks in that file are authoritative.

If invoked without other guidance, ask what to build, gather a few constraints (which of the five core screens — Home, Zone detail, Schedule, Forecast, Activity), and produce HTML artifacts that compose the existing primitives.
