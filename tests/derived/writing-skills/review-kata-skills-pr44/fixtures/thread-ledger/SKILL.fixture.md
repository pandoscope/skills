---
name: thread-ledger
description: Maintains the orchestrator session's open-thread ledger in the session-memory store and republishes the watchable HTML view. Use in high-level sessions where the principal brain-dumps and the agent tracks parallel threads; replaces the native task list there.
---

# Thread Ledger

The orchestrator session's record of what is open, how far along it
is, and what it waits on. Append-only events in the session-memory
store named by `SESSION_MEMORY_URL`, rendered as a page the principal
can watch.

In orchestrator sessions this **replaces the native task list**. Do
not maintain both: two trackers drift, and the one being watched is
the one that lies.

## When to append

The harness's task-tool reminder is the heartbeat. When it fires, or
whenever thread state actually changes, append the event — then
republish at the end of the turn.

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

## Ticket prefixes

A thread's ticket renders as a linked short code on the title —
`AET#123 Extract the shared store cores` — rather than a badge on its
own line. The code map lives in the store (`repo-codes.json`), not in
this skill: the tool ships no org's repo names. An unmapped repo falls
back to its own name, so a missing entry reads as long rather than as
some other repo's code.

## Tickets that fell behind

A session learns faster than its tickets get edited. `stale` records
that gap; the HTML view marks it with a small amber **(i)** beside the
anchor, and the header gains an **N tickets outdated** button.

Clicking either copies an instruction — the per-ticket one names that
ticket and what it is missing, the header one names *every* outdated
ticket explicitly, because "update the outdated tickets" sends the
agent re-deriving what the ledger already knows. Both end with the
`synced` command, so the loop closes rather than leaving the flag up.

Deliberately absent from the Markdown view: it cannot copy a prompt,
so a marker there would be a flag nobody can act on.

Threads without a ticket show a `NO TICKET` picker in the same place,
listing every repo in the code map. Choosing one copies a prompt that
names the thread, its title, and the `promoted` command to run
afterwards — paste it into the session and the agent files the ticket.

The picker writes nothing itself. The page is a view of the store, and
a control that appeared to file a ticket while the store stayed
unchanged would be the same lie as a green check that never ran. Every
prompt is rendered into the page as selectable text, so it stays
reachable even where the clipboard is refused.

## What the page shows

One thread per line: ticket, title, state, anchor. Blocking kinds are
visually distinct, and waiting-on-the-principal is the loudest — it is
the one state only a human can clear.

Layout, truncation and tooltip decisions live in `ledger.py`, with the
reasoning beside the code that implements it. Nothing here needs
repeating it: this skill appends events and republishes; the renderer
decides how they look.

## Ordering

Open threads sort by dependency, then urgency, then importance, then
first-`opened` position in the file (absolute; not timestamps).

Priority propagates along dependency edges: a cluster is ranked by the
thread that must move first, and blockees render beneath their
blockers. A thread waiting on an urgent blocker therefore sits high,
which is the point — its position shows what unblocking would unlock.

`blocked on: external` does **not** demote. An external ticket often
gates only the merge, so the thread stays workable and gets a link,
best effort, no network call.

Completed and dropped threads render below a rule in completion
order, oldest first; dropped ones stay unchecked with their reason.

## Usage

`ledger.py` sits next to this file, wherever the skill is installed.

```bash
LEDGER="$(dirname "$0")/ledger.py"   # or the skill directory's own path

python3 "$LEDGER" append --ev opened --thread pilot-trigger \
    --title "Create the Issues:Labeled trigger" \
    --ticket my-org/meta#35 --urgency high --importance high
python3 "$LEDGER" append --ev progress --thread pilot-trigger \
    --pct 40 --note "trigger drafted; awaiting model-selection check"
python3 "$LEDGER" state          # the folded JSON, to inspect before appending
python3 "$LEDGER" render --out ledger.html --title "Thread ledger"
```

Each event kind requires only its own fields — `progress` wants `pct`,
`blocked` wants `on` and `what`, `synced` wants nothing. The fold
carries everything else forward, so nothing is restated per append.

Then publish `ledger.html` as an artifact, reusing the same URL so the
principal's bookmark stays valid.

### The session id

Defaults to the transcript's filename stem, and every event in one
conversation must carry the same one. A session opened under a chosen
name needs `--session <name>` on **every** call: appending under a
second id would start a parallel log that folds in beside the first
and looks entirely healthy. The recorder refuses this when the store
holds exactly one conversation, because it happened.

The conversation's web URL cannot be derived from the transcript —
different identifiers — so pass `--session-url` once on a render. It
is remembered in the store and stamped onto later events, which is
what links each thread to the session it was last touched in.

## Two views, one fold

```bash
python3 "$LEDGER" render --format md --out LEDGER.md
```

The store renders `LEDGER.md` on every push to `ledger/`, and GitHub
displays it on the repo page — a private, authenticated, always-current
view that needs no agent turn. Pages cannot serve one: a site published
from a private repo is public.

Markdown is a second **view**, never a second source. Both read
`fold()`, so they cannot disagree about what is open.

GitHub's sanitizer is what shapes that view; the renderer already
works within it.

Each `append` pushes straight to `main` — no PR, no review gate. The
schema and the recorder are the contract. Pass `--no-push` to stage
several events and push once.

## Store location

`SESSION_MEMORY_URL` names the store. The tool verifies a clone's
origin against it and refuses to write to the wrong repo. Unset, it
falls back to a conventional path and says so on stderr — a guessed
store that happens to work is indistinguishable from a configured one
until it writes somewhere unexpected.

## Data outlives the rendering

The page embeds the full event list, not just current state. Renders
may summarize finished threads; the data never does, so trajectories
and graphs added later need no second source.
