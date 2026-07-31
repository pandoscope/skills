---
name: filing-bugs
description: Capture a defect as an evidence record plus a forge ticket, with a minimal reproduction when it does not leak. Use when an agent session finds behaviour that contradicts a stated contract.
---

# Filing Bugs

A defect is behaviour contradicting the code's own contract. Capture
it where it was found, not later from memory: the session holding the
failure is the only one that can still reproduce it cheaply.

Derives from the evidence store's capture flow: the triage tiers and
the record writer live in the evidence-memory repo (`tools/capture.py`,
its `--help` is the behaviour doc; `docs/conventions.md` holds the
schema). This skill is the trigger and the routing, not a second copy
of either.

## Triage first

The evidence taxonomy decides the label and the record:

| Triage | Means |
| --- | --- |
| `code-bug` | behaviour contradicts the code's own contract |
| `doc-bug` | behaviour is right, the documentation is wrong |
| `expectation-bug` | code and docs agree; the expectation they set is wrong |

Not a defect: a missing capability. That is `/requesting-features`.

## Reproduction is the deliverable

A **tier 1** capsule reproduces and leaks nothing — that is the kata,
and it is worth more than the prose around it. Open it as its own PR
alongside the ticket.

Cold-verify the capsule in a clean directory before claiming it
reproduces. A capsule that only works in the session that wrote it
records a memory, not a defect.

**Where a leak-free version cannot reproduce**, it is tier 2: a
non-runnable description with invented specifics. Dummy data, never
real. It carries the human gate — never auto-merge tier 2, and file
its ticket after approval rather than before.

## Search before filing

Org-wide, closed issues included. A defect already ruled on is a
comment on the existing ticket, not a new one — and a record that
presents settled behaviour as a discovery misleads whoever reads it
next.

## Record and ticket, in that order

1. evidence record — symptom, environment, expected vs observed,
   capsule, triage, tier
2. forge ticket, labelled by triage, linked from the record
3. the record links the ticket; the ticket links the record

## Never

- report a defect without having observed it fail
- file the same finding twice because two sessions found it
- put a real secret, hostname or credential in a capsule — the
  evidence store's own secret scan runs on write, but it is the last
  line, not the first
