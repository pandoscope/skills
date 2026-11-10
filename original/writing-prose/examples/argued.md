# Argued examples

Docs and tracker text argue a case.
Each pair below starts from real prose and rewrites it under the rules:
the claim opens the paragraph,
the main clause comes early,
and a connective states how each sentence follows from the one before.

## A process in five short sentences

Before:

```text
Hook runs between ensure-repos and composer.
It reads the `checkouts:` block of the order.
For each repository named there, it switches that clone to the listed ref.
It skips a clone with local changes and says so.
It never touches the waybill clone.
```

After:

```text
The hook runs between ensure-repos and the composer
and switches each clone that the order's `checkouts:` block names to the ref listed there.
It skips a clone with local changes and says so,
and it never touches the waybill clone itself.
```

## A definition that names its term last

Before:

```text
**reflow-guard** (commit-msg): a hunk whose removed and added lines hold the same words with different line breaks is a reflow. It fails unless the subject is a `style:` commit. Comment markers are stripped first, so a rewrapped code comment counts. A commit that changes `.copier-answers.agentic.yml` is a template update, so its upstream reflows pass.
```

After:

```text
**reflow-guard** (commit-msg): fails a commit that reflows lines, unless its subject is a `style:` commit. A reflow is a hunk that keeps the same words with different line breaks. The script strips comment markers first, so a rewrapped code comment counts. The guard skips template updates, which change `.copier-answers.agentic.yml` and carry the upstream's reflows.
```

## Three causes in the same shape

Before:

```text
Three rules cause it together. `one-fact` splits every reason into a sentence of its own. `skimmable` makes every sentence stand alone, so connectives such as `so` and `but` disappear. `flat` reads as a ban on any subordinate clause.
```

After:

```text
Three rules cause it together. Under `one-fact`, every reason becomes a sentence of its own, and because `skimmable` makes each sentence stand alone, connectives such as `so` and `but` disappear. `flat` then reads as a ban on any subordinate clause.
```

## A rule and the code that enforces it, under one name

Before:

```text
The review policy denies read-only commands that redirect to `/dev/null`. The redirect check reads the redirect target up to the next space. So the check reads `2>/dev/null;` as writing to `/dev/null;`. It misreads the target the same way when `|`, `)` or `&&` follows with no space. The policy also denies `&>/dev/null` before it applies the `/dev/null` exception. In both sonnet reviews of pandoscope/skills#230, the policy denied calls that should have passed.
```

After:

```text
The review policy allows output redirects only to `/dev/null` in review sessions, but its [redirect check](https://github.com/pandoscope/skills/blob/bad438c5ac69e01eebef31f27bd0c0552e0dc524/original/thread-ledger/review/policy.mjs#L319-L331) enforces it wrongly:

* denies `&>/dev/null` -> tests for the `&>` operator before it applies the `/dev/null` exception.
* denies `;`, `|`, `)` or `&&` directly after `/dev/null` -> reads the target up to the next whitespace, so it reads `2>/dev/null;` as a write to a file named `/dev/null;`.
* passes `>&file`, which writes a file -> skips every operator followed by `&`, not only descriptor duplications such as `2>&1`. [pandoscope/skills#241](https://github.com/pandoscope/skills/issues/241) tracks this reverse flaw.

Both Sonnet reviews of [pandoscope/skills#230](https://github.com/pandoscope/skills/issues/230) hit the two denials.
```

The policy names what is allowed and the check names the code, so only the check passes or denies.
Each item gives one flaw as its effect, then its cause.
