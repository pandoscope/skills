# A shallow graft reads as divergence, and the advice would destroy work

**Incident:** orchestrator session, 2026-08-15
(session_014CUXJh1hKmW4ccUwRQ1Ep1), ticket
[meta#86](https://github.com/pandoscope/meta/issues/86). SessionStart
reported the session-memory checkout "could not fast-forward (diverged
or offline) — left as is". The measured state behind the warning:
ahead 51 / behind 60, **no common ancestor** — because the clone was
shallow and the graft had cut the history. One
`git fetch --unshallow` dissolved the whole picture to ahead 1 /
behind 516, the 1 being the session's own append. The divergence was
fictional.

Two failures share the fixture. The false "diverged" trains its
reader to ignore divergence warnings — absence-as-success, inverted.
And the standing reconcile advice (`merge --ff-only`, adopt the
remote) applied to a graft hiding genuinely local commits would have
discarded them; this is the third sighting of that advice being wrong
against a measured state.

## What the fixture freezes

A shallow store clone whose grafted local branch shares no ancestor
with origin's, while the true (unshallowed) relationship is
ahead-one/behind-many.

## Expected

The check deepens before judging: "diverged" is reported only when a
common ancestor exists and both sides genuinely forked. Advice is
computed from the measured state — ahead-only says push, behind-only
says fast-forward, a true fork names the fork point — and never
recommends a move that loses local commits. A graft unresolvable
offline reports "shallow — cannot judge", which is an answer, not a
warning to ignore.
