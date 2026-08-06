# A store URL in the outgoing diff

**Rule (skills#46, check 7):** the store URL values are secrets. They
are never committed and never echoed; failures name the variable,
never its value. The scan covers what is about to LEAVE — commits on
no remote, tracked changes a commit would sweep up, the rendered page
— because a term may legitimately live in env or scratchpad and must
only never leave.

## What the fixture freezes

An unpushed commit from an earlier stretch embeds the value of
`DECISION_MEMORY_URL` in a README line. The tree is otherwise clean,
nothing is declared this turn, and the pushed check would happily hand
over the push command for that commit — which is exactly why this
check runs before it.

## Expected

Blocked once, before any push instruction. The reason names the
SOURCE (`DECISION_MEMORY_URL`) and hands over a confirm command that
counts matches rather than printing them — the value stays out of the
transcript end to end.
