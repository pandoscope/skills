# The stale tracking ref that made main look like a merge

**Incident:** 2026-09-04, probe `spawn-r1b1` on
[skills#185](https://github.com/pandoscope/skills/issues/185). The
fired session's disambiguate clone sat on the harness's session
branch, created at the fresh tip of main. Its `origin/main` tracking
ref was older, so `--merges HEAD --not origin/main` returned the
forge's own merge — the very commit that IS main on the remote — and
the hook told a probe to rebase a clone it had never touched.

## What the fixture freezes

A clone on a `claude/*` branch whose tip is a merge commit the bare
origin's main holds, with the local `origin/main` ref moved back to
the seed. No commit this turn.

## Expected

The check refreshes the base for the one suspect clone before judging
and finds nothing to report. The turn seals.
