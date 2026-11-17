---
name: handing-off
description: >
  Prepare a session for compaction: list the work that needs the current
  context, then write, publish and mark the handoff and propose /compact.
  Use before a manual /compact, when a reminder or hook warns that
  compaction is near, or when asked to wrap up or hand off session
  context.
---

# Handing Off

The handoff records what is open, why, and what continues.
It takes two runs.
Run 1 finds the work that needs the current context, proposes it and stops.
You and the principal do that work.
Run 2 confirms from the draft that the work is settled, then completes the handoff.

## Start

Run `./start.sh` on every invocation.
It prints `starts:` with the section to follow, and `draft:` with the path of the handoff draft, the handoff file before you publish it.
When the session has no local state, it restores the pushed state first and says so.
When it exits 3, the store did not answer: report its line and end the turn.
Run 1 starts a new draft.
start.sh sets an earlier one aside as `.previous.md`, and the new handoff links it as the previous handoff.

- `run 1`: follow Run 1.
- `run 2`: follow Run 2 from step 1.
- `run 2 at step 5`: follow Run 2 from step 5.
- `the /compact proposal again`: repeat Run 2 step 9.

## Run 1

1. Answer two questions about the session.
   Which work must be finished while the current context is still available?
   Which information exists only in the current context, and where should it be persisted?
2. Run `./ledger.sh view`.
   It prints the thread ledger's view, or one line saying the run skips its ledger step.
   Relay that line.
   Add the view's open threads to your answers from step 1.
3. Write the answers into the draft as the finish-first list (format below).
   List only work that needs the current context.
   Work the next context can do goes into the open-state table in run 2.
4. Run `./phase.sh listed`.
   It records the phase, drops the marker of any earlier cycle, and pushes the draft and the state.
   Relay its line when no store took them.
5. Report the list as proposals.
   Ask the principal which principal items are done, and whether they have open items the list lacks.
   End the turn: no marker, no `/compact` proposal.

## Run 2

1. Ask yourself the two questions of run 1 again, for the stretch since run 1.
   Add the new items to the list, together with the items the principal named.
   Tick a principal item only when the principal says it is done.
2. Run `./list.sh <draft>`.
   It decides whether the list is settled.
   Your own statement that the work is done does not count.
3. When the list is not settled, run `./phase.sh listed`, report the open items and end the turn.
4. When the list is settled, collect the open state and write it into the draft (open state, below).
   Run `./ledger.sh events <draft>`, then `./phase.sh written`.
5. Ask yourself the sweep question:
   "Please check thoroughly and find out which information is only in the current context.
   Where should it be persisted, in tickets or docs or elsewhere?"
   Persist each finding, and record it under the heading `## Persisted` in the draft: the finding and a link to where it went.
   When the sweep finds nothing, the Persisted list holds the single item `- none`.
6. Run `./scan.sh <draft>`.
   On a hit, scan.sh names the store variable or blocklist entry that matched.
   Remove its value from the draft and rerun.
   Publish nothing until it passes.
7. Publish the draft wherever the installing project keeps session artifacts, and comment on the tickets and progress records the session touched.
   In a session-memory store, record the handoff by its path in the store, never by a URL of the store.
8. Run `./mark.sh <draft> [published-location]`.
   When it warns that it took the newest transcript, check that the transcript it names holds this session's latest messages.
   If it is another session's, delete the state file whose path mark.sh printed, set `HANDOFF_TRANSCRIPT` to this session's transcript and rerun mark.sh.
   Then run `./check.sh`.
   It verifies the marker, the list, the Persisted list and the hook registration.
   On a pass, it scans what it will push, then sets the phase `complete` and pushes the state.
   Relay any warning check.sh prints about registration timing.
9. From what continues next, print one to three candidate `/compact <focus line>` commands, the first one recommended.
   Put each in its own fenced code block, with nothing else in it.
   End the turn on the proposals.
   Running `/compact` stays the principal's step.

## Writes that wait

Make these writes without asking: comments, ledger events, additions to the handoff, files in the session-memory store, new tickets.
Every other write waits for the principal.
Edits to a ticket body and changes to a repository file are the common cases.
A write that waits goes on the finish-first list as an unticked principal item.
Then run `./phase.sh listed`, report it and end the turn: publish nothing, write no marker, propose no `/compact`.

## Finish-first list

Write the list as a checkbox list under the heading `## Finish first`, not a table: verify.sh lifts the first table with Item and Next columns.
Each item is a checkbox item and names its owner, `model` or `principal`.
The list check fails on any other list line in the list, on another owner word, and on an item without one.
A ticked item that was not done says why.
A postponed item names the trigger that brings it back, and gets a row in the open-state table with the trigger in the Next column.
An item from a ledger thread carries the thread's slug as `(thread: <slug>)`.

```markdown
## Finish first

- [ ] model: write the tickets
- [x] principal: detach the second repository
- [x] model: correct the README (dropped: a ticket covers it)
- [x] model: run the probes (postponed until: the probe ticket closes) (thread: probes)
- [ ] principal: confirm the edit to the body of ticket 12
```

The published handoff keeps the list as the record of the two runs.

## Open state

Collect it from the session itself, never by re-derivation: unmerged changes and what gates them, open tickets touched, rulings and standing rules the principal stated, gotchas that cost time.
Order items by urgency, then importance, with a blocker before what waits on it.
Surface low-hanging fruit of high value early.

Write it into the draft: what happened since the previous handoff; an open-state table (item | state | next); standing rules; gotchas; a link to the previous handoff.
Every row carries a next action, stays on one line and stands in priority order: verify.sh lifts the rows verbatim into the post-compaction context.
A reader with none of this session's context can pick any row and continue it.

## Hooks and state

The skill ships its own compaction hooks.
`verify.sh` runs on `SessionStart` (matcher `compact`): it injects the handoff pointer and the open-state rows into the fresh context, and clears the phase.
Without a local state, after a resume into a new container, it restores the state and the draft from the store first.
`guard.sh` runs on `PreCompact` and blocks compaction (exit 2) while no fresh marker exists, and while the phase is `listed` or `written`.
Only the principal sets `PRECOMPACT_GUARD=off`.
When the guard blocks, rerun the handoff.
Where a manager owns `settings.json` (a `managedBy` marker), its template must carry both entries, and `check.sh` prints them.
Relay the printed entries to the principal.
Everywhere else `check.sh` installs them.

The per-session state holds the phase, the draft's path and the marker.
`state.sh` documents how each script finds its session.
`HANDOFF_STATE` names one explicit state file, and `HANDOFF_TRANSCRIPT` selects the session by its transcript.
`store.sh` documents where the state is pushed.
Every push goes through the outgoing scan.
The ledger steps need `LEDGER_SESSION_URL`, and skip in one line without it.
`HANDOFF_STORE` names the installing project's own place for session artifacts.
