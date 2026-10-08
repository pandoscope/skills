# Another hook's block hides nothing

**Rule (skills#242):** on a guarded fire the hook blocks on the first failing check whose reason was not delivered this turn.
An empty delivered set counts too.

## What the fixture freezes

`stop_hook_active` is true, but this hook's compliance log holds no `blocked` record for the turn: another Stop hook blocked first.
Two checks fail, `tickets-updated` and `response-hygiene`, and neither reason has reached the model.

## Expected

Exit 2 with the `tickets-updated` reason, cycle 1, no seal.
A hook that blocks again only after one of its own reasons was delivered releases this turn unsealed,
with both failures unheard.
