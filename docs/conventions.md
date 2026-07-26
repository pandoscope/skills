# Skills — Project Conventions

Repo-specific rules referenced from [AGENTS.md](../AGENTS.md). This file is
seeded once by the agentic template and never overwritten by `copier update` —
edit it freely.

## Authoring skills

New skills go in `original/`; vendor derivations go in `derived/`. Follow the
two-commit process in README.md "Adding a derived skill" — verbatim upstream
copy first, derivation second — so the derivation is reviewable as a diff
against what upstream actually published.

## Keep tracker tooling out of authored skills

This repo publishes skills to every other repo, so anything naming a specific
tracker CLI can leak out through a `SKILL.md` and bind a consumer to tooling it
does not have.

Skills authored here name **actions, not commands** ("view the issue", not
`ghx issue view`). The rendered `AGENTS.md` does name `ghx`, because it is
template-owned and the template has no tracker-agnostic answer to select — see
frankify-app/agentic-engineering-template#68. That naming applies to how an
agent works *in this repo*; it must not propagate into the skills this repo
ships.
