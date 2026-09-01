---
name: take-probe
description: >
  Execute a checked-in probe fixture in this session. Use when a
  message asks to use take-probe with a reference, or hands this
  session a probe dir to execute.
---

# Take Probe

Observed side of a session probe: this session is the test body, the
fixture is the whole task. A fixture carries its own constraints —
this skill adds none.

## Steps

1. Resolve the reference (checkout-relative dir) against the session
   root; read `<ref>/probe.md`. Missing → report it in the failure
   shape `check.sh` prints, and stop. Done when the fixture text is
   loaded.
2. Follow `probe.md` verbatim, constraints included. Done when the
   fixture's own completion condition is met.
3. End with the report the fixture asks for as the last message.
4. Run `check.sh` beside this file.

Guardrails are added here only with a probe run that showed the need.
The evidence lives in the commit that adds the rule and on its
ticket, never in this file — skills are public, and carry no session
ids or run narratives. `git log` on the rule reaches its evidence.
