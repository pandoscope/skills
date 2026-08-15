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
exist yet, and only the principal can make it.

Ask it in **grilling form**, so the reply arrives already recordable:

```markdown
@principal — blocked on a ruling.

**Context.** <what makes this genuinely open, in two sentences>

1. <option> *(what the preference set predicts, citing the rule by name —
   or "cold" when no rule applies)*
2. <option> *(if <the condition under which this beats 1>)*
3. <option> *(wildcard, if <condition>)*
4. Free text.
```

One question per comment. If two are open, ask the one that blocks the
other and say the second is waiting.

A reply to this shape is a ruling with its options intact, so the next
session records it with real provenance instead of reconstructing it.

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
