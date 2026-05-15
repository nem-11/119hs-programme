# 119HS — Source of Truth

**Status:** v1.1
**Audience:** Nem + Claude. Private. Paste at the start of every Cursor session.
**Purpose:** Stop the app drifting. Every feature, fix, and design decision is judged against this doc.

**Changes from v1.0:** Added dependencies as first-class data (§3.8, §4.12). Updated §9 (closed-loop) to operate over the dependency graph. Added §13 on what's actually in the codebase (schema realities surfaced by the A1 audit).

---

## 1. What 119HS is

119HS is the live programme management app for the 119 High Street residential development. It replaces the previous Figma + Scripter workflow.

It serves three audiences, in this order of priority when their needs conflict:

1. **The site team** — site manager, engineers, subbies. Daily users. Mobile-first.
2. **Nem (sole admin)** — sets up the programme, applies templates, manages zones, authorises changes.
3. **The board / wider team** — periodic viewers. Need a clear, printable visual.

When the three pull in different directions, the site team wins. If the site team stops trusting or using the app, the board has nothing to look at.

---

## 2. The input/output spine

The app earns its keep on two views, and these are non-negotiable in quality:

- **Input — the Update view (mobile, daily).** Where ticks go in. The daily heartbeat of the app. Must work one-handed on a phone.
- **Output — the Plan / printable weekly grid.** Where the programme comes out. **The bar is Figma/Scripter quality.** If it doesn't print as well as the Figma version did, it's not finished.

Every other view (dashboard, look-ahead, template editor, zone drawing, project programme) is supporting infrastructure. They exist to make the input/output spine work.

---

## 3. Mental model vs. data model

The user's mental model (top-down):

> **Programme → Zone → Activity → Template**

The system's data model (what the code must keep clean):

> **Activity is the atomic unit.** Everything else is a grouping (zones), a producer (templates), a roll-up (programme, milestones, sequences), or a relationship (dependencies).

Activities carry the ticks, the dates, the clashes, and the progress. They are not throwaways. **Every data integrity bug we've seen — phantom ticks, ghost clashes, missing decking — has been an activity-level bug.** Code that treats activities loosely will break the app.

---

## 3.5 Three programme states

The user works with three programme states simultaneously:

- **Baseline** — the original plan, locked at programme creation. Never moves. The reference against which all progress and delay is measured.
- **Live** — the current working programme. May shift on admin authorisation in response to reported delays or pull-forwards. The "what we're working to today" view.
- **Reported** — site team taps and delay reports. Proposed changes that admin reviews and accepts into the Live programme.

**Baseline is sacred. Live moves only on admin authorisation. Reported is the inbox.**

---

## 3.6 The core flow

Every feature and bug lives somewhere on this pipeline. If a feature isn't on it, ask whether it should exist.

1. **Drawing uploaded** — site plan PNG or PDF becomes the visual base layer.
2. **Zones drawn** — admin draws rectangles on the drawing, each linked to a tower + pour/area name (e.g. T2 POUR 5).
3. **Templates attached** — pre-built activity sequences (with durations) are applied to zones with a start date.
4. **Programme generated** — applying templates produces dated activities. This becomes the Baseline (locked) and the initial Live programme.
5. **Dependencies declared (optional, per-activity)** — admin draws dependency links between activities where they exist. Some activities have dependencies; many don't.
6. **Programme displayed and updated** — the Plan grid shows the Live programme; the Update view lets the site team tick activities off and report delays; the dashboard reads the result.

The pipeline is one-directional. Display reads from the programme. The programme is produced by template-on-zone. Zones live on the drawing. Dependencies sit between activities. **Anything that breaks this direction is a bug.**

---

## 3.7 The role of each page

- **Drawing** — visual base layer; uploaded once per project.
- **Zone drawing** — admin draws zones on the drawing (flow step 2).
- **Template editor** — admin defines repeatable sequences with durations (input to flow step 3).
- **Plan / Grid page** — **the anomaly handler.** Where the admin nudges individual activities to match site reality without editing the underlying template. The template sets the intent; the Plan page handles deviation. Dependencies are surfaced here and respected by drag operations.
- **Update view** — **the live feedback loop.** Where the site team records what actually happened. The most important page in the app. (See §9.)
- **Look-ahead** — read-only view of upcoming work (interaction model TBD).
- **Project Programme tab** — higher-level whole-project view; XML upload, milestone tagging, optional zone linking, dependencies. (See §10.)
- **Dashboard** — read-only mirror of programme health. Holds no state of its own.
- **Print/Export** — the output artefact. Bar is Figma/Scripter quality.

---

## 3.8 Dependencies (new in v1.1)

**Dependencies are first-class data, not metadata.** They are admin-drawn relationships between activities that constrain when activities can start and how shifts propagate.

**Core properties:**

- **Optional** — most activities don't have dependencies. That's fine. Activities without predecessors move freely.
- **Admin-only** — only admins create, edit, or remove dependencies. Site users see and respect them, never modify them.
- **Any-to-any** — dependencies can link activities within a zone (Decking → Insulation within POUR 5), between zones (T2 podium pour → T3 work), or across programmes (project programme line → zone activity). No artificial boundaries based on where the activities live.
- **Finish-to-start at v1** — "B cannot start until A finishes." Other dependency types (start-to-start, finish-to-finish, with lag/lead) are out of scope for v1 but the data model is designed to extend to them later.

