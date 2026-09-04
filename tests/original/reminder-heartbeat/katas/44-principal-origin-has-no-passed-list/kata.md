# The principal's own session sees no drift check

**Ruling:** D5 on [skills#179](https://github.com/pandoscope/skills/issues/179).
A principal-origin session has no spawner and no passed list — the
composer writes `passed: null` — so there is nothing to drift from.
The check passes on the file's own say-so rather than declining: it
looked, and found a session nobody spawned.

## What the fixture freezes

A clean turn with an answers file whose `passed` is null.

## Expected

The passed-tickets check passes, prints nothing, the turn seals.
