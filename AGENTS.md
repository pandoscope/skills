# Skills — Agent Guidelines

Repo: <https://github.com/frankify-app/skills>

## Project Specifics

### Terminology

Ubiquitous language is defined in docs/glossary/. Use

```bash
uvx disambiguate <term>
```

to get a topologically ordered glossary disambiguating all relevant terms
to understand the given term.

Before working on a ticket, run:

```bash
uvx disambiguate --from <ticket-file>
```

or for GitHub issues:

```bash
<tracker issue body> | uvx disambiguate --from -
```

to resolve all referenced terms at once.

### Architecture

Read [docs/architecture.md](docs/architecture.md) before touching any code.

## Rules

- Small, single-purpose files
- Prose (skills, ADRs, tickets, docs): as short as possible, prefer caveman mode — unless precision or understandability suffers
- Readability over brevity — straightforward, easy-to-follow code. No compact "one-liners" stretching across multiple lines (e.g. nested ternaries). Stretching across multiple lines is only allowed if it aids readability.
- All routes and non-trivial functions: docstring contracts (params, returns, errors)
- Test cases cover edge cases and every `@returns` line

### Errors

- Forward all errors with full detail + variable values, never swallow or catch, let exceptions propagate with their full traceback to make proper debugging possible
- Never catch exceptions if they are actual errors that can't be handled
- Include relevant variable values in error messages, e.g. for JS/TS:
  `"Failed to fetch peers for workspace_id=${workspace_id}: ${e}"`

## Skills

Live in `.agents/skills/`. Synced using `npx skills update -p -y` — don't edit skill files, add repo-local overrides in AGENTS.md
1% rule: if skill might apply, load it.

**Loading:** Use platform skill tool if available, else read `.agents/skills/<name>/SKILL.md` directly.

**Authoring (this repo only):** new skills go in `original/`, vendor derivations in `derived/` — follow the two-commit process in README.md "Adding a derived skill" (verbatim upstream copy first, derivation second).

| Skill                    | Trigger                                                                                            |
| ------------------------ | -------------------------------------------------------------------------------------------------- |
| `tdd`                    | Test-driven-development for any implementation                                                     |
| `documenting-decisions`  | Any implementation task — place `DECISION:` markers                                                |
| `requesting-code-review` | After completing implementation                                                                    |
| `caveman`                | Compact wording when writing prose (issues description, PR description, comments on repo or code)  |

## Git

- Branch: `<agent>/<issue-number>-<desc>` (e.g. `hermes/42-fix-auth`, `claude/42-fix-auth`)
- Never push to `main`
- Create PR immediately on branch creation
- Commits: conventional commits
- Document unexpected encounters and design decisions in commit message as well as PR/Issue

### Agentic Engineering Workflow

Interact with issues/PRs/CI via the tracker tooling available in your environment (per its own AGENTS.md/config). Workflow below names actions, not commands — no specific tracker CLI here (keeps repo tool-agnostic, prevents tooling leaking into synced skills).

The modes below are the kinds of work the user will ask for. **Each runs in its own session — possibly a different model or agent** (Review especially). Follow the named skills at each step.

#### Plan

- Explore the codebase. Flag `DECISION:SCOPE` when resolving ambiguities. Use the `documenting-decisions` skill (refs: `pre-approval-gate.md`, `scope-interpretation.md`).
- Write an issue; set metadata (labels/assignees/milestone).

#### Implement

- Read the given issue and comments.
- Do Test-Driven Development per the `tdd` skill.
- Implement the minimal code to pass tests, then the remaining code per the ticket spec. Place `DECISION:` markers per the `documenting-decisions` skill (refs: `decision-markers.md`, `marker-examples.md`).
- Commit discipline:
  - One test → one commit → one implementation for that test → one commit
  - `prek` must pass on every commit (lint/format hooks only — prek never runs unit tests).
  - TDD red-step commits are expected and required (a commit whose new tests fail but whose lint/format passes). **CI evaluates at PR HEAD, not per-commit**, so a red-step commit does not constitute a CI failure — do not treat it as one.
  - Don't fix lint manually — run the formatter. Only touch code directly if the tools can't resolve it.
- Push → `git push`
- Create the PR if not already present, and link it to the issue both ways (start with `Closes #<number>` in description; back-reference on the issue if needed). **If a PR already exists for this branch, do not create or re-link it** — skip to CI.
  PR body must include:
  - `Closes #<number>`.
  - Any obstacles that diverged from the initial plan, and — in the rare event spec deviation was unavoidable — what deviated and why.
  - All `DECISION:` markers present in the diff, rendered per the `documenting-decisions` skill format.
- Check CI (workflow runs; PR check rollup once the PR exists).
- If CI fails, fix it by re-entering this **Implement** workflow.

#### Review

- Read the given issue and comments.
- Review the PR and give Critical / Important feedback per the `requesting-code-review` skill.
- Submit as a single review: PR-level summary body + line-tied code comments together — don't split across a review and separate comments.

#### Apply Review Comments

- Read the given issue and comments.
- Read PR comments and code comments.
- If the review uncovers inconsistencies in the issue, **comment** on it freely.
- Only **edit** issue content when the user explicitly requests it. Editing is gated on explicit request because it can overwrite human-authored intent; commenting is always safe, editing is not.
- Then re-enter the **Implement** workflow.

## Dependencies

Add packages using the package manager only, never edit requirements/dependencies directly (since your knowledge cut-off prevents you from knowing the latest version of the packages).

## Documentation

- All non-trivial functions must have contracts in the function doc string
- Document all params, return shapes, and every possible error response
- Test cases must cover edge cases for inputs and every @returns line in the contract
- Non-trivial decisions or behavior should be documented via inline comments
