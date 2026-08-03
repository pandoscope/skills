# Work committed but never pushed

**Measured, 2026-08-03:** the platform already ships a Stop hook for
exactly this — the "commit and push" nag — and in a multi-repo session
it silently does nothing. Its first act is `git rev-parse` in cwd, and
cwd sits above every clone, so it is not a repo. The hook fires; the
check evaluates nothing; the turn ends looking checked.

That is this org's signature class one more time, and it is why the
heartbeat takes its repo root from the environment rather than from
cwd. A check whose silence is indistinguishable from a pass is worse
than no check at all, because the absent one at least does not claim
coverage.

## What the fixture freezes

A turn whose ledger event landed and whose summary is current, with a
clone carrying a commit that never reached its upstream — and the hook
invoked from a directory that is not a repo, the shape that defeated
the platform's own.

## Expected

Check 2 fires, naming the clone and the push that would clear it.
