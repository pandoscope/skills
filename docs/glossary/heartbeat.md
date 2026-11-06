## Heartbeat

The thread-ledger Stop hook, `heartbeat.mjs`, which checks a finished [turn](turn.md) against observed state: files on disk, git and the ledger log.
Each time the agent tries to stop, it either records the **turn** as finished or blocks the Stop with the reason of one failing check, up to three times per **turn**.
