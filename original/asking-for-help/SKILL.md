---
name: asking-for-help
description: Route a blocker to the right channel and the right store — undecided questions as a multiple-choice ticket comment, transient conditions as a PR comment. Use when an autonomous run cannot proceed on its own.
---

# Asking For Help

One rule for which channel a blocker belongs to.

**The ticket carries what and why. The PR carries how it went.**
A question that outlives the session goes on the ticket; execution
weather goes on the PR.

## Route by cause

| Cause | Channel | Durable record |
| --- | --- | --- |
| **Misunderstanding** — the ticket said X, the run read Y | ticket comment | `/reporting-misunderstandings` |
| **Defect** — something is broken | ticket comment | `/filing-bugs` |
| **Missing capability** — something is absent | ticket comment | `/requesting-features` |
| **Undecided question** — two defensible readings, no rule covers it | ticket comment, MC format, @principal | the answer becomes a decision record |
| **Transient / provisioning** — rate limit, outage, missing secret, connector scope | PR comment @principal (ticket if no PR) | none, unless recurring |

## The undecided question

Not a misunderstanding: nothing was misread. The decision does not
exist yet and cannot be deduced from the decision-memory repo's
`preferences.md`, so only the principal can make it.

Ask in the shape `/grilling` defines — that skill owns the question
format, the slot semantics and the rule-citation convention, and a
second copy here would drift from it.

**Every open question in one comment**, each with an identifier:

```markdown
@principal — blocked on <n> ruling(s). Answer by identifier, any order,
e.g. `S2Q3: 2`.

### S2Q1 — <the question>

<options, per /grilling>

### S2Q3 — <the question>

<options, per /grilling>

---
Answers here become decision records: reply in the form above and the
recording session has the options and the operative reason intact.
```

`S<session>Q<n>` — the session number scopes the identifier, because
several sessions can be waiting on one ticket at once and `Q3` alone
would be ambiguous between them. Keep an answered question's
identifier retired; renumbering makes an old reply point at a new
question.

**Which session number is yours:** one more than the highest already
used on this ticket, read from its comments. Re-read after posting —
two sessions asking at once will both have read the same highest
number, and the later comment edits itself to the next one rather than
leaving two `S2`s that an answer cannot distinguish.

One comment rather than one question per comment: the principal reads
the ticket once and answers what they can. Questions that do not block
each other should not be serialised behind each other's replies —
say which ones block the current work and which do not.

The note about recording belongs **inside** the comment, not only in
this skill. The session that reads the reply is usually not the
session that asked, and a reply nobody records is a ruling that has to
be reconstructed later from memory.

## Transient and provisioning

Rate limits, outages, an unset secret, a connector without scope. Not
a defect in anything's contract — the world was briefly short of
something.

Comment where the work is, name what would clear it, and record
nothing. A store full of weather is a store nobody greps.

**Unless it recurs.** The third missing secret in a week is not
weather. Something expected provisioning to have happened and it had
not, which is a defect in an expectation rather than a missing
feature: file it via `/filing-bugs` with the occurrences listed.

## Always

Say what is blocked, what would unblock it, and who can do that. A
comment that reports being stuck without naming the exit is a status
update, not a request.
