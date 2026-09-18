---
name: take-ticket
description: Work one labeled ticket to a draft PR or a routed blocked-report, in an autonomous session. Use when a session fires on a ready-for-agent ticket, or when asked to take a ticket end to end.
---

# Take Ticket

One firing, one ticket, one outcome: a draft PR or a blocked-report.
Then the session ends. The label queue is the only scheduler — the
next ticket is the next session.

## What the consumer repo must bind

This skill names roles; the consumer repo's `AGENTS.md` says what
fills them. Four bindings, and they are load-bearing:

| Role | What it is |
| --- | --- |
| **dispatch label** | the label whose application fires a session |
| **claim field** | a writable field whose value marks a ticket taken |
| **in-progress** and **review** values | what that field is set to |
| **glossary resolver** | the command that expands the repo's terms |

A binding the repo does not define is a block, not a default to guess:
report it via `/asking-for-help` and stop. Guessing a claim field is
how two sessions end up on one ticket.

## Claim before working

1. Read the ticket. Resolve its glossary terms with the repo's
   resolver.
2. **Check the claim field first.** Already in-progress means another
   session claimed it: exit silently, touching nothing. A re-fired
   label (removed and re-applied) must not produce two agents on one
   ticket — and a comment from a session that does not own the ticket
   is itself interference.
3. Check blocked-by. A ticket whose dependency is unmerged is not
   ready, whatever its label says — report it blocked and stop.
4. Claim it: set the claim field to in-progress.

## Work

Ordinary engineering, with the repo's own `AGENTS.md` in force. Work
across repos when the ticket needs it — a change and its consumer
often live apart.

Invoke the verbs as their moments arise, rather than saving them for
the end:

| Moment | Skill |
| --- | --- |
| A non-obvious choice | `/making-decisions` |
| Found a defect | `/filing-bugs` |
| Found something missing | `/requesting-features` |
| Read the ticket wrong | `/reporting-misunderstandings` |
| Cannot proceed alone | `/asking-for-help` |

## Finish

Open a **draft** PR. Body states what changed and why, references the
ticket, and names anything left undone. Set the claim field to review.

Never mark a ticket done because the PR exists. It is done when it is
merged, and that is not this session's call.

## Blocked

A session that vanishes is indistinguishable from one that never
fired, so a blocked run always leaves three things:

1. a comment stating the blocker and what would clear it,
2. the dispatch label **removed** — re-labelling is the retry gesture,
   so the dispatch act and the retry act are the same,
3. the claim field back to its pre-claim value.

Then route by cause via `/asking-for-help`.

## What this session never does

- merge its own PR
- work a second ticket
- relabel other tickets
- decide something the principal has not delegated — that is a block,
  not a judgement call
