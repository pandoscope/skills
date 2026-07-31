---
name: reporting-misunderstandings
description: Record a reasoning failure — the ticket said X and the run read Y — as a decision-store misunderstanding plus a ticket comment. Use when an agent session discovers it misread its own instructions or evidence.
---

# Reporting Misunderstandings

A misunderstanding is a defect in **reasoning**, not in the system.
Nothing was broken; something was misread. It goes to the decision
store, because that is where the corpus of how choices get made lives —
an evidence record would file it as a system defect and teach the wrong
lesson.

## Where it lands

`predictions/`, written the same way `/making-decisions` writes one:

```bash
python3 tools/record.py record --predict --from draft.json
```

Not `decisions/` — that directory holds rulings, and a ruling needs a
ruler. An autonomous run's account of its own misreading is a record
*about* the run, so it belongs in the same corpus as the run's other
choices.

The same constraint applies as in `/making-decisions`: `--predict` is
specified in pandoscope/agentic-engineering-template#121 and does not
exist in the store yet. Until it does, the record cannot be written,
and the ticket comment below is the whole deliverable — say in the
comment that the record is pending on that ticket, so a missing record
is visible rather than assumed.

## The two shapes

**Misread instruction.** The ticket said X, the run built Y. Record
what made the misreading available: ambiguous wording, a stale
comment, an assumption carried from another repo.

**Misapplied rule.** A preference rule was cited for something it does
not cover. This is the highest-signal kind, because the rule looks
confirmed afterwards unless the miscitation is recorded — a rule
credited for a choice it never predicted is worse than an uncited one.

Record it with `correction: true`, and say plainly that the defect is
the citation, not the rule. Extraction must not read it as evidence
against the rule.

## Record it against yourself, precisely

Vague self-criticism teaches nothing. The useful record names:

- what was believed, and what was actually true
- **what made the wrong belief available** — this is the extractable
  part
- what would have caught it earlier

"I misread the ticket" is not a record. "I read `blocked-by` as
advisory because our other repos use it that way, and nothing in the
ticket said otherwise" is.

## Comment on the ticket too

The record is durable; the comment is what stops the next reader
repeating the misreading in the meantime. One paragraph: what was
misread, what it actually means.

If the wording caused it, that is also a `doc-bug` —
`/filing-bugs`, one ticket, linked both ways.

## Never

- record a misunderstanding to explain away a defect that is really in
  the code
- soften it into "the ticket was unclear" when the ticket was clear
- record the same misunderstanding twice; the second occurrence is a
  comment on the first, and the repetition is itself the finding
