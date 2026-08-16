# A skill's own check fails, and the turn ends anyway

**Measured, 2026-08-15:** an edit pushed `writing-skills/SKILL.md` to
2511 tokens — past the 2500 ceiling that very edit was recording — and
the only thing that caught it was the author running `check.sh` by
hand. The enforcement chain was measured empty end to end: the script
is absent from the repo's CI workflow, absent from its pre-commit
config, and `make test` / `make lint` cover bats and shellcheck only.
The sole trigger is a sentence of prose in `SKILL.md` ("authoring or
reviewing a skill ends with this folder's own check"), and prose stops
nobody: an agent that skips the run, or reads `FAIL` and proceeds, hits
no wall.

The writing-skills contract anticipates exactly this: "a consuming
project may enforce it from an end-of-turn hook, and the skill must
work where none exists." This library is that consuming project, and
the heartbeat is that end-of-turn hook.

## What the fixture freezes

A turn that committed into a skill folder whose own `check.sh` exits 1,
printing a `FAIL:` line. Everything else about the turn is healthy —
clean tree, pushed, summary current.

## Expected

Check `skill-check-green` fires: the turn's changed paths (commits
since turn start AND the dirty tree — the failure must surface before
the commit, not only after) map upward to the nearest directory
carrying a `SKILL.md`; each such folder's `check.sh <folder>` runs;
a non-zero exit blocks the turn, quoting the script's own `FAIL:`
lines verbatim as the reason.

The block repeats at every turn end until the script exits 0 — "run
once and carry on" is the defect, so re-execution is the contract.

Scope pinned by this kata: a failing check blocks. Whether a touched
skill folder with NO `check.sh` also blocks is a separate ruling
(coverage today is 1 of 10) and belongs to a second kata once ruled.
