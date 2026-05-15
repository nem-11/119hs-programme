# 119HS — Cursor Fix List

**Version:** v1.1
**Companion to:** `SOURCE_OF_TRUTH.md` (v1.1)
**Purpose:** Discrete, copy-pasteable briefs for Cursor. One brief per session. Commit and push after each.

**Changes from v1.0:** A1 rewritten as A1 v2 to target actual audit findings (completions string-keys, legacy INSERT OR IGNORE). New B0 added at top of Section B (dependencies). B1/B2 updated to reference dependencies as prerequisite. Look-only principle preserved from v1.0.

---

## How to use this file

1. **At the start of every Cursor session**, paste this opening message:

   > *Before we start: read `docs/SOURCE_OF_TRUTH.md` and acknowledge the non-negotiable rules in section 4 and the flow in section 3.6. Every change in this session must satisfy those rules. If anything I ask conflicts with the doc, flag it before doing the work.*

2. **Then paste ONE brief from this file.** Not two. Not five. One.

3. **Before committing**, open the diff in GitHub Desktop. Read it. If Cursor went beyond what the brief asked for, reject and re-prompt. If it matches, commit with the suggested message and push.

4. **Then test the fix manually.** Don't trust automated success messages — open the app and verify the bug is gone.

5. **Only then move to the next brief.**

This rhythm is slow. That's the point. A clean 30-minute fix beats a 5-minute fix that breaks two other things.

---

## Working principle: look-only changes must not affect function

When a brief is about appearance (layout, styling, typography, spacing, colour, component arrangement), the brief should explicitly say "do not change function — presentation only." Cursor should be able to revert the change and end up with identical behaviour. If a look change *requires* a function change to work, Cursor must stop and flag it before proceeding.

This keeps the visual layer and the logic layer cleanly separated so future redesigns (Figma-driven or otherwise) don't accidentally break behaviour.

Look-only briefs in this file: A5 (legend shrink), A8 (header unification). Add this discipline to every future visual brief.

---

## Order of operations — non-negotiable

**Section A (Fixes) must be completed before Section B (Builds) is started.**

Within Section A: A1 v2 first (foundations), then A2–A8 in numerical order.

Within Section B: B0 first (dependencies — prerequisite for B1 and B2), then B1 (baseline), then B2 (closed-loop), then B3–B5.

This order is dictated by the doc, not by preference:
- §9 (closed-loop) explicitly says it will not be built until the data layer is clean, dependencies are implemented, and baseline is implemented.
- §4.12 (programme respects dependencies) requires the dependency model to exist before any feature that operates over it.

---

# SECTION A — FIXES

---

## A1 v2. FOUNDATIONS — Clean the data layer (audit-informed)

**Priority:** Highest. Do this first. Everything else depends on it.

**Background (from A1 audit, see `docs/A1_AUDIT_REPORT.md`):** The actual data layer bugs differ from the v1.0 theory. There are no orphan-activity rows of the kind originally hypothesised, because `activities` is a global catalogue with no `zone_id`. The real bugs are:

1. **`completions` table is keyed by string** of the form `tower|zone|activity`, not by foreign key. When a zone is deleted, completion records survive as text. When a zone with the same tower+name is recreated, the old completion strings re-match — this is the structural cause of phantom ticks on POUR 4 and POUR 6.
2. **`db.deleteZone` does not delete from `completions`.** It deletes `programme_items`, shrinks `schedule`, deletes `zone_activities`, deletes `zones`. The `completions` table is untouched.
3. **`db.applyTemplate` (legacy) uses `INSERT OR IGNORE`** — when rebuilding a zone, existing rows in the `schedule` table silently survive and new rows are skipped. This is the cause of "missing decking on POUR 7" after rebuild.
4. **There is no `clashes` table** — clashes are computed client-side in `client/src/PlanPage.js`. The "phantom clash banner" was reading from stale in-memory state, not orphan database rows.
5. **Two template-apply paths exist** — `POST /api/zones/:zoneId/schedule-from-target` (modern, used by current UI) and `POST /api/templates/apply` (legacy). The legacy path is the one with `INSERT OR IGNORE`. We need to determine whether anything still calls the legacy path; if not, retire it.