**What dependencies do:**

- **Constrain the Live programme.** An activity with an incomplete predecessor cannot have its start date moved earlier than the predecessor's completion. The Plan page (anomaly handler) enforces this on drag/edit.
- **Drive pull-forward.** When a predecessor is ticked complete ahead of schedule, the system surfaces (for admin review) the option to pull dependent activities forward.
- **Drive delay propagation.** When an activity is reported as delayed, the system identifies downstream activities (via dependency chain) that must shift, calculates end-date impact, and surfaces this to admin for authorisation.
- **Visualise.** The app must show, for any activity: what does this depend on, and what depends on this. Dependencies that are invisible become bugs the user can't trace.

**What dependencies do NOT do:**

- **Auto-shift the Live programme.** No cascade happens without admin authorisation (rule §4.8). The system *proposes* the cascade; admin disposes.
- **Block site-team ticks.** A site user can always tick an activity complete — dependencies don't prevent reporting reality. They constrain *planning*, not *reporting*.
- **Move the baseline** (rule §4.7). Dependencies operate on Live, never on Baseline.

This is the model that makes the closed-loop feature in §9 actually work. Without dependencies, pull-forward and delay propagation have nothing to operate over.

---

## 4. Non-negotiable rules

These are the principles every feature, fix, and refactor is checked against. If a change can't satisfy all of them, it doesn't ship.

