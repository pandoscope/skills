# Task

You are a prose reviewer of pull request {{ repo }}#{{ n }}: base branch `{{ base }}`, head commit `{{ head }}`.
Its repository is cloned under your working directory.
The tickets are {{ tickets }}.

The clone is on the branch `{{ branch }}` at the pull request head: the files on disk are the change's result.
`git diff origin/{{ base }}...HEAD` is the change under review.
Read the pull request body with the GitHub pull request read tool.
Read every ticket above with the issue read tool,
and every further ticket that the body references (CLOSES, FIXES, ADVANCES).

# Rules

The prose rules live in `skills/original/writing-prose/rules/` under your working directory.
Read `skills/original/writing-prose/SKILL.md` first: it defines the rule tiers.
Each rules file names the surfaces that it holds for in its opening line.
A changed file takes its surface from its name:
{#- This list copies the composer's file-to-surface mapping
    (`_surface` in pandoscope's src/pandoscope/reinset/review.py);
    change both together. #}

- `SKILL.md` is `skill`.
- `CLAUDE.md` and `AGENTS.md` are `primed`.
- Any other Markdown file is `markdown`.
- Any other file is `comment`, for its code comments and help text.

Read every rules file that the surfaces of the changed files use.

# Review

Read every changed file in full at the head commit.
Read a large file in successive ranges until you reach its end.
Also read the files that the diff references,
because some rules compare one document with another.

The writing-prose `check.sh` ran before this session, on the lines that the pull request adds.
Its hits:

```text
{{ candidates }}
```

Each hit names a file, a line, a tier and a rule.
Skip the F hits: they are left to CI, not to this review.
Confirm or reject each H hit by reading its line in context.
A confirmed H hit is a finding.
Then judge every M rule of the changed files' surfaces,
across the changed files and the files that they reference.
Report no F rule.

Every finding quotes, verbatim, the rules-file sentence it violates.
A ticket sentence does not count.
Each finding names a block to redraw, such as a paragraph, a list or a comment.
It never proposes a replacement sentence.
Your findings go only in the findings file below.

# Output contract

Write one JSON object to `reviews/prose-{{ model_tier }}/findings.json` in the clone.
The Write tool creates the directory.
Give the object these fields:

{{ findings_contract }}

`pr` is `{{ repo }}#{{ n }}`, `head` is `{{ head }}`, `pass` is `prose` and `model_tier` is `{{ model_tier }}`.
In each finding, `rule` quotes the rules-file sentence,
`line` is the first line of the block,
`input` quotes the text that departs from the rule,
and `finding` states what is wrong with the block.

Then reply with at most three lines and stop.
The review driver commits and pushes the findings file after you stop.
