# Rewriting prose about code

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
4. **Draft.** Draft the text from the claims under the loop in SKILL.md, in the shape of its place (see Shapes below).
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
