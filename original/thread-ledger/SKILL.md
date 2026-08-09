---
name: thread-ledger
description: Records a session's open work as append-only events in the session-memory store, and renders the watchable view. Use when a session's progress must be visible outside it — an orchestrator tracking parallel threads, or a worker or review run reporting where it got to.
---

# Thread Ledger

A session's record of what is open, how far along it is, and what it
waits on. Append-only events in the session-memory store named by
`SESSION_MEMORY_URL`, rendered as a page anyone can watch.

Where this is in force it **replaces the native task list**. Do not
maintain both: two trackers drift, and the one being watched is the
one that lies.

## What a thread is, by session

The schema does not change by role; what counts as a thread does.

| Session | A thread is |
| --- | --- |
| **orchestrator** | one line of work the principal opened — usually several at once, with `deps` between them |
| **worker** | the ticket it was fired on, plus anything it split off (`parent`) |
| **review** | the PR under review; `blocked on: external` while it waits for the fix session |

A worker run typically opens one thread and closes it. That is worth
doing anyway: it is the only place its progress is visible while it is
running, and the only record of *why* it stopped once it is gone.

## When to append

Whenever thread state actually changes — then republish at the end of
the turn. Where `heartbeat.mjs` is installed a turn that changed a
declared thread and did not append cannot end; where it is not, the
harness's task-tool reminder is the cue, and priming is the fallback
that has already been measured insufficient here.

| Moment | Event |
| --- | --- |
| A thread starts | `opened` |
| Measurable movement | `progress` with `pct` and a one-line `note` |
| Waiting on something | `blocked` with `on` and `what` |
| That something arrives | `unblocked` |
| Deferred deliberately | `parked` with a named `trigger` |
| A conversation thread became work | `promoted` with its ticket |
| The ticket no longer says what the session knows | `stale` with `what` changed |
| The ticket has been brought back in line | `synced` |
| The priorities on a live thread were wrong | `reprioritized` with the corrected `deps`, `urgency` or `importance` |
| Finished | `completed` |
| Abandoned | `dropped` with why |
| Finished thing needs more work | `reopened` |

`sealed` is the one kind you never write: `heartbeat.mjs` appends it
when a turn's checks are green. It describes the log rather than any
thread, so it carries no thread at all.
Each seal carries a `diligence` digest the hook computes from its own
compliance log — the stretch since the previous seal, never a window
anyone chooses — and the stretch's raw per-Stop records flush to
`diligence/<session>.jsonl` in the store beside it.
The digest is computed, never typed:
a seal composed by hand about the turn's own conduct would be
self-report, and the recorder has no flag that reaches the field.
The hook then pushes the store itself (seal phase 3): the checks gated
the seal — the rendered page among them — and the seal gates the push,
so no manual store push belongs in any turn. A store that is not a git
clone, or a push the network refuses, is left for the next seal's push
to sweep; the SessionStart clone report and the store's CI tail guard
observe that gap.

Splitting a thread: `opened` the children with `parent` set to the
original's slug. The parent keeps its own lifecycle.

## Rules the recorder enforces

It rejects rather than warns, so a mistake fails at write time
instead of surfacing as a wrong page later.

- **Every thread references a forge ticket or is tagged
  `conversation_only`** — exactly one. The board is where work lives;
  the ledger is conversation state. Promotion runs one way only.
- **`parked` requires a named trigger.** A revisit condition nobody
  can check is a revisit that never happens — and the rendered page
  is what observes it.
- **Illegal transitions fail loudly.** `completed → completed` is
  rejected; `completed → reopened → completed` is fine. Validation
  runs against every session's events, so a later session can
  continue a thread an earlier one opened.
- **`stale` needs a ticket and a `what`.** A conversation-only thread
  has nothing to be out of date, and the prompt the marker generates is
  only as useful as the sentence naming what the ticket is missing.
  Marking stale twice, or syncing a current ticket, is rejected.
- **`promoted`, `stale`, `synced` and `reprioritized` are metadata,
  not moves.** The first three record what happened to the *ticket*;
  `reprioritized` corrects the thread's own `deps`, `urgency` or
  `importance`. Neither kind says anything about whether the work is
  blocked, so all four are legal wherever the thread is live and leave
  the work state untouched. Inside the state machine, filing a ticket
  for a blocked thread would have forced a false `unblocked` into the
  log — and priorities, which fold only on opening events, could never
  be corrected at all.
