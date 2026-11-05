# Comment rules

These rules hold for code comments and help text.

- `comment-register` [M] Give the reason behind the code and the mechanism a reader of the code alone would miss, such as what a term means, and leave out what the code already says.
- `rule-first` [M] Open a comment on a contract with the rule, then name the callers or cases it applies to, then give the reason.
- `call-site` [M] State a function's contract in its comment, and say why a caller uses it in a comment at the call site, so a change to one caller never leaves the function's comment stale.
