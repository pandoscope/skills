# The block's command comes from the open checkout

**Incident class:** the other arm of skills#72's tie-break. With two
checkouts and the recorder open in one, a block that read the WRONG
checkout's state would offer `record.py open` — and `open` mints a new
session branch every time it runs, stranding the records committed on
the branch it replaces. A reminder whose own command loses work.

## What the fixture freezes

A marker committed this turn; the repo-root checkout with no recorder
state; a workspace twin with the recorder session open; no record
anywhere.

## Expected

The block stands — the record is genuinely owed — and its command is
read from the workspace checkout, where the session is open: `record`
alone, no `open`, and the path is the open checkout's.
