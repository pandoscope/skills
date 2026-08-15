---
name: writing-skills
description: >
  Write and edit agent skills that take the same process every run.
  Use when authoring a skill, editing or pruning an existing one,
  deriving a skill from an upstream source, or reviewing a change to a
  skill file.
metadata.derived-from: https://github.com/mattpocock/skills/blob/697d4ce9742da558fd1ba6697c8e9775e2e302dd/skills/productivity/writing-great-skills/SKILL.md
metadata.derivation-note: >
  Model-invoked (upstream is user-invoked) — agents here edit skill files
  unprompted, so a description is the only thing that reaches them.
  GLOSSARY.md split into glossary/ — one file per term, canonical name as
  the first heading, cross-linked by basename so the terms form a graph;
  terms a model already knows are dropped rather than defined. Adds a
  completion-criterion ladder, self-containment, derivation (verbatim
  baseline + pin, disclosed to deriving.md), baseline testing, audience
  drift, cold-verified invocations, sibling-reference discipline,
  environment-variable contracts, and handoff-carrying outputs.
  Condensed throughout.
metadata.token-budget-approved: 2500
---

# Writing Skills

A skill buys predictability: the same *process* every run, not the same output.

## Invocation

- **[Model-invoked](glossary/model-invoked.md)** — when the agent, or another skill, must reach this skill on its own. Paid in [context load](glossary/context-load.md).
- **[User-invoked](glossary/user-invoked.md)** — `disable-model-invocation: true`; paid in [cognitive load](glossary/cognitive-load.md). Once they outnumber what a human remembers, one user-invoked skill names the rest.

## Description

Triggers only — what fires the skill, rather than how it works.
The skill's scarcest budget: prune it harder than the body.

- Front-load the [leading word](glossary/leading-word.md). Invocation work happens there.
- One trigger per branch. Synonyms renaming one branch are the same trigger twice: "build features using TDD … asks for test-first development".
- Identity already stated in the body stays out.

## Information hierarchy

1. **Steps** in the skill file — ordered actions, the primary tier.
2. **Reference** in the skill file — rules and definitions consulted on demand. A flat peer-set is a fine arrangement.
3. **Disclosed reference** — pushed to a sibling file, reached by a [context pointer](glossary/context-pointer.md).

Each step names the mechanism that performs it — a command, a bundled file, or the installing project's own convention.
A step with no mechanism is a wish: the agent that reaches it invents one, differently each run.

Each step ends on a [completion criterion](glossary/completion-criterion.md).
Take the highest rung it can reach:

1. Machine-checkable — CI, a pre-commit hook, or a command the agent runs.
2. Agent-checkable against a concrete criterion.
3. Agent-checkable by interpretation.
4. User-checkable against a concrete criterion.
5. User-checkable by interpretation.

Where it matters, make the criterion exhaustive: "every rule applied", not "rules reviewed".
When a criterion is missed repeatedly, move it up a rung before rewording it.

Conditions take the same ladder.
"Absent from the preference set" can be checked; "no rule covers it" can only be judged —
phrase a branching condition as a predicate against a named source wherever one exists.

Disclose by branch: inline what every run needs, push out what only some runs reach.
A [context pointer](glossary/context-pointer.md)'s *wording*, not its target, decides how reliably the agent follows it — sharpen the wording before pulling material back inline.

One home per meaning, in either direction: the skill carries the instruction, the linked entry the explanation — never both. A sentence whose meaning the link already carries is [duplication](glossary/duplication.md).
Keep a rule's caveats beside it, so reading one part brings its neighbors.

## The check script

A skill ships `check.sh` beside its `SKILL.md`, and its last step runs it — the ladder, mechanized.

- Rung-1 criteria run directly; a failure exits non-zero naming what is wrong.
- Everything below rung 1 prints as the residue: what the agent still verifies, or what to hand the human. The residue is named, never remembered.
- [Self-containment](glossary/self-containment.md) binds the script too: it needs nothing outside the folder.

A skill cannot install a hook for this: hook registration is captured at CLI startup from settings a skill folder never reaches. The last-step invocation is the portable wiring; a consuming project may enforce it from an end-of-turn hook, and the skill must work where none exists.

