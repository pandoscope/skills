# A root that is set and wrong

Found by review (Fable, 2026-08-03) and measured. `HEARTBEAT_REPO_ROOT`
pointing at a path that does not exist made check 2 report

```text
{"check":"pushed","verdict":"pass","detail":"0 clones committed and pushed"}
```

A typo filed as health, in the log built to tell those apart. The
`unconfigured` verdict exists for exactly this and was unreachable: it
fires only when the variable is *unset*, which is the case someone
chose deliberately. Set-and-wrong is the case nobody chose, and it is
what a config edit actually produces.

`SESSION_MEMORY_ROOT` set wrong is the same mistake with a worse
ending: the recorder creates a fresh ledger tree at the phantom path
and seals into it, so the real store grows unsealed tails while every
turn reports success.

Neither is a check finding nothing wrong. Both are a check that never
ran, and the difference has to survive into the log — that log is the
evidence for whether any of this changes behaviour, and a pass it did
not earn is a data point that lies.

## What the fixture freezes

A repo root naming a directory that is not there.

## Expected

Check 2 reports `unconfigured`, naming the path, and the turn is not
recorded as one where the clones were examined and found clean.