- **`at` and `anchor` are recorder-owned.** Supply them and they are
  overwritten — code determines them more accurately than an agent
  estimating.
- **The store is worked on its default branch.** An append pushes
  `HEAD` there, so a clone left on any other branch would publish that
  branch's commits unreviewed the moment a routine append ran
  (measured: skills#76). The recorder refuses before writing anything;
  reconcile the clone onto the default branch and re-run.

## The heartbeat

`heartbeat.mjs` sits beside `ledger.mjs` and runs as a `Stop` hook.
It checks a finished turn against **observed state only** — files on
disk, git, the ledger log — and either seals the turn or blocks it
once. There is no self-report tier: a checklist filled in by the agent
that did the work is another claim from the context that already
believed the work happened.

Your part is one file per turn, `~/.claude/turn-summary.txt`:

```text
threads: reminder-heartbeat, seal-event
tickets: my-org/skills#56
reviews: none
```

Every check is a mechanical diff of that declaration against what was
actually written and pushed. When one fails, the block reason states
the completion criterion and the exact command — run it and end the
turn; it is never a prompt to start new work.

The `reviews:` line is the declared half of a standing habit: wherever
a check has a blind spot, the model declares and the observer
cross-checks. Its states are `none`, `read`, `persisted` and
`nothing-to-persist`. A declaration can widen detection — declaring
`none` over a transcript that fetched footer-less comment bodies
fires, and so does claiming `persisted` over untouched stores — but it
never greens the check: only an observed memory write does that. The
explicit waiver, `nothing-to-persist`, passes as a logged claim, so
declining to persist is a visible act rather than a silence.

The check list, the seal, the verdict log and the environment contract
are code, documented where they live: the header of `heartbeat.mjs`.
The installer configures them; a misconfiguration is logged, never
passed.

**A clone behind its branch is reconciled, never forced.** The command
the hook offers is `merge --ff-only`: it succeeds for a plain rollback
and fails loudly for a real divergence. Forcing the push instead is the
step that turns a recoverable state into lost work.

**Nothing outgoing carries a blocked term.** `scan.mjs` is the shared
scanner (skills#46, check 7): built-in terms are the store URL values,
taken from the environment automatically; user terms come from
`PUSH_BLOCKLIST`, `|`-separated and optional by design (a literal `|`
in a term is not expressible — reserved). The scan covers what would
LEAVE — commits on no remote, tracked changes a commit would sweep up,
the rendered page — never untracked files or the environment: a term
may live there, it must only never leave. It runs before the pushed
check so a hit blocks before any push instruction, and every report
names the term's SOURCE, never its value — the confirm commands count
matches rather than printing them.

**What a review decided is persisted, not just read.** The truth
source is the attribution-footer contract (skills#46, check 14): a
fetched comment body without the footer was written by a human, and a
human's review answers must not live only in a transcript the
container discards. Either memory store counts as persisted — "not
lost" beats "right cabinet" — and the match is coarse by ruling:
human comments in, zero memory writes out, fires once. The footer
heuristic alone only observes; what blocks is the mechanical side —
the `reviews:` declaration against the stores, or a declaration the
transcript contradicts.

With `AGENT_ACCOUNTS` set (comma-separated forge logins the agent
posts as), authorship beats the footer as the discriminator, and the
contract itself is guarded: a footer on a foreign account, or an
agent account posting bare, fails loudly — every footer-based reading
is suspect while either holds. Opt-in by construction: no variable,
no account check.

**Every ticket the turn declared heard about it.** The declared
`tickets:` set diffs against issue-writing tool calls in the
transcript (skills#46, check 4) — reading a ticket is not updating
it. The per-ticket escape is a `no-update: <owner/repo#n> <why>` line
in the same summary file: logged as a claim, never verified, so
declining to update is a visible act rather than a silence.

**Every ruling the turn declared is a record.** A `rulings:` line
names the slugs the principal ruled on (skills#46, check 8); each one
must appear in a decisions/ filename that arrived this turn.
Mechanical, so it blocks; the accepted blind spot (ruling E10) is the
ruling never declared. The grilling check (13) stays observe-first:
the invocation is mechanical, but answers arrive in waves over later
turns and records legitimately land when the rulings settle — a
blocking check would fire between waves, so it only logs what it
sees until the compliance data earns it more.

**The remind tier (checks 10 and 11).** Work that completes with a
PR owes the corpus a kata: the trigger is mechanical, the adequacy is
not, so the hook reminds exactly once per thread — the fresh-incident
moment is when a kata is cheap — and afterwards records only the
claim. A question-shaped close without a `blocked` event is observed
and never blocked on: the detector is imperfect by admission, and an
imperfect detector is measured before it may nag.

**A ledger conflict is resolved by union — `--ours`/`--theirs` are
never valid.** The log is append-only and both sides are real events,
so the only correct merge keeps every line in stamp order; the recorder
does exactly that on a lost push. Picking a side deletes someone's
published event, and `git checkout --theirs .` deletes them wholesale
(measured: skills#79). The store's CI guard (`ledger guard`) rejects
any push that removes a ledger or diligence line, and the recorder
refuses a push whose merge would land a transition the union forbids —
when that happens, the event is withdrawn and the message says what to
re-append. Deleting a published line is never a legal edit;
re-appending is the only legal repair.

**A decision marked this turn is recorded this turn.** When a commit
adds a `DECISION` marker, the decision store gets its record before the
turn ends: the reasoning is free to write while you still hold it and
cannot be reconstructed later, and a reconstructed prediction scores
nothing. A marker already in the tree is an earlier turn's debt, not
this one's — and *this turn* is measured by when a commit was AUTHORED,
which survives rebase and merge, so landing an old branch never bills
its markers to the turn that merged it. Only the *marked* half is
mechanized — judging what deserves a marker stays with you.

**Never re-open a recorder session that is already open.** `record.py
open` mints a new session branch every time it runs, stranding the
records committed on the branch it replaces. The hook reads the
recorder's own state and offers the command that matches it.

**Republish the page after appending.** The rendered file is compared
against the newest event, so a stale artifact blocks the turn. Render
with `--session-url`: a store holding several conversations refuses
without one.

**Responses follow the reference style, and mistakes are corrected as
an exercise.** In prose, tickets and PRs are linked shortcode refs —
`XXX#n` for tickets, `XXX!n` for PRs, each a markdown link to the page
its sigil implies — with the shortcodes defined once, in the store's
`config/shortcodes.json`. That file is either a flat shortcode →
`owner/repo` map (GitHub assumed) or structured —
`{forge, patterns: {ticket, pr}, repos}`, patterns interpolating
`{base}`/`{repo}`/`{n}` — so the forge is org configuration in the
store, and no vendor is named in code. A thread opened this turn is announced as
`new thread: <slug>`, and every thread the turn summary declares is
named in the prose that discusses it. Code spans are quoted material
and exempt; a bare `owner/repo#n` belongs in PR bodies and ledger
events, where the forge autolinks it, never in prose. When the check
fires, it names the canonical forms and the rewrite must contain them
**verbatim** — deleting the offending refs is not correcting them, and
the re-fire grades exactly that. No map in the store means the check
reports `unconfigured` and declines, like every other check.

## Diligence

`diligence.mjs` reads the compliance log and reports what the reminders
cost against what they buy — per turn, per check, per model. Cycle 1 is
the unprompted baseline, and everything above it is the reminder's price
in round-trips. The report prints its own limits beside its numbers.
`HEARTBEAT_OBSERVE` runs every check and logs every verdict while
surfacing nothing: the unobserved arm, for measuring what the reminder
itself changes.

A check defect that fires wrongly still lands in the corpus as model
non-compliance. The correction is a **dispute**: a line in the store's
`diligence/disputes.jsonl` naming the check, the window, and the
ticket that filed the defect, written at diagnosis time. The report
counts matching failures apart — billed to neither side — while the
records themselves stay immutable; a dispute without a filed ticket is
rejected, because an eraser the recorder could reach for is exactly
what the corpus must not have.

The rendered page makes the same numbers legible per stretch:
a sessions section leads the page — one chip per session, and the chip
both unfolds that session's stretches and filters the thread lists.
Every seal is a thin rule carrying when, the threads touched, the
checks that fired (ignored ones marked), the reminder count, and total
tokens and wall-span weighted against the session's own median.
Clean stretches stay quiet; reminders go amber; a stretch that was
reminded and still did not finish goes red.
A compaction reset renders as an explicit gap, never as zero, and
seals from before the digest existed collapse to one counted line.

## Reconciling against the world

The checks are turn-local by design; nothing in the hook queries the
tracker, and a merge usually happens outside any turn. Reconciliation
therefore lives in two report-only tools, and neither can write:

- **`merged-report --repos <dir>`** — the SessionStart twin of the
  clone report. A thread that records its `--branch` beside its ticket
  makes "is this work merged" a pure git question; live threads whose
  branch is an ancestor of the default branch are named on stdout.
  Reports, never gates: a missing clone, an unknown ref or a network
  failure is silence, and the exit is always 0.
- **`reconcile`** — the API-priced half, on demand where `gh` is
  authenticated. Prints both directions of divergence: a live thread
  whose ticket is closed, and a completed thread whose `--pr` never
  merged. Deliberately forge-specific: it is `gh`-bound by declaration
  and refuses without it, unlike the render path, which builds every
  ticket link through the store's `config/shortcodes.json` forge
  config and names no vendor (skills#102).

Deciding what event to append stays with the reader — a reconciler
that wrote events would be a second author of the log it audits.

## Ordering

Rendering order is computed from the events, so nothing here needs
setting — but it is worth knowing that **`deps` and `urgency` are what
move a thread up the page**, since those are fields you supply.
Dependency ranks first: a cluster is ordered by the thread that must
move first, so a thread behind an urgent blocker sits directly under
it rather than sinking down the list.

## Usage

`ledger.mjs` sits next to this file, wherever the skill is installed.
Node only, no packages.

```bash
LEDGER="$(dirname "$0")/ledger.mjs"   # or the skill directory's own path

node "$LEDGER" append --ev opened --thread pilot-trigger \
    --title "Create the Issues:Labeled trigger" \
    --ticket my-org/meta#35 --urgency high --importance high
node "$LEDGER" append --ev progress --thread pilot-trigger \
    --pct 40 --note "trigger drafted; awaiting model-selection check"
node "$LEDGER" state          # the folded JSON, to inspect before appending
node "$LEDGER" render --out ledger.html --title "Thread ledger"
```

Each event kind requires only its own fields — `progress` wants `pct`,
`blocked` wants `on` and `what`, `synced` wants nothing. The fold
carries everything else forward, so nothing is restated per append.

Then publish `ledger.html` as an artifact, reusing the same URL so the
principal's bookmark stays valid.

`render` fast-forwards the store before it reads; `--no-pull` skips
that. A store that cannot fast-forward still renders: the reason goes
to stderr, and the page itself carries a "possibly outdated" banner
so its reader knows too. Two habits stay yours, since they happen
around the publish call: never read the published page first — the
conflict error is cheaper, so pay it when it happens and republish —
and concede to a session visibly publishing the same store, since its
next render carries your events.

### Identity

**The conversation's URL is the log's identity.** Pass
`--session-url` once; it is recorded in the store, names the log file,
and is stamped onto later events so every thread links back to where
it was discussed.

Nothing else is stable. The transcript filename is local to one
machine, and a name the session is merely *called* can differ between
two runs of this tool — which is how one conversation ended up with
two valid logs that folded in beside each other and looked entirely
healthy. Deriving the name from the URL removes that, rather than
guarding against it.

The fallbacks — the store's single recorded URL, then the transcript
stem — belong to **reads only**: CI renders with no transcript and no
way to know the session, and a read folds every log anyway. An
`append` without `--session-url` (or `LEDGER_SESSION_URL`) or
`--session` refuses outright: an append pushes immediately, so a
guessed identity is published before any warning can be acted on —
measured twice (skills#51), both times filing events under an identity
that exists nowhere. `--session` remains for a store holding several
conversations.

## One implementation

`core.mjs` holds the schema, the state machine and the fold. One
consumer is an HTML page. It carries **raw events, not rendered rows**
and computes state at load. If its script fails, the page shows a
failure banner carrying a ready-to-paste debugging prompt.

## Store location

`SESSION_MEMORY_URL` names the store events are written to. Unset,
every command fails.
