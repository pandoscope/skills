## Finish-first list

The checkbox list of work that must be settled while the current context of an [agent session](agent-session.md) still exists.
The handing-off skill's first run writes it into the handoff draft, under the heading "Finish first".
Each item names its owner, the model or the principal.
The list is settled when every item is ticked and names its owner first, and every postponed item names its trigger.
The skill's list check decides whether it is settled.
Work that the next context can do belongs in the handoff's open-state table instead.
