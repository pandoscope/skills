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

## A feature that stated its mechanism as labels

Before:

```text
feat(environment): dispatch the composed role's hooks per event

The CLI captures hook registration at startup. So setup.sh registers
~/.claude/reinset-hook.sh once for PreCompact and once for the
post-compaction SessionStart, in place of the two handing-off shims.
pandoscope compose renders the file that the dispatcher reads at every
fire. REINSET_HOOKS names that file and is pinned through session.env
beside REINSET_ANSWERS.

The dispatcher passes stdin through and returns the first non-zero
exit. It names a composed script that is missing on disk. While no
file exists, it blocks compaction, so a session without a guard is
gated rather than silently unguarded.
```

After:

```text
feat(environment): dispatch the composed role's hooks per event

The session composer, `pandoscope compose`, sets up the hooks that the
session's role lists in its profile. But until now it could not register
them: the CLI captures hook registration at startup, before the composer
runs, so setup.sh registered two fixed handing-off shims instead. With
this commit, setup.sh now registers one dispatcher,
`~/.claude/reinset-hook.sh`, for the CLI's hook events PreCompact, which
fires before the CLI compacts the conversation, and SessionStart with
the matcher `compact`, which fires right after it. The composer renders
the role's hooks into a hooks file, and the dispatcher reads that file
at every fire.

The environment variable REINSET_HOOKS holds the path of that file.
setup.sh always writes its assignment to `~/.claude/session.env` as a
default, `${REINSET_HOOKS:-$HOME/.claude/reinset/hooks.json}`. The
dispatcher sources that file at every fire, so a REINSET_HOOKS that
the session's environment already sets keeps its value, and otherwise
the default applies. REINSET_ANSWERS works the same way.

The dispatcher passes stdin to each hook of the event and exits with the
first non-zero status. If a hook's script is not executable, for example
because it was removed after the composer ran, the dispatcher prints the
hook's path, skips it and runs the rest, as the composer leaves out a
missing script when it renders the file. The skipped hook does not
change the exit status, so a missing guard script lets compaction
proceed.

Without a hooks file, for example in a session that no waybill order
reached, the dispatcher acts only around compaction:

- PreCompact blocks, so a session without a handoff guard is gated
  rather than silently unguarded; PRECOMPACT_GUARD=off overrides.
- The SessionStart after compaction tells the session that no
  handoff verification ran.

If the role's profile lists no hook for an event, the dispatcher exits
0, so a role whose profile lists no PreCompact hook compacts without a
guard.
```

The body opens with whose job it is and why it could not be done until now.
Each behaviour says what the code does, and each proper name is glossed at its first mention.
The reason a skipped hook keeps the dispatcher running belongs in the dispatcher's own comment.

## Results that used undefined lab terms

Before:

```text
test(dojo): falsifier verdicts for skills!230, two passes

Both opus passes agree on all eight findings:
one confirmed (spec-fidelity opus: cross-document H rules went unjudged),
two refuted, five behaviour-only.
The five are prose findings.
The falsifier judges against the specification, so a correct prose finding reads as behaviour-only.
```

After:

```text
test(dojo): falsifier verdicts for skills!230, two passes

The falsifier is the step that tests each review finding against the
specification of the reviewed change. It gives each finding a verdict:
confirmed, refuted or behaviour-only. A behaviour-only finding describes
real behaviour that the specification neither requires nor forbids. This
commit adds the falsifier's verdicts on the eight findings that the
review passes made on skills!230. A review pass, such as prose or
spec-fidelity, runs once per model tier, so prose-opus names the prose
pass on opus.

map.json names each finding F001 to F008 and maps it to its pass and
tier, and the list at the end says what each one found. Two falsifier
passes on opus, in verdicts.json and verdicts-r2.json, agreed on every
verdict:

- confirmed: F008;
- refuted: F005 and F007;
- behaviour-only: F001 to F004 and F006, all from the prose pass.

The behaviour-only findings are correct: each describes a real flaw in
prose.md, the prose pass's instructions. The falsifier judges them
against skills#221, which specifies what the prose pass must do but not
how prose.md words it, so a correct prose finding reads as
behaviour-only.

Findings:

- F001 (prose-opus): prose.md says twice that the fully checked (F)
  rules go unreported.
- F002 (prose-opus): it says twice that each finding quotes its rule
  verbatim.
- F003 (prose-opus): its opening copies the one in spec-fidelity.md
  without naming the source.
- F004 (prose-opus): it calls the candidates that check.sh prints
  "hits", while writing-prose calls them candidates.
- F005 (prose-opus): the tier glosses added to writing-prose's SKILL.md
  are sentences the model obeys without them.
- F006 (prose-sonnet): the same as F004.
- F007 (spec-fidelity-haiku): prose.md's "confirm or reject each H hit"
  departs from skills#221's "each H candidate".
- F008 (spec-fidelity-opus): prose.md never has the reviewer judge the
  heuristic (H) rules that span documents, which skills#221 requires.
```

Each lab term is glossed at its first mention, and the lab's "cell" gives way to the glossary's review pass and model tier.
The findings list repeats what the data files hold, which a commit may do as a snapshot.
