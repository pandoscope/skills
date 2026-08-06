# An unlinked ref in the response

**Rule (skills#99):** tickets and PRs in prose are linked shortcode
refs — `XXX#n` for tickets, `XXX!n` for PRs, each a markdown link to
the page its sigil implies. A bare `skills#97` in the response is the
right vocabulary missing its link.

## What the fixture freezes

A clean turn in every other respect — committed, pushed, nothing
declared — whose final response says `skills#97` as plain text. The
store carries a shortcode map, so the check is configured.

## Expected

Blocked once, and the reason is the exercise: it names the offending
token, why it is wrong, and the exact canonical form the rewritten
response must contain verbatim.
