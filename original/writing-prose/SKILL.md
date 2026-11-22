---
name: writing-prose
description: >
  Prose rules per surface, and the loop that writes, rewrites and reviews
  prose against them. Use when writing or rewriting docs, code comments,
  commit messages, tickets, pull request bodies, review comments, skill
  files or CLAUDE.md, or when reviewing any of them for prose.
---

# Writing Prose

Rules live in `rules/`, one sentence each, with an id and a tier:

- **F** (fully): `check.sh` decides, and a finding is final.
- **H** (heuristic): `check.sh` prints a candidate, and you confirm or dismiss it.
- **M** (model): you judge the rule by reading.

## Surfaces

Name the surface first: `chat`, `ticket`, `tracker` (pull request bodies and comments), `markdown`, `skill`, `primed` (files loaded into every session), `comment` (code comments and help text) or `commit`.
`check.sh --rules <surface>` names the rules files the surface reads.

## Examples

`examples/` holds before-and-after passages from real prose, one file per register.
Read the file for your surface before you draft:
`argued.md` for `markdown`, `ticket` and `tracker`,
`instruction.md` for `skill` and `primed`,
`comment.md` for `comment`,
and `commit.md` for `commit`.

## Two parts

Writing and reviewing are separate parts.
A review runs in a fresh context, because the writer cannot see what the text leaves out.

## Writing

1. Read the surface's rules files and its examples file.
2. For text that describes code or a process, list its claims first, one per line, each with the place in the source that shows it.
   Keep the list for the reviewer: put it in the pull request's body or the review request, never in the text.
3. Before you draft a sentence, answer the reader rules for it: who acts, on what, under which condition, and where each term is defined.
4. Draft.
   Write one fact per sentence, with the names the code uses, so a fix changes one line.
   To rewrite, read the old block, draft it fresh from the rules, then cut.
   Never patch the old sentences.
5. Run `check.sh <surface> <file>`.
   A rewrite adds `--before <old-file>`; `-` as file reads stdin.
   Fix every F finding.
   Confirm or dismiss every H candidate, and fix the confirmed ones.
6. Layout comes last on the surfaces that read the layout rules.
   Once the content passes, run step 5 with `--fix`: it puts one sentence per line in the paragraphs you touched, then checks.
   A rewrap of lines the content work left alone is a reflow and goes in a style commit of its own, checked with `--style`.
   When a request puts layout before a content review, tell the principal and ask before you start.

## Reviewing

1. Run `check.sh <surface> <file>` and settle its findings as in step 5 of Writing.
2. Judge every M rule the run lists at its end, the reader rules first.
3. For text that describes code or a process, run [the bracket loop](brackets.md).
4. Report each finding with its sentence, its rule or bracket, and the answer where you found one.

A text passes when `check.sh` exits 0, every H candidate is settled, no M rule is broken and no bracket marked as blocking is open.
M findings and brackets still open after round two go to the principal as a report, not into a third round.

## The principal's edits

When the principal brackets, rewrites or questions a text, follow "When the principal brackets" in [brackets.md](brackets.md).

## Rewriting prose about code

To rewrite existing prose that describes code, follow [rewrite.md](rewrite.md).

## Who reviews

- F and H rules: `check.sh`, on every surface, whenever you write.
- Tickets, tracker text and pull request bodies: a subagent runs the reviewing part before you post.
  It sees only the text, the surface, the rules and your claims list.
  Without subagents, review the text yourself and say so.
- Repository files in a pull request: the project's prose review pass.
  Without one, the subagent reviews them.

Chat takes no subagent.
Apply its rules as you write.
