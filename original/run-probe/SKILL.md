---
name: run-probe
description: >
  Run a fresh-session probe against this environment from a checked-in
  probe reference. Use when the user asks to run a probe, reinset run,
  or live-fire dojo test of session machinery, or names a probe dir.
---

# Run Probe

Observer side. A probe dir (checkout-relative, e.g.
`meta/dojo/identity-probe`) carries `probe.md` — the fixture the
observed session executes — and `verdict.sh`, the read-only oracle
(exit 0 = PASS; other exits typed in its header).

## Steps

1. Resolve the reference against the session root; confirm both files
   exist. Done when both paths print.
2. Spawn a fresh session in this environment, **by a path that
   attaches the environment's repositories**. Initial prompt, exactly,
   reference substituted:

   `Use the take-probe skill with reference <ref>. If that skill is unavailable, read <ref>/probe.md from the attached checkout and follow it verbatim.`

   Send it nothing else — an unprimed session is the instrument, and
   floundering is the datum. Done when the session id is captured AND
   the session survives its setup script.

   If the spawn tooling cannot attach the full source set, hand the
   spawn to the principal (new session from the environment's UI,
   this line as the only message) and have them return the session
   id.
3. Run `<ref>/verdict.sh <session-id>` (background it; it watches).
   Done when it exits.
4. Report the verdict line verbatim; record it with the session id on
   the ticket the probe names, and a ledger event where the
   environment keeps one. Done when the writes are confirmed or their
   absence reported.
5. Run `check.sh` beside this file.

## Parameter routing

Cheapest slot that can carry a parameter wins; an environment is the
most expensive and is spent last.

| Varies per | Rides in |
| --- | --- |
| run | the spawn's prompt (the probe reference), title, tags |
| substrate under test | the spawned source's branch — setup script, repo manifest, and per-repo branch pins are read from that checkout, so one branch pin selects the whole substrate |
| cell (a worker kind needing genuinely different variables or secrets) | `environment_id` — one environment per cell, kept minimal |

Mint a new environment only for a cell that cannot be expressed by
the rows above it; role/mode variables live on the cell's
environment, never one environment per combination.

Guardrails are added here only with a probe run that showed the need.
The evidence lives in the commit that adds the rule and on its
ticket, never in this file — skills are public, and carry no session
ids or run narratives. `git log` on the rule reaches its evidence.
