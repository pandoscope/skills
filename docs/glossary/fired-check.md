## Fired check

The failing check whose reason the [heartbeat](heartbeat.md) showed the agent when it blocked a Stop.
At the next [cycle](cycle.md) of the same [turn](turn.md), the fired check is cleared if it passes.
It is ignored if it fails again.
With no next **cycle** it counts as neither.
