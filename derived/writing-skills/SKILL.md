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
  the first heading, cross-linked by basename so the terms form a graph.
  Adds four axes upstream does not model: enforcement boundary,
  self-containment, derivation (verbatim baseline + pin), baseline
  testing. Condensed throughout.
---

# Writing Skills

A skill buys **predictability**: the same *process* every run, not the same output.
Every rule below is a lever on it.

Terms in **bold** are defined one-per-file in `glossary/`.

## Invocation

Two shapes, two costs.

- **Model-invoked** — keeps `description`. The agent fires it on its own and other skills can reach it. Costs **context load**: the description is resident every turn.
- **User-invoked** — `disable-model-invocation: true`. Zero context load, paid in **cognitive load**: the human is the index.

Take model-invoked when the agent must reach the skill unprompted, or another skill must reach it.
Otherwise user-invoked.

User-invoked skills past what a human remembers → a **router skill** naming them and when to reach for each.

## Description

Triggers only — what fires the skill, never how it works.

- Front-load the **leading word**. Invocation work happens there.
- One trigger per **branch**. Synonyms renaming one branch are **duplication**: "build features using TDD … asks for test-first development" is one branch written twice.
- Identity already stated in the body stays out.

The description loads whether or not the skill ever runs, so it earns harder pruning than the body.

## Information hierarchy

Three rungs, ranked by how immediately the agent needs the material:

1. **Steps** in the skill file — ordered actions, the primary tier.
2. **Reference** in the skill file — rules and definitions consulted on demand. A flat peer-set (every rule of a review on one rung) is a fine arrangement.
3. Disclosed reference — pushed to a sibling file, reached by a **context pointer**.

Each step ends on a **completion criterion**.
Make it checkable (can the agent tell done from not-done?) and, where it matters, exhaustive —
"every modified model accounted for" beats "produce a change list".
Checkable resists **premature completion**; demanding drives **legwork**.
The demand axis binds flat reference too: "every rule applied".

**Progressive disclosure** splits by branch — inline what every branch needs, disclose what only some reach.
A pointer's *wording*, not its target, decides how reliably the agent reaches the material.
Sharpen wording before pulling material back inline.

**Co-location** decides what sits beside a piece once its rung is settled:
definition, rules and caveats under one heading, so reading one part brings its neighbors.

## Leading words

A **leading word** is a compact concept already in the model's pretraining that the agent thinks with —
*tracer bullet*, *fog of war*, *blast radius*, *red*.
Repeated as a token, it accumulates a distributed definition and anchors a region of behavior in the fewest tokens.

Hunt for passages that collapse into one:

- "fast, deterministic, low-overhead" → *tight* — one quality restated across a phase.
- "a loop you believe in" → *red* — a fuzzy gate becomes a binary observable state.

Assume every skill carries restatements a leading word retires.

## Splitting

Two cuts earn a skill's **granularity**:

- **By invocation** — a distinct leading word should trigger it on its own, or another skill must reach it. Pays context load for a new description.
- **By sequence** — **post-completion steps** tempt the agent to rush the step in front of them. Hiding them works only across a real context boundary; an inline call leaves them in context.

## Pruning

- One meaning, one home — **single source of truth**.
- Check **relevance**: does the line still bear on what the skill does?
- Hunt **no-ops** sentence by sentence: does this change behavior versus the default? Delete the whole sentence rather than trimming words from it.
- Prompt the positive. **Negation** names the elephant: state the target behavior so the banned one is never spoken. Keep a prohibition only as a guardrail that cannot be phrased positively, and pair it with what to do instead.
- Instruct; give a reason only where the reason changes what the agent does. A paragraph defending the design argues with a reader who has already loaded the skill and is trying to follow it.

## Enforce what a machine can check

Anything mechanically checkable belongs on a hook or a test — the **enforcement boundary**.
An enforced rule costs zero tokens at runtime and cannot be skimmed past;
the same rule in prose costs context load every run and still relies on attention.
Prose keeps what needs judgment.

When a rule is violated repeatedly, first ask whether it can cross the boundary.
Reword it only if it cannot.

## Ship self-contained

**Self-containment**: everything the skill needs sits in its folder, and nothing outside it ships alongside.
A skill is installed individually, into a project that may use none of the tooling its authors assume.

- Name no project-specific document paths. State the rule as a principle and use your own project as the worked example.
- Name no tool or CLI the installing project need not have — "view the issue", not a command.
- Reference other skills by name only, and write the reference to degrade: a named skill may be absent.
- Keep cross-links resolving inside the folder.

## Deriving from an upstream skill

1. Commit the upstream copy untouched — the **verbatim baseline**. The derivation then reads as a diff against what upstream published.
2. Record the **derivation pin**: the exact upstream commit. Update by diffing the pin against upstream's current state, folding changes into the derivation, and bumping the pin.
3. State what you changed and why, beside the pin.
4. Derive in a separate commit.

An upstream nobody has reviewed is untrusted, and a skill runs with the agent's full permissions.
The derivation is where that review happens.

## Grading

Run the scenario against an agent that does *not* have the skill, before writing it — the **baseline test**.
Whatever that agent already does is the default the skill has to beat.
Rules that restate the default are **no-ops** that otherwise ship undetected.

Keep scenarios outside the skill folder so they never ship with it.

## Failure modes

Diagnostic index; full definitions in `glossary/`.

| Symptom | Failure | Cure |
| --- | --- | --- |
| Step ends before the work is done | **Premature completion** | Sharpen the completion criterion; hide later steps only if it stays fuzzy |
| Same meaning in two places | **Duplication** | One home, referenced from the other |
| Stale layers nobody removes | **Sediment** | Prune deliberately, not on suspicion |
| Long, though every line is live | **Sprawl** | Disclose reference; split by branch or sequence |
| Line the model already obeys | **No-op** | Delete, or find a stronger leading word |
| Banned behavior shows up more | **Negation** | State the positive target |
