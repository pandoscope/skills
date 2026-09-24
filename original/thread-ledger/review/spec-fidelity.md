# Review task: spec-fidelity

The task of a `pass: spec-fidelity` review (skills#195). A waybill
order with `role: reviewer` fires the session. The composer takes the
block below, replaces `<tier>` and `<n>` from the order, and renders
it into the session's CLAUDE.md. Every Routine saves the same
one-sentence prompt, which carries no data.

The constraints are not in the task. The review driver
(`../review-driver.mjs`) reads the same order. It denies every call
outside the read-only policy before the call runs. It refuses to end
the session until the order's tickets were read and the findings are
committed and pushed. The task only says what to do.

```text
# Task

You are a reviewer of pull request <repo>#<n>: base branch `<base>`, head commit `<head>`. Its repository is cloned under your working directory. The tickets are <tickets>.

Stage the review with git and the GitHub read tools, in that clone:

1. Read the pull request body with the GitHub pull request read tool. Then `git fetch origin <base>` and `git fetch origin pull/<n>/head:refs/remotes/origin/pr-<n>`; `origin/pr-<n>` must be `<head>`.
2. `git switch -c claude/review-spec-fidelity-<tier>-pr<n> origin/pr-<n>` — the files on disk are now the pull request's head.
3. `git diff origin/<base>...HEAD` is the change under review. Read every ticket above with the issue read tool, and every further ticket the body references (CLOSES, FIXES, ADVANCES).

Read every changed file in full at the head commit before judging it.
Read a large file in successive ranges until you reach its end.

The specification is the ticket text plus the scope the pull request body states.
Review the change against it on the following axes:
behaviour the specification requires that is missing,
behaviour the specification does not ask for,
and behaviour that looks implemented but is wrong.
Report only what the specification decides.
Judge by reading the code.
The findings file below is your only output.

Every finding names a concrete input on which the change departs from the specification.
It quotes, verbatim, the sentence of the ticket or the pull request body that the change violates.
It states the departure, not a fix.

# Output contract

Write `reviews/spec-fidelity-<tier>/findings.json` in the clone (the Write tool creates the directory; `mkdir` is not a read command and is refused): a JSON object with `pr` (`<repo>#<n>`), `head` (`<head>`), `pass` (`spec-fidelity`), `tier` (`<tier>`) and `findings`, an array, empty when you found nothing, of objects with `file` (path in the pull request), `line` (integer, at the head commit), `rule` (the verbatim specification sentence), `input` (the input that shows the departure), `tier` (`hard` when the specification decides the case, `judgment` otherwise), `confidence` (0 to 100) and `finding` (one sentence). Order by severity, worst first.

Then commit and push the findings, and nothing else:

    git add reviews/spec-fidelity-<tier>
    git commit -m "chore(review): spec-fidelity <tier> findings for pr<n>"
    git push -u origin claude/review-spec-fidelity-<tier>-pr<n>

When done, reply with at most three lines.
```
