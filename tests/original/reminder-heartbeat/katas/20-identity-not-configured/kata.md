# The first turn of a session that has not named itself

Found by review (Fable, 2026-08-03) and measured. Nothing writes
`SESSION_URL` automatically — a session records it once it knows its
own URL, which cannot happen before its first turn ends. So the first
Stop of every fresh session runs with `LEDGER_SESSION_URL` unset.

With one conversation in the store that is harmless: the recorder falls
back to the single recorded `.url` and gets the right answer. With
**two**, which is the store's documented shape and its actual state
today, the fallback lands on the hook's `session_id` — a platform-local
id matching no log. Check 3 then compares this turn's declared threads
against events anchored to an id nothing ever writes, so it can never
pass. The turn blocks, the guard releases it unsealed, and the next
turn does the same. Forever, without progressing.

Worse, complying makes it permanent: `ledger append` in a two-log store
resolves its own identity by yet another route and writes a third log,
which still does not match.

The hook cannot invent the URL. What it can do is say so, instead of
failing as though the ledger were behind.

## What the fixture freezes

Two conversations in the store, `LEDGER_SESSION_URL` unset, and a turn
that did record its thread — so the only thing wrong is the identity.

## Expected

The hook names the missing configuration rather than blaming the
ledger, and the reason is one a session can actually act on.
