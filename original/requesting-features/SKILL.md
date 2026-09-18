---
name: requesting-features
description: File a missing capability as a feature ticket plus an evidence record. Use when an agent session needs something that does not exist rather than something that is broken.
---

# Requesting Features

A capability that is **absent** rather than broken. The distinction
decides the label and who reads it: a bug interrupts, a feature
queues.

## Say what blocked, not what to build

The strongest request names the moment the absence bit:

> `take-ticket` could not tell whether the ticket's dependency had
> merged, because nothing exposes blocked-by through the connector.

That is actionable and falsifiable. "Add a dependency API" is a
solution guess, and it forecloses options the principal may prefer.

State the workaround used, if any, and its cost. A request with a
working workaround is a different priority from one that stopped the
session.

## Search before filing

Org-wide, closed issues included. A capability already discussed is a
comment on that thread — consolidating shows where disagreements lie,
which is exactly what stress-testing needs later.

## Record and ticket

1. evidence record — triage `feature`, the blocked moment, the
   workaround and its cost. Written with the evidence-memory repo's
   `tools/capture.py`, same as `/filing-bugs`; that repo's
   `docs/conventions.md` is the schema authority.
2. forge ticket labelled `feature`, linked from the record
3. the record links the ticket; the ticket links the record

## Scope honestly

Do not bundle. Three absences noticed in one session are three
tickets — they will be prioritised apart, and a bundle forces the
principal to rule on all of them to act on any.

## Never

- file a feature for something that exists but is broken; that is
  `/filing-bugs`
- file a feature because the ticket at hand would be easier with it,
  without saying so
- assume the absence is real without checking: search the repo, read
  the tool's `--help`, and say what you checked
