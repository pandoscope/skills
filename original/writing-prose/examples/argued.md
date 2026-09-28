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
