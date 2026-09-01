---
name: handing-off
description: >
  Prepare a session for compaction: write the handoff, mark it fresh,
  propose /compact focus lines. Use before a manual /compact, when a
  reminder or hook warns that compaction is near, or when asked to wrap
  up or hand off session context.
---

# Handing Off

Compaction keeps a summary the model writes under pressure. The handoff
is the part chosen deliberately: what is open, why, and what continues.

## Steps

1. **Collect open state** from the session itself, never by
   re-derivation: unmerged changes and what gates them, open tickets
   touched, rulings and standing rules the principal stated, gotchas
   that cost time. Order items as a work ledger orders threads —
   urgency, then importance, a blocker before what waits on it — with
   low-hanging fruit carrying the most value for the work ahead
   surfaced early. Where the `thread-ledger` skill's tooling is
   available, render its view as a mechanically generated second
   opinion — never the primary source, so work not yet recorded there
   is not overlooked. Completion: every item carries a next action.
2. **Write the handoff** to a file: what happened since the previous
   handoff; an open-state table (item | state | next); standing rules;
   gotchas. Link the previous handoff. Table rows are single-line and
   stand in step 1's priority order — verify.sh lifts them verbatim
   into the post-compaction context, so the table IS the priority
   list and the extractor stays dumb. Completion: a reader with none
   of this session's context can pick any table row and continue it.
3. **Publish** the file wherever the installing project keeps session
   artifacts, and update the tickets and progress records the session
   touched. Completion: the handoff has a URL.
4. **Mark freshness**: run `./mark.sh <handoff-file> [url]`. It records
   the live transcript's current size into `$HANDOFF_STATE` (default
   `~/.claude/handoff-state.json`) so hooks can tell a fresh handoff
   from a stale one. Completion: mark.sh prints the marker path.
5. **Propose focus**: from what continues next, print one to three
   candidate `/compact <focus line>` commands, first one recommended,
   **each in its own fenced code block** — nothing inside a fence but
   the command itself, so one gesture copies it whole. Running
   `/compact` stays the user's step — end the run on the proposals.
6. Run `./check.sh` — machine-verifies the marker, the handoff file,
   and that the skill's hooks are registered (installing the
   registration where nothing else manages `settings.json`), then
   prints the residue to verify by hand. Relay any warning it prints
   about registration timing: registration is captured at CLI
   startup, so a fresh install protects the next session, not the
   compaction this handoff prepares.

The skill ships its own compaction hooks: `verify.sh` runs on
`SessionStart` (matcher `compact`) and injects the handoff pointer
plus the open-state table verbatim into the fresh context, with the
instruction to restate it; `guard.sh` runs on `PreCompact` and blocks
compaction (exit 2) while no fresh marker exists — growth-based
freshness, `PRECOMPACT_GUARD=off` overrides. The installing project
contributes only registration: where a manager owns `settings.json`
(a `managedBy` marker), its template must carry the two entries and
`check.sh` prints exactly what to add; everywhere else `check.sh`
installs them itself. `HANDOFF_STATE` and `HANDOFF_TRANSCRIPT`
(transcript path override; unset = newest transcript under
`~/.claude/projects`) remain the data contract all three scripts
share.
