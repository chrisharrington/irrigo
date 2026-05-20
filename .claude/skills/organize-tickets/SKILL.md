---
name: organize-tickets
description: Scan all Backlog tickets in the `irrigo_api` and `irrigo_app` Plane projects and move any that are immediately workable into Todo. Primary criterion is the absence of open blocker relations; secondary criteria flag low-quality tickets that should stay in Backlog.
---

# Organize Tickets

Sweep the Backlog in **both** `irrigo_api` and `irrigo_app` and promote ready-to-work tickets into Todo. **No confirmation prompts** — apply the moves once the analysis is complete and report what changed.

Scope:
- `irrigo_api` (project ID `9ace774a-21ba-41a1-9b0e-ceac5e832f8b`, key `API`)
- `irrigo_app` (project ID `3d3f88af-b113-4586-a7c5-b3a40dc8bde7`, key `APP`)

If the user explicitly names one project (e.g. "organize the app backlog"), scope to that one only. Refer to the `/plane` skill for project IDs, label IDs, and MCP tool patterns.

Run steps 1–4 **once per project in scope** — the state and label UUIDs differ between projects, so don't reuse them across the loop. State IDs **can** be re-resolved in Step 1 once per project; label IDs only matter for the Epic-skip check in secondary checks.

## Step 1: Resolve state IDs (per project)

For each project, call `mcp__plane__list_states` with that project's UUID and capture:
- The `Backlog` state UUID (group `backlog`)
- The `Todo` state UUID (group `unstarted`)
- Any state with group `completed` or `cancelled` — used later to decide whether a blocker is still open

Match on `group` rather than `name`. State names can be customized; groups are stable.

## Step 2: List Backlog tickets (per project)

For each project, call `mcp__plane__list_work_items` with:
- `project_id`: that project's UUID
- `state`: that project's Backlog state UUID from Step 1

Paginate through all results. For each ticket, capture: `id`, `sequence_id`, `name`, `description_html` (or stripped text), `label_ids`, and which project it belongs to (so the final report can group cleanly).

If the response doesn't include relations or comments inline, plan to fetch those per-ticket in Step 3.

## Step 3: Evaluate each ticket

For every Backlog ticket, run the checks below in order. **Stop at the first failing check** — record the reason and move on.

### Primary check: open blockers

1. Call `mcp__plane__list_work_item_relations` for the ticket.
2. Filter to relations where this ticket is **blocked by** another (relation type indicates `blocked_by` / `blocked` — verify the field name from the response shape on first run).
3. For each blocker, fetch its current state. If the blocker's state group is **not** `completed` or `cancelled`, the ticket fails this check.

If the ticket has no `blocked_by` relations or all of them resolve to completed/cancelled states, the ticket passes the primary check.

### Secondary checks (lower priority — flag, don't hard-fail unless obvious)

These are weaker signals. Apply them only after the primary check passes. If a secondary check fails, leave the ticket in Backlog and note the reason.

- **No categorization label.** The ticket carries none of the Epic / Feature / Bug / Investigation label IDs for its project (see `/plane` for both projects' IDs — they differ). Skip.
- **Epic label.** Epics are containers, not directly workable. Skip. (Use the Epic label ID that matches the ticket's project.)
- **Stub description.** `description_html` is empty, or its plaintext is shorter than ~80 characters and lacks any structure (no list, no code, no link). Skip.
- **Open question in comments.** Optionally call `mcp__plane__list_work_item_comments` and skim for unresolved questions (a comment ending in `?` from the project owner that has no follow-up). Cheap heuristic — don't over-invest. Skip on a clear hit.

A ticket that passes the primary check **and** all secondary checks is **promotable**.

## Step 4: Move promotable tickets to Todo

For each promotable ticket, call `mcp__plane__update_work_item` with:
- `project_id`: the project UUID matching that ticket
- `work_item_id`: the ticket UUID
- `state`: the Todo state UUID from Step 1 for **that ticket's project**

Run the updates sequentially. If one fails, log the error and continue with the rest — don't abort the batch.

## Step 5: Report

Print a concise summary, grouped by project so the two backlogs read separately:

```
irrigo_api
  Promoted to Todo:
    - API-12 — <ticket name>
    - API-19 — <ticket name>
  Kept in Backlog:
    - API-7  — blocked by API-3 (still In Progress)
    - API-15 — no categorization label

irrigo_app
  Promoted to Todo:
    - APP-26 — <ticket name>
  Kept in Backlog:
    - APP-13 — blocked by APP-10 (still Backlog)
    - APP-22 — stub description

Total: N promoted, M kept.
```

Omit a project section entirely if it had no Backlog tickets in scope. Always include each kept ticket's reason. Use ticket URLs (`http://192.168.2.100:7123/irrigo/browse/<KEY-XXX>/`) only if the user asks — the summary above is the default.

## Guidelines

- **No user confirmation.** The user has authorized the skill to move tickets without prompting per move.
- **Read-heavy, then a small write batch.** Most of the work is fetching state; the actual updates are a handful of API calls at the end.
- **Don't create or modify tickets** beyond the state transition. No comments, no label changes, no edits to descriptions.
- **Verify state and label IDs on first run.** IDs change if the project is recreated; if a call fails with a not-found error, re-fetch via `mcp__plane__list_states` / `mcp__plane__list_labels`.
- **Be conservative on secondary checks.** When in doubt about a stub description or an open comment, leave the ticket in Backlog. Promoting noise is worse than missing a clean ticket — the user runs this regularly.
