## Audience Drift

*Failure mode.*
Content addressed to someone other than the agent mid-run:
design rationale for a reviewer, a defense of a bundled tool's implementation,
a description of what the rendered output looks like to its human reader.
The agent acts on none of it and pays [context load](context-load.md) for all of it.
Distinct from a [no-op](no-op.md), which addresses the right reader and changes nothing;
this addresses the wrong reader entirely.
Cure: move the material to the code or decision record it defends,
and keep only what changes the agent's next action.

_Avoid_: irrelevant content, reviewer notes, design commentary
