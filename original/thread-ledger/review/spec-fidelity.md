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

Write `reviews/spec-fidelity-<tier>/findings.json` in the clone.
The Write tool creates the directory.
The file holds one JSON object:

- `pr`: `<repo>#<n>`
- `head`: `<head>`
- `pass`: `spec-fidelity`
- `tier`: `<tier>`
- `findings`: an array, empty when you found nothing.
  Order it by severity, worst first.
  Each finding is an object:
  - `file`: the path in the pull request
  - `line`: an integer, at the head commit
  - `rule`: the verbatim specification sentence
  - `input`: the input that shows the departure
  - `finding_basis`: `decided` when the specification decides the case, `judged` otherwise
  - `confidence`: 0 to 100
  - `finding`: one sentence

Then commit and push the findings:

```sh
git add reviews/spec-fidelity-<tier>
git commit -m "chore(review): spec-fidelity <tier> findings for pr<n>"
git push -u origin claude/review-spec-fidelity-<tier>-pr<n>
```

When done, reply with at most three lines.
