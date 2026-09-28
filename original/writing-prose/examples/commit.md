# Commit examples

A commit body argues briefly after its subject:
what changed, then why it matters.
Each pair below starts from a real commit body.

## Results listed cell by cell

Before:

```text
The prose cell holds no findings.
The spec-fidelity cell holds one finding and one correct denial of git merge.
map.json maps the eight blinded findings of all six cells back to their cells.
```

After:

```text
Haiku's prose cell holds no findings, while its spec-fidelity cell
holds one finding and one correct denial of `git merge`. With these,
all six cells are in, so map.json maps the eight blinded findings
back to their cells.
```

## A measurement told in a row of facts

Before:

```text
The cell comes from claude/review-spec-fidelity-haiku-r2-pr196 at 07d9346.
The driver now lets haiku read a persisted tool result.
Haiku read all four changed source files whole and reported no findings.
On the same pull request, sonnet made three findings, and all three held.
The driver denied one call, the mkdir that the prompt itself asks for.
The diff reached haiku whole this time,
so the empty result measures the tier and not the driver.
```

After:

```text
Haiku ran on the fixed driver, which now lets it read a persisted
tool result. It read all four changed source files whole and still
reported no findings. On the same pull request, sonnet made three
findings, and all three held. Because the diff reached haiku whole
this time, the empty result measures the tier rather than the driver.
The driver denied one call, the mkdir that the prompt itself asks for.
```
