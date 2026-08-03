# Another conversation's event answering for this turn

Found by probing (2026-08-03). The turn declared `alpha` and appended
nothing. A *different* session, writing to the same store, had appended
to `alpha` inside this turn's window — and check 3 passed.

The fold reads every log in the store, which is right for rendering and
wrong for this question. Check 3 asks whether **this turn** recorded
what it did; an event another conversation wrote records what that
conversation did. Two sessions working the same thread would excuse
each other's bookkeeping, and the more active the store, the less the
check means.

The seal already carries the answer: every event is anchored to the
session that wrote it, so the window is narrowed by session as well as
by time.

## What the fixture freezes

Two conversations in one store. The declared thread's only in-window
event belongs to the other one.

## Expected

Check 3 fires. The thread has been touched — just not by this turn.
