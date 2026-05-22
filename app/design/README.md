# Claude Design mocks

This directory holds the exported **Claude Design** bundle for Irrigo. Tickets in
the `irrigo_app` Plane project reference screens, components, and tokens from
this bundle, and committing it into source control lets implementation agents
read the source HTML, CSS, and JSX directly instead of working from secondhand
descriptions.

## Source

- **URL**: <https://api.anthropic.com/v1/design/h/oFrEqM0Q7DYY30MrAf33tA>
- **Last refreshed**: `2026-05-22`

## Layout

- `irrigo/` — the bundle, copied in verbatim. Treat the directory as a
  drop-in replace target: re-exports overwrite everything inside it.
- `irrigo/README.md` — author-supplied handoff notes. Read these first when
  consuming the mock — they explain what each subdirectory is for and how the
  design author intended the files to be used.
- `irrigo/project/colors_and_type.css` — design tokens (the basis for the
  NativeWind / Tailwind port).
- `irrigo/project/ui_kit/` — reference UI source (`Mobile.jsx`, `components.jsx`,
  HTML scaffolds).
- `irrigo/project/preview/` — one HTML card per atomic concept (colors, radii,
  spacing, type ramps, individual components).
- `irrigo/project/screenshots/` — exported PNGs for the hero / cycle / mobile
  views.

## Refresh recipe

Treat re-exports like regenerating types from a schema — refetch, replace, bump
the date, commit. From the repo root:

```bash
# Wipe the previous export and lay down the new one.
rm -rf app/design/irrigo
curl -sL 'https://api.anthropic.com/v1/design/h/oFrEqM0Q7DYY30MrAf33tA' \
  | tar -xz -C app/design/

# Update the "Last refreshed" date above to today's ISO-8601 date, then commit.
```

Don't edit files inside `irrigo/` by hand — any local changes get clobbered on
the next refresh. If you need to deviate from the mock, do it in the app code
and explain why in the relevant ticket.
