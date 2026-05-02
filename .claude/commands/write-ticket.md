---
description: Draft and create a Plane ticket in the Irrigo `api` project
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

1. **Pick the categorization label**: Epic, Feature, or Bug. Pick exactly one.
2. **Confirm with the user** if any of the following are unclear:
   - Which categorization label applies
   - Whether this is a sub-piece of an existing ticket (link it instead of duplicating)
   - Critical details missing from their description (don't pad — ask)

## Creating

Convert the drafted markdown to HTML, then call `mcp__plane__create_work_item`:

```json
{
  "project_id": "9ace774a-21ba-41a1-9b0e-ceac5e832f8b",
  "name": "<title>",
  "description_html": "<...>",
  "label_ids": ["<one of Epic/Feature/Bug ID from the skill>"]
}
```

After creation, report the resulting `API-XXX` identifier back to the user.
