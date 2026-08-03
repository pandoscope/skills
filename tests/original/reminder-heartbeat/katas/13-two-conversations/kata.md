# A store that holds two conversations

**Incident:** 2026-08-03, preparing to run the heartbeat against the
real store for the first time. That store logs two conversations — the
orchestrator's and this session's — which is the shape its README
documents.

The heartbeat resolved its identity from the hook's `session_id`, a
platform-local id that matches no log in the store. With one
conversation recorded the tool falls back and gets the right answer by
luck. With two there is nothing to fall back to, so the seal would have
been written to a third log file named after an id nobody else uses:
a mark claiming this turn finished, filed where no reader looks.

The ledger's own rule already answers it — the conversation's URL is
the log's identity, and everything else is a fallback that says so. The
heartbeat cannot derive that URL, so it takes it from the environment,
exactly as it takes the store root. Guessing is what produced the wrong
file.

## What the fixture freezes

Two conversations in one store, and `LEDGER_SESSION_URL` naming which
one this turn belongs to.

## Expected

Exit 0, and the seal appended to the named conversation's log —
not to a third one.
