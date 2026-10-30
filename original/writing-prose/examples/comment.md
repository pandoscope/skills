# Comment examples

A code comment gives the reason rather than the mechanism,
in one or two sentences.
Each pair below starts from a real comment.

## A docstring that names its terms last

Before:

```python
"""Diff-scoped prose checks (#275).

A hunk whose removed and added lines hold the same word sequence
with different line breaks is a reflow.
...
A commit that changes the copier answers file is a template update.
It carries the upstream's reflows, so the reflow check skips it.
"""
```

After:

```python
"""Diff-scoped prose checks (#275).

A reflow is a hunk whose removed and added lines hold the same
word sequence with different line breaks.
...
A template update is a commit that changes the copier answers file.
It carries the upstream's reflows, so the reflow check skips it.
"""
```

## A header that tells its story twice

Before:

```bash
# The render ritual, argumentless (meta#68). A constant the model
# retypes every turn is a mutation site: one session drifted to
# rendering ledger-page.html while the heartbeat watched ledger.html,
# paying a double render+publish per turn. Every value here comes from
# session.env or the environment at run time, so nothing rides in
# conversational memory across compactions. Not a hook — a command the
# session runs by name, with nothing after it.
# Render the session ledger to the path the heartbeat watches. Zero
# arguments by design (meta#68): the model types this command and
# nothing else, so there is no path or URL left to misremember.
```

After:

```bash
# Renders the session ledger to the path the heartbeat watches.
# It takes no arguments (meta#68), because a value the model retypes
# each turn drifts; every value comes from session.env instead.
```
