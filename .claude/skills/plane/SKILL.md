---
name: plane
description: Guidelines for creating, searching, and managing Plane work items for the Irrigo project. Includes MCP tool usage, project IDs, label/state conventions, and ticket writing style.
---

# Plane Work Item Tracking

## Usage

```
/plane              # Full guide (MCP tools, creating/updating issues, style)
```

## Overview

Tickets for Irrigo are tracked in **Plane** via the Plane MCP integration. This skill covers how to use the Plane MCP tools and how to write good tickets.

When the user says "create a ticket" or "implement a ticket" without naming a project, default to the **`api`** project.

## Project

- **Workspace ID**: `49a78749-ffd0-40e0-a097-f7813b743e03`
- **`api` project ID**: `9ace774a-21ba-41a1-9b0e-ceac5e832f8b`
- **Project identifier (key)**: `API`
- **Sole member**: Chris Harrington (`chrisharrington99@gmail.com`)

**Verify cached IDs before relying on them.** Call `mcp__plane__list_projects` and `mcp__plane__list_labels` if anything looks off — IDs change if the project is recreated.

## States

| State | When to use |
|-------|-------------|
| **Backlog** (default) | Newly created, not yet scheduled |
| **Todo** | Scheduled to work on |
| **In Progress** | Actively being worked on |
| **Done** | Completed |
| **Cancelled** | Closed without completion |

Use `mcp__plane__list_states` to retrieve the current state IDs when you need to set state on creation/update.

## Categorization (Labels)

Plane's work-item-types REST endpoints return 404 on this build (Pro-tier-gated or unimplemented in self-hosted). The `is_issue_type_enabled` toggle on the project model is misleading — the API is still broken. **Labels are the working substitute** — every ticket should carry exactly one categorization label.

| Label | Color | ID |
|-------|-------|-----|
| Epic | `#8B5CF6` | `22048a56-b1ed-4357-ac5c-090b1c0b8cfb` |
| Feature | `#3B82F6` | `64e67b5c-0b3b-4ede-aa9b-c55130661b40` |
| Bug | `#EF4444` | `64dad2ee-7a97-435e-85a4-36c3080c6752` |
| Investigation | `#F59E0B` | `85692590-b4f5-4201-b0ee-5180bad16aeb` |

Verify with `mcp__plane__list_labels` before passing label IDs.

## Disabled Project Features

These are **disabled** on the `api` project — don't attempt to use them:

- Cycles
- Modules
- Intake
- Time tracking
- Issue types (use labels instead)

## Creating Work Items

Use `mcp__plane__create_work_item`:

```json
{
  "project_id": "9ace774a-21ba-41a1-9b0e-ceac5e832f8b",
  "name": "Brief, action-oriented title",
  "description_html": "<p>Description with <b>HTML</b> formatting.</p>",
  "label_ids": ["64e67b5c-0b3b-4ede-aa9b-c55130661b40"]
}
```

**Key points:**
- Plane stores rich text as HTML — use `description_html`.
- Always attach exactly one categorization label (Epic / Feature / Bug / Investigation).
- New tickets default to `Backlog` — fine for most cases. Only override if the user is about to start work immediately.
- Assignment isn't usually needed (sole workspace member).
- **Don't create or update tickets unless explicitly asked.**
- **After creation, always print the ticket URL**: `http://192.168.2.100:7123/irrigo/browse/API-<sequence_id>/` (uses the response's `sequence_id`).

## Listing / Searching

| Tool | When to use |
|------|-------------|
| `mcp__plane__list_work_items` | Broad listing with simple filters |
| `mcp__plane__search_work_items` | Keyword search across the workspace |
| `mcp__plane__retrieve_work_item_by_identifier` | When you have an `API-XXX` reference |
| `mcp__plane__retrieve_work_item` | When you have a UUID |

## Updating Work Items

`mcp__plane__update_work_item` — change name, description, state, or labels.

State transitions during workflow:
- Starting work → `In Progress`
- After PR merges → `Done`

## Comments

`mcp__plane__create_work_item_comment` — adds an HTML-formatted comment.

## Troubleshooting

- **`work-item-types` returns 404**: expected. Use labels instead.
- **`is_issue_type_enabled` shows `true`**: misleading — the API is broken on this build.
- **Stale label/project IDs**: verify with `mcp__plane__list_labels` and `mcp__plane__list_projects`.

---

# Ticket Writing Style Guide

Guidance for writing effective Plane tickets. Use when asked to create or draft tickets.

## Core Principle

Density over verbosity. Every sentence earns its place. Link to source material instead of paraphrasing it.

## Structure by Ticket Type

- **Simple bug/fix**: Source attribution → brief explanation → code pointer. Done.
- **Investigation**: Source attribution → bullet list of specific questions to answer.
- **Feature**: Brief context → numbered requirements/rules with clear if/then logic.
- **Config/infra change**: Source attribution → one sentence of context → the actual values/URLs/commands.
- **Epic**: One sentence of purpose + brief scope. Keep it minimal.

## Required Elements

### Attribution
Open with the source when relevant:
- "Caught while testing the schedule generator on 2026-05-01:"
- "Per design discussion:"
- "From the Open-Meteo docs:"

### Blockquotes for Original Reports
Preserve exact wording when quoting:
```
> Their exact message
```

### Developer Breadcrumbs
Help future-you find the relevant code:
- File paths: `api/schedules/generator.ts`
- Function/class names: `generateSchedule()`, `WeatherClient`
- Related ticket/PR refs: "See API-12 for prior art"
- Code snippets in fenced blocks when relevant

### Explicit Exceptions
Call out edge cases:
- "Only applies when manual override is off."
- "Note: this does not affect mock mode."

## Formatting

- **Headers are earned.** Simple tickets don't need `##` sections — scale structure with complexity.
- **Strikethrough for scope changes**: use ~~strikethrough~~ when intent changed, then explain the new direction.
- **Numbered repro steps for bugs**: include specific inputs and expected vs actual.
- **Numbered rules for requirements**: clear if/then; quote exact user-visible text in blockquotes.

## What to Avoid

- "As a user, I want..." boilerplate.
- Walls of background text when a link to the source suffices.
- Time estimates.
- Acceptance criteria checklists unless the ticket is genuinely complex.
- Padding to compensate for missing information — ask instead.

## When Information is Missing

If the spec is ambiguous or missing critical details, ask clarifying questions first. Do not invent details or pad with generic text.

## Creating the Ticket

Use `mcp__plane__create_work_item` against the `api` project with a single Epic / Feature / Bug / Investigation label. Plane expects HTML in `description_html` — convert any markdown structure (headings, lists, code blocks, blockquotes) to HTML before submitting.
