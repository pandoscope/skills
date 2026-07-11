# skills

Canonical agent skills repo. Single source of truth — consumer repos install copies via `npx skills`, never edit skills locally.

## Layout

```text
original/   # own skills, authored here
derived/    # condensed vendor derivations, pinned via metadata.derived-from
docs/       # architecture + glossary (ubiquitous language)
tests/      # pressure scenarios and fixtures, never shipped
```

## Installing

From a consumer repo:

```sh
# list available skills
npx skills add frankify-app/skills --list

# install selected skills (project scope, Claude Code)
npx skills add frankify-app/skills --skill documenting-decisions -a claude-code -y


# restore on a fresh clone
npx skills experimental_install

# update
npx skills update -p -y
```

## Rules

- Edit skills here only. Local copies in consumers get overwritten on update.
- As short as possible — prefer caveman mode (`derived/caveman`) for skills, ADRs, tickets, docs. Hard limit: precision and understandability must not suffer.
- Skills stay tool-agnostic: no consumer-repo tooling (tracker CLIs etc.) hardcoded — defer to consumer's AGENTS.md conventions.
- Descriptions state triggers only ("Use when ..."), never workflow.
- Test artifacts live in `tests/`, never inside skill folders. Fixture manifests are named `SKILL.fixture.md` so discovery ignores them.

## Adding a skill

1. `original/<name>/SKILL.md` — frontmatter `name` (matching the folder, letters/numbers/hyphens only) + `description`.
2. Keep SKILL.md short; split heavy reference into separate files inside the skill folder.
3. For discipline-enforcing skills: baseline-test against an agent without the skill first; scenarios go in `tests/<name>/`.
4. Consumers pick it up via `npx skills add frankify-app/skills --skill <name>`.

## Adding a derived skill

1. Copy the original skill folder into `derived/<skill-name>/`
2. Commit the skill in original condition, verbatim — its own commit, e.g. `chore(<skill-name>): copy upstream skill verbatim`, so the derivation stays diffable against upstream
3. Add `metadata.derived-from: [info] <full commit URL>` from the original repo into frontmatter (To update: diff pin against upstream HEAD, fold changes into derivation, bump pin)
4. Edit the skill and commit the derived version separately
