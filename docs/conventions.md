# Skills — Project Conventions

Repo-specific rules referenced from [AGENTS.md](../AGENTS.md). This file is
seeded once by the agentic template and never overwritten by `copier update` —
edit it freely.

## Authoring skills

New skills go in `original/`; vendor derivations go in `derived/`. Follow the
two-commit process in README.md "Adding a derived skill" — verbatim upstream
copy first, derivation second — so the derivation is reviewable as a diff
against what upstream actually published.

## Each authored skill is self-contained on its own

A skill is installed individually, into a repo that may not use
`disambiguate` or any other tool this repo assumes. The unit of
self-containment is the skill's **folder**: everything in it ships
together (`derived/tdd/` brings `tests.md` and `lint-red.sh` with its
`SKILL.md`), and nothing outside it ships alongside. So in
`original/` and `derived/`:

- **No glossary term references** — in a consumer the link dangles or
  drags a term into a repo that has nothing to do with it. Teaching a
  format is fine: `domain-modeling` showing `[Customer](customer.md)`
  is content about the syntax, not a live cross-reference.
- **No tracker CLI names** — "view the issue", not `ghx issue view`.
- **Skill-to-skill references are name-only** and best-effort: `npx
  skills` has no dependency management, so a referenced skill may be
  absent. Write them to degrade ("if the `tdd` skill is available…").
  Revisit if the installer ever ships dependencies.

The rendered `AGENTS.md` does name `ghx`, because it is template-owned
and the template has no tracker-agnostic answer to select (see
frankify-app/agentic-engineering-template#68). That governs how an
agent works *in this repo*; it must not propagate into shipped skills.
