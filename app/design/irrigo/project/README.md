# Irrigo — Design System

A black/green design system for **Irrigo**, a single-site residential lawn irrigation system. The system is built to support a quiet utility app the homeowner opens once a day or less, mostly while standing in the yard or scrolling at the kitchen table.

The product was designed from a one-page brief — there is no upstream codebase, Figma, or brand history. Every visual decision here is grounded in the brief's tone words: *quiet utility*, *at-a-glance*, *errors are loud, otherwise invisible*, *sunrise/sunset are the dominant temporal frame*.

## Index

| File | What it is |
|---|---|
| `colors_and_type.css` | All design tokens — fonts, raw + semantic colors, type scale, spacing, radii, shadows, motion. Import this in every page. |
| `components.css` | Form controls, badges, cards, modal/sheet, depletion battery. Plain CSS classes. |
| `preview/` | One small HTML card per atomic concept. Drives the Design System tab. |
| `ui_kit/` | Reference UI: a mobile app (Home + Zone + Schedule). Demonstrates the system composed. |
| `assets/logo.svg` | The brand glyph + wordmark. |
| `SKILL.md` | Skill manifest so this design system is reusable as an Agent Skill. |

Start at `ui_kit/index.html` to see the system composed; browse `preview/*.html` for the atomic cards.

## Visual foundations

**Mode.** Dark is primary. There is no light mode — the operator checks the app at night, and high-contrast outdoor reading at noon is fine on dark too. If a light mode is ever needed, invert `--bg ↔ --fg` and re-derive surface ramp; do not auto-flip via `prefers-color-scheme`.

**Color philosophy.** Black with a green undertone. The canvas (`#06090A`) is not pure neutral — its blue-green tint helps the lawn-fresh primary (`#6FE39B`) feel like it's growing out of the surface rather than pasted on. The accent **glows**: any time we use primary as a fill or border, we add a soft outer drop-shadow tinted with the same green so the eye locks onto it. Glow is reserved for the active state, the next-fire hero, and progress fills — never for decoration.

**Depletion ramp.** The most product-specific color decision: the soil-moisture battery shifts through `green → amber → red` as depletion approaches RAW. Past RAW it's danger-red. This is the answer to the brief's prompt "show *why* irrigation is happening tonight" — the color is the why.

**Typography.**
- **Display** — *Bricolage Grotesque*. Has subtle optical-size shifts that keep it elegant at 56px and still readable at 18px. Used for hero values, zone names, page titles.
- **Body / UI** — *Geist*. Modern neutral grotesque, excellent at small sizes, has tnum support.
- **Mono / numerics** — *Geist Mono*. Used for every moisture mm, runtime, cycle count, time, and date. Numerics never break, never wrap, and always align in a column. This is essential when 0.4 mm is the difference between firing and waiting.

**Spacing.** Strict 4px grid. Card padding 16/20; section gap 24; page padding 20 on mobile.

**Radii.** Every corner is 4px. The system is intentionally sharp — `--r-1` through `--r-5` and `--r-pill` all resolve to the same value. The tokens are kept around so site-wide softening (or sharpening to 0px) is a single-line change.

**Elevation.** Dark-mode shadows are mostly *inner highlights* (a 1px top-edge `rgba(255,255,255,0.04)` inset) plus a modest outer ambient. Only the accent gets the glow recipe — a `0 0 24px var(--grass-glow)` plus a thin colored inset ring. Drop-shadow-only elevation reads as cheap in dark mode; the inset highlight reads as solid.

**Motion.** 120ms for state changes, 220ms for layout shifts, 360ms for the battery filling/draining. Easing is `cubic-bezier(.2,.7,.2,1)` — accelerate-out, settle-in. No bounces.

**Borders.** 1px solid `--border` is the default rule. Tables and list-row separators use `--hairline` (slightly dimmer). Focus rings on inputs are a 4px green wash plus a green border — no blue browser default.

**Hover / press.** Hover lightens by one surface step (`--surface → --surface-2`). Press shifts the primary background `--accent → --accent-deep` and nudges the element down by 0.5px. There is no opacity-on-hover anywhere — opacity changes feel weak on dark.

**Transparency / blur.** Scrim is `rgba(2,4,3,0.66)` with 8px backdrop-blur. The mobile tab bar uses `rgba(14,20,18,0.84)` + 20px blur so the content below floats slightly. Anywhere else, prefer solid surfaces.

**Imagery.** None, intentionally. The product is data, not lifestyle photography. The only "imagery" is the lawn-patch glyph used per zone — a small SVG outline + grass-blade strokes. Each zone gets one of three shape variants for tactile recognition.

## Content fundamentals

**Voice.** Calm and factual. Verbs ("Run now", "Re-plan", "Switch"). The product knows what time it is, what the soil is doing, and what it intends to do — it says so plainly and shuts up.

**Casing.** Sentence case for headings and buttons. UPPERCASE only for the tracked eyebrow label (the small `eyebrow` token). Zone names are proper nouns: *North*, *South*, *East* (never *north zone*).

**Numbers.** Always with units. mm, min, cyc, m², °C. One decimal for depletion. Times in 12h with am/pm, dates as `Mon DD` or ISO when filing rows. The mono face makes columns of numbers line up cleanly.

**Tone words to use.** *Queued. Approaching. Firing. Idle. Skipped — rain. Past RAW. Within tolerance.* Status nouns, never apologetic verbs. Never *Uh oh*, *Oops*, *Something went wrong*.

**Errors.** Loud, terse, actionable when possible. *"HA call failed — North relay didn't close. Last attempt 02:14 · 3 retries · zone disabled until acknowledged."* Tell the operator the failure mode, the time, and the consequence. Skip apology copy.

**Emoji.** None. The lawn-patch SVG is the only "icon flourish" allowed.

## Iconography

There is no proprietary icon set. The UI uses a small hand-built set of 1.4-stroke Lucide-style icons defined inline as JSX in `ui_kit/components.jsx` under the `Icon` map (`drop`, `chevR`, `chevL`, `refresh`, `bell`, `play`, `zone`, `cal`, `history`, `home`, `more`). If you need an icon that isn't there, lift it from [Lucide](https://lucide.dev) — matched stroke weight (1.4–1.6) and `currentColor` fill — and add it to that map.

The brand glyph is custom (sprinkler arc + droplet + soil ellipse). It is the only piece of vector identity in the system.

## Caveats & substitutions

- **Fonts** are loaded from Google Fonts (`Bricolage Grotesque`, `Geist`, `Geist Mono`). All three are open-licensed; no local font files required.
- **No real photography or marketing surface** — this is an operator app, so there are no hero images, lifestyle shots, or onboarding visuals to design.
- **Light mode is not designed.** The system is dark-only by intent.
- **Calgary / America/Edmonton** is hardcoded in the demo data; in a real build this should come from the site config.

## Quick start

```html
<link rel="stylesheet" href="colors_and_type.css">
<link rel="stylesheet" href="components.css">
<button class="btn btn-primary">Run now</button>
<div class="batt" data-tone="warn" style="--pct: 86%; --raw: 80%;">
  <div class="fill"></div><div class="notch"></div>
</div>
```
