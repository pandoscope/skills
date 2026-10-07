# Docs rules

These rules hold for every surface except chat: files, comments, commit messages and tracker text.

## Sentence shape

- `articles` [M] Omit articles only where the sentence still reads naturally and every referent resolves.
- `end-weight` [H] Put the main clause first, and let at most one reason, consequence or example trail it.
- `actor-subject` [H] Make the actor the subject, and keep config, fields and files as objects.
- `verb-distance` [H] Bring the verb within four words of its subject, with no clause between verb and complement.
- `relative-clause` [H] Open a relative clause with "that" or "which", or give it a sentence of its own.
- `first-mention` [M] Gloss a proper name or identifier at its first mention with what kind of thing it is.
- `referent` [M] Make every "the X" and "its" point to something named in the current or previous sentence.
- `known-new` [M] Open each sentence with what the previous one named, then add the news.
- `event-noun` [H] Write an event as a verb, never as a noun.
- `skimmable` [M] Open each paragraph with a sentence that stands alone, and let every later sentence lean on at most the one before it.
- `connect` [M] When a sentence gives the cause, consequence or exception of the one before, say so with a connective.
- `only-place` [H] Put "only" directly before the word it limits.

## Content

- `present-tense` [H] State the present, and leave history to commit messages.
- `removed-mention` [H] Erase every mention of a removed feature, and put migration notes in the commit's BREAKING CHANGE footer.
- `non-requirement` [H] State no non-requirement unless saying it simplifies the solution.
- `reader-scope` [M] Cut text the reader decides nothing with: rationale they cannot use and rejected alternatives.
- `pitch` [H] Cut pitch and value words.
- `store-id` [F] Name no private record id in public text, and state the reason in plain words instead.
- `shared-contract` [M] State a contract several things share once, then give each instance only its deltas.
- `keep-running` [M] When a failure does not stop the process, say why it must keep running, and put that reason in the code comment where the behaviour lives.
- `state-norm` [M] Before calling a behaviour wrong, state the intended behaviour it breaks.
- `list-cases` [M] Give parallel cases one list item each, with the effect first and its cause after it.

## References

- `consistent-term` [M] Give one thing one name throughout a text, and never use that name for a second thing.
- `drifting-ref` [H] Link a fact maintained elsewhere instead of restating it as a count, a far position or a section name, and drop a count that the list after it states, while adjacency words stay fine.
- `one-home` [M] Keep each fact in one place and reference it from everywhere else, and let a declared copy name its source and update path.
- `stated-once` [M] State each fact once within a text, and pair an effect with its cause instead of listing effects and causes apart.
- `glossary-vocab` [M] Use the project's glossary terms in titles, test names and interfaces.
- `ignore-hint` [M] Reword or link before suppressing a glossary finding, because a suppression is the last resort.

## Examples

Not: "The waybill order is the only receiver.
A fire of the waybill repository from an order branch carries it."

Yes: "The waybill order is the only receiver.
It arrives when the Routine fires from an order branch of the waybill repository."

The first version turns an event into a noun and hangs prepositional phrases on it.

Not: "The review policy denies read-only commands that redirect to `/dev/null`."

Yes: "The review policy allows output redirects only to `/dev/null`, but its redirect check denies some of them."

Under `consistent-term`, the rule and the code that enforces it take separate names, and only the code passes or denies.

Not: "It names a composed script that is missing on disk."

Yes: "The dispatcher prints the hook's path, skips it and runs the rest."

Under `precise-word`, say what the code does, not a label for its outcome.

Not: "A rendered file with no hook for an event is the role's choice."

Yes: "If the role's profile lists no hook for an event, the dispatcher exits 0."

Under `actor-subject`, a choice belongs to the artifact that encodes it, not to an abstraction.
Whole passages per register live in `examples/`.
