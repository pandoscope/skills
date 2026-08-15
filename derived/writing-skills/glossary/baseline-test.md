## Baseline Test

Running a skill's scenario against an agent that does *not* have the skill, before writing it.
Whatever the agent already does is the default the skill must beat;
rules that merely restate it are [no-ops](no-op.md) that would otherwise ship undetected.
The agent harness and model version are part of the scenario:
both move the default, so results are comparable only against a recorded pair.

_Avoid_: control run, A/B, benchmark
