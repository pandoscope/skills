# Comment rules

These rules hold for code comments and help text.

- `comment-register` [M] Keep a code comment to one or two sentences that give the reason rather than the mechanism.
- `call-site` [M] State a function's contract in its comment, and say why a caller uses it in a comment at the call site, so a change to one caller never leaves the function's comment stale.
