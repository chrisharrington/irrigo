---
description: Draft and create a Plane ticket in the Irrigo `irrigo_api` or `irrigo_app` project
model: sonnet
effortLevel: medium
---

# Write Plane Ticket

First, invoke the `plane` skill to load the foundational MCP and ticket-writing guidance.

Then draft the ticket based on the user's description, applying the style guide from the skill:

- Density over verbosity — every sentence earns its place.
- Open with attribution when there's a source (Slack, design discussion, doc, repro session).
- Include developer breadcrumbs (file paths, function names, related ticket refs).
- Headers are earned — simple tickets don't need `##` sections.
- Quote exact user-visible text in blockquotes.

## Before creating

1. **Pick the target project**: `irrigo_api` (backend) or `irrigo_app` (mobile / web client). Infer from the user's description — backend / planner / database / HA work → `irrigo_api`; screens / components / Expo / NativeWind → `irrigo_app`. If ambiguous, **ask** before drafting.
2. **Pick the categorization label**: Epic, Feature, Bug, or Investigation. Pick exactly one — from the matching project's label set (the two projects have different label UUIDs; see the `/plane` skill).
3. **Confirm with the user** if any of the following are unclear:
   - Which project the ticket belongs to
   - Which categorization label applies
   - Whether this is a sub-piece of an existing ticket (link it instead of duplicating)
   - Critical details missing from their description (don't pad — ask)

## Creating

Convert the drafted markdown to HTML, then call `mcp__plane__create_work_item` with the `project_id` and `label_ids` from the matching project:

```json
// irrigo_api example
{
  "project_id": "9ace774a-21ba-41a1-9b0e-ceac5e832f8b",
  "name": "<title>",
  "description_html": "<...>",
  "label_ids": ["<Epic/Feature/Bug/Investigation ID from irrigo_api>"]
}

// irrigo_app example
{
  "project_id": "3d3f88af-b113-4586-a7c5-b3a40dc8bde7",
  "name": "<title>",
  "description_html": "<...>",
  "label_ids": ["<Epic/Feature/Bug/Investigation ID from irrigo_app>"]
}
```

After creation, report the resulting `<KEY-XXX>` identifier (`API-XXX` or `APP-XXX`) back to the user along with the URL `http://192.168.2.100:7123/irrigo/browse/<KEY-XXX>/`.
