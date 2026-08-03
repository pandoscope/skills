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
| Finished | `completed` |
| Abandoned | `dropped` with why |
| Finished thing needs more work | `reopened` |

`sealed` is the one kind you never write: `heartbeat.mjs` appends it
when a turn's checks are green. It describes the log rather than any
thread, so it carries no thread at all.

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
- **`promoted`, `stale` and `synced` are metadata, not moves.** They
  record what happened to the *ticket*, which says nothing about
  whether the thread is blocked — so they are legal wherever the
  thread is live and leave the work state untouched. Inside the state
  machine, filing a ticket for a blocked thread would have forced a
  false `unblocked` into the log.
- **`at` and `anchor` are recorder-owned.** Supply them and they are
  overwritten — code determines them more accurately than an agent
  estimating.

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
```

Every check is a mechanical diff of that declaration against what was
actually written and pushed. When one fails, the block reason states
the completion criterion and the exact command — run it and end the
turn; it is never a prompt to start new work.

The check list, the seal, the verdict log and the environment contract
are code, documented where they live: the header of `heartbeat.mjs`.
The installer configures them; a misconfiguration is logged, never
passed.

**A clone behind its branch is reconciled, never forced.** The command
the hook offers is `merge --ff-only`: it succeeds for a plain rollback
and fails loudly for a real divergence. Forcing the push instead is the
step that turns a recoverable state into lost work.

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

Without a URL the tool falls back to the transcript stem **and says
so**, or refuses when there is nothing at all to go on. `--session`
remains for a store holding several conversations.

## One implementation

`core.mjs` holds the schema, the state machine and the fold. One
consumer is an HTML page. It carries **raw events, not rendered rows**
and computes state at load. If its script fails, the page shows a
failure banner carrying a ready-to-paste debugging prompt.

## Store location

`SESSION_MEMORY_URL` names the store events are written to. Unset,
every command fails.
