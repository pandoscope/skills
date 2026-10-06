# Tracker rules

These rules hold for issue bodies, pull request bodies and comments.

- `tracker-placeholder` [F] Write placeholders with guillemets, because the tracker strips angle brackets.
- `hard-wrap` [H] Write each paragraph or list item on one line, because the tracker renders every newline.
- `commit-link` [F] Link every commit you name, since a backticked hash is no link.
- `relative-link` [F] Link a repository file by its absolute URL, because the tracker resolves a relative link against the page, not the repository.
- `pinned-anchor` [F] Pin a link with a line anchor to a commit, because the lines on a branch move.
- `ungrilled` [F] Say in a ticket whether it was grilled.
- `ticket-code` [H] Keep file paths and code out of ticket prose, except a prototype snippet that encodes a decision.
- `ticket-short` [M] Keep ticket prose short, and write a bugfix as a spec correction, not a patch instruction.
- `existing-ticket` [M] Ask before rewriting an existing ticket, and fix violations in your new posts and say so.