**Acceptance criteria:**

- After this brief: deleting a zone deletes all related rows in `programme_items`, `zone_activities`, `schedule` (shrunk per item), `zones`, AND all matching rows in `completions` whose parsed key references that zone's tower + name.
- Re-creating a zone with the same tower + name as a previously-deleted zone shows NO inherited ticks. Verified manually.
- The legacy `applyTemplate` either (a) is retired and removed if no caller exists, or (b) is rewritten to DELETE matching rows from `schedule` before inserting (no more `INSERT OR IGNORE`). Cursor must report which path is taken and why.
- A new admin endpoint `POST /api/admin/reset-programme` exists that wipes all `programme_items`, `zone_activities`, `completions`, and `schedule` rows in a single transaction, while preserving `zones`, `activities` (catalogue), templates, drawings, and milestones. Requires admin role and a typed-confirmation field in the request body (e.g. `{ "confirmation": "RESET PROGRAMME" }`).
- A server-side integrity check runs at app start: counts orphan completions (completions whose parsed zone reference doesn't match any current zone). Logs a warning if any are found. Does not auto-delete them.

**Rules from doc this satisfies:** §4.1 (deletes complete), §4.2 (templates deterministic), §4.3 (ticks user-only), §4.6 (one-directional flow). Schema realities are documented in §13.

**Cursor prompt:**

> Read `docs/SOURCE_OF_TRUTH.md` (especially §3.8, §4.1, §4.2, §4.3, §13) and `docs/A1_AUDIT_REPORT.md` before starting. Confirm in your first response that you have read both and understand the schema realities in §13.
>
> Goal: fix the data layer so that deleting a zone and recreating it with the same name does not produce phantom ticks; rebuilding a zone via template-apply produces the full correct sequence with no orphan rows.
>
> Do these in order:
>
> **Step 1 — Search for callers of the legacy `applyTemplate` path.** Run a grep across the codebase for `POST /api/templates/apply`, `/api/templates/apply`, and any frontend calls. Report back which files reference it and whether the current UI uses this path or the modern `scheduleFromTargetDate` path. Wait for my decision on whether to retire it or fix it before proceeding to Step 4.
>
> **Step 2 — Extend `db.deleteZone` in `server/db.js`** to also remove matching rows from the `completions` table. The completions table is keyed by a string of form `tower|zone|activity` (see `parseCompletionKeyParts` for the parser). Before deleting the zone, look up its `tower` and `name`, then `DELETE FROM completions WHERE key LIKE ?` with the appropriate pattern, or use the parser to filter precisely. Use a transaction so the whole delete is atomic. Add a comment in code referencing rule §4.1 of the source-of-truth doc.
>
> **Step 3 — Add server-side startup integrity check.** On app start, run a query that counts completions whose parsed zone reference does not match any current zone. Log a warning to console with the count. Do not auto-delete. This is the safety net for future regressions.
>
> **Step 4 — Conditional on Step 1.** If the legacy `applyTemplate` is still in use, rewrite it to first `DELETE FROM schedule WHERE tab=? AND tower=? AND zone_name=?` before inserting, and remove the `INSERT OR IGNORE` in favour of plain `INSERT`. If it is not in use, remove the route, the function, and any related code paths entirely.
>
> **Step 5 — Add admin reset endpoint.** Create `POST /api/admin/reset-programme` that requires admin role and a typed confirmation in the request body. On valid request, wipe all rows from `programme_items`, `zone_activities`, `completions`, and `schedule` in a single transaction. Do NOT delete from `activities`, `zones`, templates, drawings, or milestones. Return a summary of how many rows were removed from each table.
>
> **Step 6 — Add a corresponding admin UI button** (somewhere reasonable in admin settings) that calls this endpoint. Require the user to type "RESET PROGRAMME" into a text box before the Reset button enables. After reset, show the row counts that were cleared.
>
> Constraints:
> - Do not invent or migrate columns. The schema realities in §13 are accurate; work within them.
> - Do not modify `activities`, `zones`, templates, drawings, or milestones tables.
> - Use transactions for all multi-table operations.
> - Add a brief comment near each change citing the doc rule it satisfies (§4.1, §4.2, etc.).
> - If anything in this brief becomes impossible without a wider refactor, stop and explain before making the refactor.
>
> After all steps, report back: which files changed, what was removed, what was added, and any decisions made (especially around the legacy `applyTemplate` path).

**Commit message:** `A1 v2: completions cascade on zone delete, retire/fix legacy applyTemplate, admin reset endpoint`

**After this commit, manually verify:**
- Create a zone (T2 POUR 6), tick a few activities, delete the zone. Recreate T2 POUR 6 with same name. Old ticks must NOT appear.
- Delete and rebuild POUR 7 via template-apply. All template activities must be present including decking.
- Use the admin reset endpoint. Confirm zones/activities/templates remain; programme_items/completions/schedule are empty.

---

## A2. PLAN/GRID — Verify phantom clash banner is gone

**Priority:** High. Depends on A1 v2.

**Background:** The phantom clash banner ("T2 POUR-5 and T2 POUR 4 both have Insulation on Tue 28 Apr") was reading from stale in-memory state via `detectClash` in `client/src/PlanPage.js`. After A1 v2 cleans completions and stops the legacy applyTemplate leaking rows, the clash detector should naturally stop seeing phantom matches. This brief is to verify and tighten if needed.

**Acceptance criteria:**
- After rebuilding zones cleanly (post-A1 v2 and a programme reset), no phantom clash banners appear.
- Clash banner only fires when two activities of the same name actually fall on the same date in two currently-existing zones.

**Cursor prompt:**

> Read `docs/SOURCE_OF_TRUTH.md` §4.5 and §13 first.
>
> After A1 v2 has run and you have manually rebuilt a clean test programme (or used a fresh reset state), check that `detectClash` in `client/src/PlanPage.js` no longer fires false positives.
>
> 1. Trace what input rows `detectClash` is fed. Confirm those rows are sourced from the API endpoint that returns programme rows for the current view window only, not from any stale client-side cache.
> 2. If `detectClash` is still firing false positives, identify why. Likely candidates: rows are being fetched for too wide a date range and aged-out rows are being included; or rows include items from deleted zones that the API hasn't cleaned up.
> 3. Make the minimum change needed to fix any residual issue. If no residual issue exists, write a one-line confirmation in `docs/A2_VERIFICATION.md` and stop.

**Commit message:** `Plan: verify/tighten clash detection post-A1`

---

## A3. PLAN/GRID — Verify decking restoration on POUR 7

**Priority:** High. Likely already fixed by A1 v2's `applyTemplate` fix.

**Cursor prompt:**

> After A1 v2 is committed and tested:
>
> 1. In the app, delete T2 POUR 7 (if present) and re-apply the standard pour template.
> 2. Confirm that ALL expected activities appear, including decking on the expected date.
> 3. If decking is still missing, the issue is in the template-apply date arithmetic in `scheduleFromTargetDate` (not in the legacy `applyTemplate`). In that case, trace the date arithmetic and weekend/bank-holiday skipping logic.
>
> If everything works, write a one-line confirmation in `docs/A3_VERIFICATION.md` and stop.

**Commit message:** `Plan: verify template-apply produces complete sequence post-A1`

---

## A4. PLAN/PRINT — Fix the A3 print regression

**Priority:** High. Moment-of-perfection breaker (§6).

**Cursor prompt:**

> The A3 print of the Plan / Drawing page was working a few days ago and is now broken.
>
> 1. Run `git log --oneline --since="5 days ago"` and identify any commits that touched print CSS, the Plan page component, the drawing component, or print media queries.
> 2. For each candidate commit, run `git show <hash>` and identify which changes could have affected A3 print rendering.
> 3. Compare current print output (use browser print preview) to what it should look like — title block in corner, drawing in main area, legend small and out of the way, dates clean at the top.
> 4. Fix the regression without reverting unrelated changes. If you must revert a commit wholesale, ask first.
>
> Refer to `docs/SOURCE_OF_TRUTH.md` §2 (printable plan is half the spine) and §6 (moment of perfection).

**Commit message:** `Print: restore A3 layout regression`

---

## A5. PLAN/PRINT — Shrink the "Activities on this day" legend (LOOK-ONLY)

**Priority:** Medium. Same area as A4, do them together if possible.

**This is a look-only brief — function must not change.**

**Cursor prompt:**

> Look-only change. Do not change any function or data flow. Cursor must be able to revert this commit and end up with identical behaviour.
>
> On the Plan / Drawing / Print Day view, the "Activities on this day" legend is too large and overlays the site drawing. Reduce its footprint:
>
> 1. Reduce its width and font size so it occupies no more than ~10% of the visible drawing area.
> 2. Use compact colour swatches with abbreviated labels.
> 3. On print, position the legend inside the title block area or the margin — never overlapping the drawing.
>
> If anything you'd need to change touches data or logic (not just CSS / layout), stop and flag it.
>
> Refer to `docs/SOURCE_OF_TRUTH.md` §2 (Figma/Scripter quality bar).

**Commit message:** `Print: compact legend, no drawing overlap (look-only)`

---

## A6. DELETE THE GANTT PAGE

**Priority:** Low-medium. Pure cleanup.

**Cursor prompt:**

> Delete the Gantt page entirely:
>
> 1. Remove the Gantt route from the router.
> 2. Remove the Gantt link from the navigation / tabs.
> 3. Delete the Gantt page component file(s) and any Gantt-specific helper modules.
> 4. Remove any imports that referenced Gantt elsewhere in the app.
> 5. Run the app to confirm nothing breaks.
>
> Refer to `docs/SOURCE_OF_TRUTH.md` §4.10 (a new page must do something no existing page can do).

**Commit message:** `Remove Gantt page (functionality subsumed by Plan range controls)`

---

## A7. PROJECT PROGRAMME — Restore the XML upload (REGRESSION)

**Cursor prompt:**

> The Project Programme tab previously supported XML upload but the feature has regressed.
>
> 1. Search git history for commits that originally implemented this feature (search for `xml`, `project programme`, `upload`, `parse` in commit messages and code).
> 2. Identify when and how it was removed or broken.
> 3. Restore the upload UI on the Project Programme tab: file picker, parse, preview, confirm-and-import.
> 4. Restore the backend XML parser. It should extract activity name and duration at minimum.
> 5. Imported activities populate the Project Programme tab as programme rows (no zone link required by default).
>
> If the original implementation can't be found in git history, ask before building from scratch.
>
> Refer to `docs/SOURCE_OF_TRUTH.md` §10 (Project Programme tab).

**Commit message:** `Project Programme: restore XML upload`

---

## A8. CROSS-CUTTING — Unify the page header pattern (LOOK-ONLY)

**Priority:** Medium. Defer until A1–A7 are done.

**This is a look-only brief — function must not change.**

**Cursor prompt:**

> Look-only change. Do not change any page logic or data flow.
>
> Create a single shared page header component used on every page (Plan, Update, Look-ahead, Dashboard, Template editor, Zone drawing, Project Programme).
>
> Structure:
> 1. Page title (large)
> 2. Sub-description (one line, grey, descriptive)
> 3. View toggles (e.g. Grid / Drawing / Print on the Plan page) — primary actions
> 4. Scope / range / tower filters — secondary controls
> 5. Action buttons (Print, Export, Refresh) — placed top-right
>
> Apply this component to every page. Where a page doesn't need a control, hide it gracefully. Do not change page logic — only the header presentation.
>
> If a Figma artboard is provided, follow it exactly. Otherwise propose a layout and wait for approval before applying to every page.
>
> Refer to `docs/SOURCE_OF_TRUTH.md` §4.11.

**Commit message:** `Header: unified page header component (look-only)`

---

# SECTION B — BUILDS (do not start until Section A is complete)

These are new features identified during the walkthrough. They are deferred until the foundations are clean.

---

## B0. DEPENDENCIES — Implement the dependency model (NEW IN v1.1)

**Priority:** First in Section B. Prerequisite for B1 (baseline) and B2 (closed-loop). See `docs/SOURCE_OF_TRUTH.md` §3.8 and §4.12.

**Scope:**

- New `dependencies` table in SQLite:
  - `id` (primary key)
  - `predecessor_type` (`'zone_activity'` | `'project_programme_line'`) — what kind of thing the predecessor is
  - `predecessor_id` (the id of the predecessor in its source table)
  - `successor_type` (same enum)
  - `successor_id`
  - `relationship_type` (default `'FS'` for finish-to-start; reserved for future types)
  - `created_by` (admin user id)
  - `created_at`
  - Unique index on (predecessor_type, predecessor_id, successor_type, successor_id)
- Backend endpoints:
  - `GET /api/dependencies?activity_id=X&type=Y` — return all dependencies where X is predecessor or successor
  - `POST /api/dependencies` (admin only) — create
  - `DELETE /api/dependencies/:id` (admin only)
- `db.deleteZone` extended: when a zone is deleted, also delete all dependencies where any of that zone's activities are predecessor or successor (rule §4.1).
- Frontend:
  - In the Plan page (admin view), allow admin to right-click or long-press an activity and add/remove a predecessor or successor.
  - Visual indicator on activities that have any dependency (small icon).
  - When viewing an activity (modal or popover), show its declared predecessors and successors as clickable links.
- Enforcement on Live programme drag/edit:
  - When admin drags an activity to an earlier date, check if any predecessor's end date is later than the new proposed start date. If so, prevent the move and show a clear message: "Cannot move: predecessor [X] ends on [date]."
  - When admin extends an activity's duration past a successor's start, show a warning but allow it (admin override).

**Brief to be written after A1 v2 ships and the schema realities are stable.**

---

## B1. Baseline programme model

Implement the three-state programme model from `docs/SOURCE_OF_TRUTH.md` §3.5:

- Baseline (locked, never moves — rule §4.7)
- Live (admin-write-only — rule §4.8)
- Reported (site team proposals)

Database schema additions: `baseline_programme_items` table mirroring `programme_items` at programme-create time. Read-only after creation. Variance reporting (days ahead / behind / unchanged per activity).

**Depends on B0** — variance reporting and delay propagation operate over the dependency graph.

Brief to be written when B0 ships.

---

## B2. Closed-loop Update view

Implement the active intelligence behaviour from `docs/SOURCE_OF_TRUTH.md` §9.

**Depends on B0 (dependencies) and B1 (baseline).** Pull-forward and delay propagation walk the dependency graph; end-date impact is measured against baseline.

Brief to be written when B1 ships.

---

## B3. Project Programme — zone linking

After A7 is done (XML upload restored), add the ability to link a project programme line to a zone.

UI: line-level action to "Link to zone" with a picker.
Data: nullable foreign key from project_programme_line → zone.

---

## B4. Project Programme — milestone tagging

Per `docs/SOURCE_OF_TRUTH.md` §4.9 (milestones come from the programme).

Add ability to tag any project programme line as a milestone. Dashboard reads milestone tags directly. Current separate milestones entity is deprecated.

---

## B5. Dashboard improvement — fallback if B4 too complex

**Deferred but DO NOT FORGET** (flagged by Nem in v1.0).

If milestone-tagging proves too complex, fall back to improving the dashboard's milestones list as a separate feature. Revisit B4 later.

---

# Walkthrough still pending

These pages were not covered yet. Walkthrough fixes get added to Section A in future revisions:

- Update view (the most important page — §9)
- Look-ahead
- Zone drawing
- Template editor
- Dashboard (read-only, but still needs verifying)
- Login

When you walk through them, we add any new fixes here.

---

# Tonight's recommended next action

1. **Save this fix list to the repo** at `docs/FIX_LIST.md`. Commit and push.
2. **Save the doc v1.1 to the repo** at `docs/SOURCE_OF_TRUTH.md`. Commit and push.
3. **Open a fresh Cursor session.** Paste the opening message from "How to use this file." Paste brief **A1 v2**.
4. **Review the diff carefully.** Especially the legacy `applyTemplate` decision (Step 1 of A1 v2 pauses for your input).
5. **Test in the app:** create a zone, tick, delete, recreate with same name, confirm no phantom ticks.
6. **Commit and push.** Then move to A2 (verification).

One brief per session. Don't rush. The slow rhythm is the whole point.