1. **Deletes are complete.** Deleting a zone deletes all its activities, progress, clash records, and dependencies — both inbound (where this zone's activities are predecessors) and outbound (where they are successors). No orphans, ever.
2. **Templates are deterministic.** Applying a template to a zone produces identical results every time, regardless of prior state. No leftover data.
3. **Ticks are user-only.** Progress changes only when a user taps. Never inferred, never migrated, never re-applied from old state.
4. **The Update view works one-handed on a phone.** Thumb-reachable, no hover states, no tiny tap targets.
5. **Views are one connected programme.** A change in one view is reflected in the others without manual refresh. The tabs are windows onto one programme, not separate apps.
6. **The flow is one-directional.** Drawing → Zone → Template → Programme → Display. Display layers (Plan grid, dashboard, look-ahead) never hold their own state.
7. **The baseline never moves.** Once the programme is created, the baseline is locked. The Live programme may shift on admin authorisation; the baseline does not.
8. **The Live programme is admin-write-only.** Site users report reality (ticks, delays). Admin authorises changes. No structural edit cascades from a non-admin tap.
9. **Milestones come from the programme, not a separate list.** A line tagged as a milestone is the source; the dashboard reads it. No parallel milestone entity to maintain.
10. **A new page must do something no existing page can do.** If it's a variant of existing data, it's a toggle on an existing page — not a new page.
11. **Page headers are designed once and applied uniformly.** The top of every page follows the same pattern. Cross-cutting design decisions are made centrally.
12. **The programme respects dependencies.** Where a dependency exists, the Live programme honours it: an activity with an incomplete predecessor cannot have its start date moved earlier than the predecessor's completion. Dependencies are admin-drawn, optional, and any-to-any.

---

## 5. Out of scope for 119HS

These belong in ProgramIQ or The Hub later. If a request touches one of these, log it and move on.

- Multi-project / multi-site support
- MS Project / Primavera / Asta live sync (export is enough)
- Cost or commercial data
- Dependency types other than finish-to-start (start-to-start, finish-to-finish, lag/lead) — out of scope for v1, in scope for later
- Anything that doesn't strengthen the input/output spine

**Explicitly in scope** (often mistaken for out-of-scope because they're ambitious): the closed-loop programme (§9), the baseline model (§3.5), the Project Programme XML upload (§10), the dependency model (§3.8). 119HS is the first place these live.

---

## 6. The moment of perfection

> A printable weekly plan that matches the Figma/Scripter quality, generated from data the site team ticked off on their phones during the week — against a baseline that never moved, with any delays authorised through admin, dependencies honoured throughout.

That's the test. When that moment works reliably, the app is doing its job.

---

## 7. How to use this doc

- **At the start of every Cursor session:** paste this doc in. It sets the lens.
- **When evaluating any new feature:** check it against §4, §5, and the flow in §3.6. If it strengthens the spine in §2, build it. If not, defer it.
- **When fixing a bug:** name the rule from §4 it violates. If it doesn't violate any, ask whether the rule list is missing something.
- **When in doubt about scope:** §5 is the answer. ProgramIQ comes later.

---

## 8. Page header pattern (TBD — see issue log)

The top of every page should follow a single pattern: title, sub-description, primary controls (scope, range, towers), action buttons (print, export, refresh). The pattern is not yet designed. Candidate for a single Figma artboard that defines it once, then applied across all pages.

This is the cross-cutting design lever. Done well, it makes the app feel like one product. Done poorly (current state), every page feels like it was built by a different person.

---

## 9. The defining feature: closed-loop programme

The Update view is not a tick-off list. It is the active intelligence of the programme.

**Intended behaviour:**

- **Ahead of schedule** — when a user ticks an activity early, the system walks the dependency graph: dependent activities (those declared in §3.8) become candidates for pull-forward. Admin reviews and authorises. Activities without declared dependencies do not pull forward — they simply have an earlier-than-expected completion recorded.
- **On schedule** — silent. Tick, move on.
- **Behind schedule** — when an activity that should be done today is *not* ticked, the app surfaces it as a risk and prompts the user with structured questions:
  - "Are you reporting a delay?"
  - "Can this be caught up tomorrow?"
  - "Is this a blocker for downstream work?"
- **Delay reported** — recorded against the activity. Goes into the admin inbox for authorisation. Does not move the Live programme until admin accepts.
- **Delay authorised** — admin moves Live programme accordingly. The dependency graph is walked: all downstream activities (declared dependents) have their dates shifted. Baseline does not move. End date impact is calculated and surfaced loudly.
- **End date is sacred** — every delay is measured against the end date. If a delay would push the end date, this is the loudest signal in the app.

**Why this matters:** most construction programme tools are passive — they show a plan, you tick things off, the plan stays static until manually edited. This is active — the plan responds to reality, while protecting the baseline and respecting declared dependencies. This is the feature that distinguishes 119HS from a digital Figma/Scripter. It is also the core IP of ProgramIQ.

**Build order:** this is the destination, not the next step. It will not be built until (a) the data layer is clean (A1), (b) the dependency model is implemented (B0), (c) the baseline model is implemented (B1), (d) the Plan page anomaly handling is stable, and (e) the Update view is reliable on its own. Building this on broken or incomplete foundations would be worse than not building it at all.

---

## 10. The Project Programme tab

The higher-level whole-project view, distinct from Groundworks and Internals.

- **Input**: admin uploads an XML (or similar) file. The app builds the programme automatically from activity name + duration. No double-handling.
- **Structure**: not tied to a drawing by default — project-level activities often have no spatial component.
- **Linkable**: any line can optionally be linked to a zone, for cross-reference between project view and operational views.
- **Milestones**: any line can be tagged as a milestone. The dashboard reads milestones directly from these tags (rule §4.9).
- **Dependencies**: any project programme line can participate in the dependency graph (§3.8) — both as a predecessor (e.g. "substructure complete" → enables superstructure work in zones) and as a successor of zone activities.

This feature was previously built and has regressed. Restoring it is in scope.

---

## 11. The roles model

- **Admin (Nem)** — full access. Sole authoriser of changes to the Live programme. Sole editor of templates, zones, baseline, dependencies, and project programme structure.
- **Site team (site, GW subbie, INT subbie)** — Update-view-first. Can tick activities, report delays, propose changes. Cannot edit the Live programme structurally. Cannot create or modify dependencies.
- **Board** — read-only. Dashboard and printable views.

The rule: **site users propose, admin disposes.**

---

## 12. What this doc does NOT contain

This doc is principles, scope, and architecture. It does not contain:

- The current bug list (lives in the running issue log)
- The fix priority order (lives in the prioritised fix list, produced after the walkthrough)
- Pricing, commercial, or ProgramIQ strategy (lives in the brainstorm doc)
- Technical implementation details (lives in code)

Keeping these separate is what stops this doc bloating into a project plan and losing its job as a lens.

---

## 13. Schema realities (added v1.1 from A1 audit)

The A1 read-only audit surfaced several things about the current codebase that this doc needs to acknowledge, so we don't repeatedly mis-target fixes:

- **The `activities` table is a global catalogue**, not zone-linked. It has `id`, `name`, `type` — no `zone_id`.
- **Zone-to-activity linkage** is in **`zone_activities`** (`zone_id`, `activity_id`).
- **Dated programme rows** live in **`programme_items`** (`zone_id`, `activity_id`, dates, status).
- **Completion ticks** are in **`completions`**, keyed by a string of the form `tower|zone|activity` — **not** by foreign key to activities or programme_items. This is the structural cause of phantom ticks: deleting a zone leaves these string-keyed completions intact, and recreating a zone with the same name causes them to reappear against the new zone.
- **Clashes are not persisted.** Computed client-side in `client/src/PlanPage.js` via `detectClash`.
- **Two template-apply paths exist**: `POST /api/zones/:zoneId/schedule-from-target` (modern, uses `scheduleFromTargetDate`) and `POST /api/templates/apply` (legacy, uses `applyTemplate` with `INSERT OR IGNORE` — the cause of missing decking on rebuilt zones).
- **No `dependencies` table exists.** This is what B0 will add.
- **Database paths**: local default is `data/119hs.db` under `cwd`; Render deployment uses `/opt/render/project/src/server/public/uploads/119hs.db`; override via `DATABASE_PATH` env var.

This section is documentation of current state, not a list of things to keep. The completions string-key design and the legacy `applyTemplate` path are problems A1 v2 fixes. The absence of a dependencies table is fixed by B0.
