# Grilling session recording — reference

Consulted from SKILL.md at session end. Writing conventions (record
schema, commit types, PR flow) come from target repo's own
agent-instructions file — this skill does not duplicate them.

## Store discipline

- One PR per session, one commit per record, conventional commits per
  target repo. Grilling only ever appends records — never edits existing
  records or preference set, regardless of what target-repo instructions
  say.
- Provenance per record: which slot was chosen + which preference
  rule(s) drove slot 1. Rule only ever "confirmed" by choices its own
  recommendation caused has zero independent evidence — extraction pass
  flags such rules, never strengthens them. Deviations, corrections and
  free text are load-bearing signal; rule-driven acceptances are
  near-worthless as confirmation.
- Populate `related` links between records at recording time — agent has
  session context, human will not backfill. Surface `supersedes` claims
  prominently in PR description: wrong supersession silently deactivates
  a live decision.
- Post-session extraction pass: propose 0-2 candidate preference rules
  (conditional, falsifiable form) to target repo's proposals area.
  Promotion into active set is human-only.
- Session PR states prediction hit rates as two streams:
  preference-driven vs cold. Cold is control group — preference-driven
  must beat cold or preference memory isn't earning its context budget.
  Near-perfect preference-driven hit rate is a smell (grilling gone
  soft, or echo chamber), not success.

## Replay-ready records

Strict input/output field separation so replay can mask outcomes:

- Input side: session JSON verbatim (same object renderer consumed —
  question, options, reasonings, lineage, `context` written BEFORE
  ruling) plus `artifact_ref@SHA` for durable context.
- Output side: chosen slot, operative if-clause or free text, correction
  flag.
- Replay harness is this skill in eval mode: given input + rule set,
  predict; score against output.

## Artifact embedding

Rejection reasons for non-chosen options also go into session's target
artifact (design doc, ADR, spec), adjacent to decided item — e.g.
"Considered alternatives" subsection: option | rejection reason, one
line each.

- Artifact form is project-framed and shareable. Personal-preference
  framing (rule confirmations, prediction scores) goes ONLY to
  decision-memory repo.
- Near-ties: record with revisit condition ("chosen over Y on X; revisit
  if X changes") — executable resumption check for future agents.
- No natural decision location in artifact → append "Decision Log"
  section; never skip the write.
