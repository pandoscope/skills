# Grilling session recording — reference

Consulted from SKILL.md at session end.

**The store owns its own writing conventions.** Record schema, ID
format, commit types, PR flow, `related`/`supersedes` semantics,
outcome buckets and hit-rate reporting are the target repo's contract,
stated in its agent-instructions and conventions files and enforced by
its CI guards. Read them there and follow them; nothing about them is
restated here, because a copy drifts on the store's next change and the
copy is what the agent would obey.

This file carries only what grilling itself owes.

## What grilling contributes

- **Append only.** Grilling writes new records and nothing else — never
  edits an existing record, never edits the active preference set, no
  matter what the store's instructions permit its other writers to do.
  The preference set changes through the store's own promotion path,
  human-approved.
- **The session JSON is the input side.** Hand the recorder the same
  object the renderer consumed — question, options, lineage, `context`
  written BEFORE the ruling — plus the artifact reference. The output
  side is the ruling alone: chosen slot, operative if-clause or free
  text, correction flag. Keeping them apart is what lets a replay mask
  outcomes and re-predict; mixing post-ruling knowledge into an
  input-side field silently destroys that.
- **Provenance the store cannot infer**: which slot carried the
  prediction and which rules drove it. Meaning of each event —
  confirmation, correction, disconfirmation, gap — is
  [reading.md](reading.md).
- **The numbers for the session PR.** The store requires hit rates in
  two streams; grilling is what knows them.

## One session at a time

Records land unmerged, and stay unmerged until the principal reviews
them. Do not open a grilling session while a previous session's records
are still unmerged: a second session recorded on top makes the first
un-reviewable in isolation, and the principal's review is the only gate
the whole pipeline has. `check.sh` fails while the store carries
unmerged records — the session is not finished when the PR opens, but
when it merges.

## Extraction

Turning records into candidate preference rules is the store's own
extraction skill (named `extract-preferences` in stores built from the
same template). Invoke it by name and let it own the rules; if it is
absent, say so and stop — grilling proposes no preference rules of its
own, and promotion into the active set is human-only either way.

## Artifact embedding

Grilling's only write outside the store. Rejection reasons for
non-chosen options go into the session's target artifact (design doc,
ADR, spec), adjacent to the decided item — e.g. a "Considered
alternatives" subsection: option | rejection reason, one line each.

- The artifact form is project-framed and shareable.
  Personal-preference framing — rule confirmations, prediction scores —
  goes ONLY to the store.
- Near-ties: record the revisit condition ("chosen over Y on X; revisit
  if X changes"). It is an executable resumption check for the next
  agent, which the store's own record cannot give the project.
- No natural decision location in the artifact → append a "Decision
  Log" section; never skip the write.