Authoring or reviewing a skill ends with this folder's own `check.sh <skill-folder>`: it verifies mechanically that the skill under work carries its check script — present, executable, run by its `SKILL.md` — and prints the residue no script can check.

## Leading words

Hunt for passages that collapse into one [leading word](glossary/leading-word.md):

- "fast, deterministic, low-overhead" → *tight* — one quality restated across a phase.
- "a loop you believe in" → *red* — a fuzzy gate becomes a binary observable state.

## Splitting

- **By invocation** — a distinct leading word should trigger it on its own, or another skill must reach it. Pays context load for a new description.
- **By sequence** — to put [post-completion steps](glossary/post-completion-steps.md) behind a real context boundary. An inline call leaves them in context.
- **By agent role** — section inside one skill. Split only when the roles share almost nothing: a near-copy per role is [duplication](glossary/duplication.md) that also pays a second description.

## Pruning

- Hunt [no-ops](glossary/no-op.md) sentence by sentence. Delete the whole sentence rather than trimming words from it.
- Hunt [audience drift](glossary/audience-drift.md) the same way.
- State no fact an adjacent structure maintains. A count above a table is a second copy of the table, already drifting.
- Prompt the positive. A prohibition survives only as a [negation](glossary/negation.md) guardrail that cannot be phrased positively, paired with what to do instead.
- Instruct; give a reason only where the reason changes what the agent does. A paragraph defending the design argues with a reader who is already trying to follow it.
- Write compressed, using the `caveman` skill; if not available notify the principal.

## Token budget

1000 tokens is the default ceiling for `SKILL.md`. In exceptional cases the principal (not the agent) may authorize a higher budget through `metadata.token-budget-approved: <ceiling>` in the frontmatter, enforced by `check.sh`.

## Ship self-contained

[Self-containment](glossary/self-containment.md) bounds what a skill may name:

- Name no project-specific document paths. State the rule as a principle and use your own project as the worked example.
- Name no tool or CLI the installing project need not have — "view the issue", not a command.
- Reference other skills by name only, and write the reference to degrade: a named skill may be absent.
- The named skill keeps its own content. A sibling's format or taxonomy restated here is [duplication](glossary/duplication.md) that drifts on the sibling's next edit — and a claim about a sibling holds only if checked against the sibling before shipping.
- Keep cross-links resolving inside the folder, and invoke bundled files relative to this one: the folder's install path differs per project.
- An environment variable the skill reads is part of its contract. Name it, state the unset behavior, and document it where the installing project documents such variables.
- Self-containment cuts both ways: the folder ships verbatim, so anything inside it installs everywhere the skill does — build artifacts and caches included.

## Outputs that outlive the run

A comment, record or question the skill posts is read later — by a human, or by a session that does not have this skill.
The artifact itself carries what its reader needs: what the answer is for, where it goes next.
Guidance left in the skill reaches only the agent that ran it.

## Grading

Run the [baseline test](glossary/baseline-test.md) before writing the skill.
Every run where the skill went wrong becomes a scenario, and the set doubles as regression tests.
Record the agent harness and model version with each.

Keep scenarios outside the skill folder so they never ship with it.

Cold-verify every invocation the skill documents against the shipped tool — run it, or its help — from a directory the authoring session did not prepare.
A documented flag that does not exist fails every run at that step, and the skill's own fallback wording will disguise the failure as something else.
A capability that is merely planned is named as pending, with its tracker reference.

## Deriving from upstream

Vendoring someone else's skill is a branch most runs never take — see [deriving.md](deriving.md).

## Failure modes

Diagnose against these by symptom; each entry carries its own cure.

| Symptom | Failure mode |
| --- | --- |
| A step ends before the work is done | [Premature completion](glossary/premature-completion.md) |
| The same meaning stated in two places | [Duplication](glossary/duplication.md) |
| Live content buried under what nobody removed | [Sediment](glossary/sediment.md) |
| Long, though every line is live and unique | [Sprawl](glossary/sprawl.md) |
| A line the model already obeys by default | [No-op](glossary/no-op.md) |
| Lines the operating agent never acts on | [Audience drift](glossary/audience-drift.md) |
| The banned behavior shows up more, not less | [Negation](glossary/negation.md) |
