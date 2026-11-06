# Comment examples

A code comment gives the reason behind the code,
and the mechanism a reader of the code alone would miss.
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

## A contract that opens with its history

Before:

```js
  // A WRITE proves its identity or refuses (skills#51). The fallbacks
  // below exist for reads — CI rendering a store it cannot know the
  // session of — but an append that guesses publishes the guess: the
  // append, the identity choice and the push are one action, so by the
  // time a warning prints, the store has already recorded events under
  // an identity that exists nowhere. Measured twice: once adopting the
  // store's recorded URL from a different conversation, once falling
  // back to the transcript filename.
```

After:

```js
  // A CLI append refuses to guess which conversation it writes under (the `--session-url` or `--session` a caller states),
  // because it pushes to the shared store in the same run:
  // a wrong guess would be published before the person running it could read any warning (skills#51).
```

The rule comes first, then the reason.
Every referent is named: which conversation, which store, whose warning.
What the ledger CLI does with the flag stays at its call site, so a change to the CLI leaves this comment true.
