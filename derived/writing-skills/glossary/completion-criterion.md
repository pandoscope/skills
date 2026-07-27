## Completion Criterion

The condition telling an agent a unit of work is done.
Ranked by who can check it and how concretely: machine-checkable beats agent-checkable,
concrete beats interpretive.
The higher the rung, the more it resists [premature completion](premature-completion.md).
A second axis is how much it demands — "every modified model accounted for" against
"produce a change list" — which sets [legwork](legwork.md), and which binds a flat body of rules
as readily as a sequence of steps.

_Avoid_: done condition, exit condition, stopping rule
