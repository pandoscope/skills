# Deriving a skill from upstream

Read this when vendoring someone else's skill rather than authoring your own.
Vendoring belongs wherever a project's skills are authored — most projects
consume skills and never derive one.

1. Commit the upstream copy untouched — the [verbatim baseline](glossary/verbatim-baseline.md).
   The derivation then reads as a diff against what upstream published,
   and a later upstream release folds in against a known common ancestor.
2. Record the [derivation pin](glossary/derivation-pin.md): the exact upstream commit.
   Update by diffing the pin against upstream's current state,
   folding the changes into the derivation, and bumping the pin.
3. State what you changed and why, beside the pin.
4. Derive in a separate commit.

An upstream nobody has reviewed is untrusted, and a skill runs with the
agent's full permissions. The derivation is where that review happens.

Upstream prose is under no obligation to satisfy your lint configuration,
and the baseline cannot be edited without destroying the diff it exists
for. Give verbatim copies a lint-exempt home rather than editing them.
