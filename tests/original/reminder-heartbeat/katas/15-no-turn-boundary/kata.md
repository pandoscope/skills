# The transcript the hook was handed is not there

Found by probing (2026-08-03). With no readable transcript there is no
newest user turn, so there is no turn boundary — and two checks quietly
became weaker rather than unavailable.

Check 1 skips its freshness test, because there is nothing to compare
the summary's mtime against: a summary an hour old passed. Check 3
widens its window to all of history, so any event ever recorded for a
declared thread satisfies this turn. Both reported **pass**.

That is the shape this whole mechanism exists to remove, produced by
the mechanism itself. A check that could not run must never be recorded
as one that ran and found nothing wrong.

## Why this blocks rather than reporting `unconfigured`

An unset `HEARTBEAT_REPO_ROOT` is a deployment choosing not to run
check 2, and `unconfigured` says exactly that. A missing transcript is
different: the platform always supplies the path, so its absence means
something is broken, and the hook cannot do the job it was registered
for. The precedent is already set by a crashed heartbeat, which blocks
rather than exiting 0 — silence indistinguishable from a pass is the
failure being designed out.

## What the fixture freezes

A summary from an hour before the turn, and a `transcript_path` that
does not exist.

## Expected

Check 1 fires, naming the transcript. It does not pass, and it does not
pretend the turn was verified.
