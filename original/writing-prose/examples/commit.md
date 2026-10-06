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

## A fix that opens with the change

Before:

```text
No clone carried a pre-commit hook, so `.pre-commit-config.yaml` ran only by hand or in CI. On [meta!148](https://github.com/pandoscope/meta/pull/148), a codespell failure surfaced first in CI.

`install-deps.sh` now runs `prek install` in every repo with a pre-commit config. `setup.sh` runs that script for each clone at init, which includes the stores: they are harness clones in the session root. ensure-repos runs it for a clone it makes at session start. A repo without a config is left alone. A failed install and a missing prek are reported on stderr, and the exit status stays the dependency installer's.

ensure-repos keeps the installers' output out of the session, as before. It now relays each line of the script that names prek, so a failed install on a late clone reaches the session too.
```

After:

```text
A repo's pre-commit hooks should run at commit time, but until now
they ran only in CI or by hand. `install-deps.sh` now runs
`prek install` in every repo with a `.pre-commit-config.yaml`, at
both moments a clone appears:

- at init, `setup.sh` runs it for each clone, the stores included;
- at session start, ensure-repos runs it for each clone it makes.

`install-deps.sh` reports a missing prek or a failed `prek install`
on stderr, but continues and exits with the status of the dependency
install, because the repo's tooling runs without hooks but not
without its dependencies. ensure-repos still discards the output of
`install-deps.sh` on stdout and stderr, with one exception: it now
relays each stderr line containing the string "prek", so a failed
install on a late clone reaches the session.

[meta!148](https://github.com/pandoscope/meta/pull/148) showed the
gap: a codespell failure there surfaced first in CI.
```

A fix opens with the intended behaviour and what went wrong, and its evidence closes the body.
Each stream ensure-repos handles is named, and the reason the script continues is stated.
