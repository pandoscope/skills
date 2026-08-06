# A blocklist term in the rendered page

**Rule (skills#46, check 7):** `PUSH_BLOCKLIST` is the user-supplied
half of the scan — |-separated terms, optional by design. The rendered
page is outgoing content: it gets published to an artifact URL, so a
term reaching it is a term leaving.

## What the fixture freezes

Clean repos, nothing declared — and a rendered page whose text carries
the second blocklist term. The scan's hit is the page, not any diff.

## Expected

Blocked once. The reason names the term by POSITION
(`PUSH_BLOCKLIST term 2`), never by value, and the confirm command
counts matches in the page rather than printing the line.
