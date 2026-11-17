## Sweep

The pass that finds information held only in the current context of an [agent session](agent-session.md) and persists it, in tickets, docs or the session-memory store.
The handing-off skill's second run performs the sweep before it publishes the handoff.
Each finding goes under the heading "Persisted" in the handoff, with a link to where it went.
A sweep that finds nothing records the single item "none".
Unlike the [finish-first list](finish-first-list.md), which names work, the sweep moves information.
