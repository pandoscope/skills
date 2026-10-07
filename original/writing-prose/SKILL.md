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
`comment.md` for `comment`,
and `commit.md` for `commit`.

## Loop

1. Read the surface's rules files and its examples file.
2. Draft.
   To rewrite, read the old block, draft it fresh from the rules, then cut.
   Never patch the old sentences.
3. Run `check.sh <surface> <file>`.
   A rewrite adds `--before <old-file>`; `-` as file reads stdin.
   Fix every F finding.
   Confirm or dismiss every H candidate, and fix the confirmed ones.
4. Judge every M rule the run lists at its end.
5. Repeat steps 3 and 4.
   From the second round on, fix findings in place.
6. Layout comes last on the surfaces that read the layout rules.
   Once the content passes, place the semantic line breaks and run step 3 once more.
   A rewrap of lines the content work left alone is a reflow and goes in a style commit of its own, checked with `--style`.
   When a request puts layout before a content review, tell the principal that the order breaks this step and ask before you start.

A text passes when `check.sh` exits 0, every H candidate is settled and no M rule is broken.
M findings still open after round two go to the principal as a report, not into a third round.

## Rewriting prose about code

To rewrite existing prose that describes code, such as a header comment, a commit body or a ticket, run these steps.
Give each step to a fresh subagent that reads only its inputs and the code;
when you cannot spawn one, run the steps yourself in order and say so.

1. **Claims.** List every claim the text makes, one per line, and check each against the code.
   Mark it `confirmed`, `unchecked` when the code cannot settle it, or `corrected (path:line)`, citing the line that contradicts it, followed by what the code does.
   A claim about something the files do not show stays `unchecked`.
   Restate figurative wording literally, keep established terms, and state a limit as a limit.
   End the list with a `layout:` line that names the text's paragraphs, lists and tables.
2. **Overreach.** Check each confirmed or corrected claim against every case its reader meets, and add only the one condition that makes it true.
3. **Edit in place.** When no claim is corrected, edit the original text instead of drafting, change only the lines `check.sh` flags, and stop.
4. **Draft.** Draft the text from the claims under the loop above, in the shape of its place (see Shapes).
   Keep every list or table the `layout:` line names.
5. **Relevance.** Cut each sentence the reader does not need there, then each qualifier.
   Keep the reason a rule or design exists, its evidence, and each limit: what the code does not do or cannot enforce, with what it does instead.
   Cut how the code formats or labels its output.
   Check that each "so", "because" and "therefore" still follows from what the text states, and state each fact once.
   Then run the loop's `check.sh` steps again with `--before` the draft.

The text is only the part you were given: add no sections, links or status lines that only a whole ticket, pull request or commit needs.

## Shapes

Each place a text lives has its own order.
These shapes are provisional: each rests on one approved rewrite in `examples/`.

- **Ticket for a bug:** the intended behaviour, then "but" the code that breaks it, then one list item per flaw with its effect and cause, then the evidence, then links to tickets for related flaws.
- **Commit for a fix or a gap:** the intended behaviour or whose job it is, what went wrong "until now", the change "with this commit", the cases as a list, details with their reasons and limits, then the evidence.
- **Commit that adds results:** definitions of every term the results use, then the results, then what follows from them; the body may repeat facts as of the commit.
- **Header comment:** what the file defines, who reads or runs it, what that does when run, and its limits, with no history.

## Who reviews

- F and H rules: `check.sh`, on every surface, whenever you write.
- M rules on tickets, tracker text and pull request bodies: a subagent reviews them before you post.
  It sees only the text, the surface and the rules.
  Your own context misses audience drift and takes compliance claims at face value.
  Without subagents, review it yourself and say so.
- M rules on repository files in a pull request: the project's prose review pass.
  Without one, the subagent reviews them.

Chat takes no subagent.
Apply its rules as you write.
