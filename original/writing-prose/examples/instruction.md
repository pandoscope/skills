# Instruction examples

A skill file, a role profile or a file loaded into every session tells an agent what to do.
The agent acts on what the words say, so each pair below starts from a real rule that could be read two ways,
and from the question a reader asked about it.

## A label that hides whose case it covers

Before:

```text
- Ticket body = spec.
  Build what the ticket says.
  Defect or gap outside it: a discovery in your last reply, with its ticket if one exists.
- Every acceptance criterion gets a test.
  Defect in existing code: commit a test that fails on the old code, then the fix.
```

The reader asked: "Should an implement worker really fix code unrelated to its pull request if it encounters existing code that has a defect?"

After:

```text
- Ticket body = spec.
  Build what the ticket says.
  Gap outside it: a discovery in your last reply, with its ticket if one exists.
- Every acceptance criterion gets a test.
  A ticket that reports a defect: commit a test that fails on the old code, then the fix.
- Fix no defect outside your ticket.
  Open a ticket for it with a failing example, unless one exists,
  and name that ticket as a discovery in your last reply.
  If the defect keeps you from finishing your task, stop there.
```

"Defect in existing code:" named a situation without saying whose defect, so it read as an order to fix every defect the worker meets, against the rule above it.
Under `scope`, the label now names the case the rule covers, and the excluded case has a rule of its own with its action and its stop condition.

## A coined phrase used as known

Before:

```text
- A criterion that needs a session is met only by a session that showed it.
  List it in the PR body as "needs a run", with the exact order file to place.
```

The reader asked: "What does 'showed it' mean here?", "How does a criterion need a session?" and "What is 'it' here?"

After:

```text
- A criterion needs a session when no test can show the criterion holding:
  the criterion is about what a Routine, a hook or the model does in a running session.
  Such a criterion is met only when a session has run and its transcript shows the criterion holding.
  List the criterion in the PR body as "needs a run", with the exact order file to place.
```

Under `define-first`, the phrase "needs a session" gets its definition and its condition before the rule uses it.
Under `argument`, "showed it" names its evidence, the session's transcript.
Under `referent`, "List it" repeats its noun, because the sentence before names a criterion and a session, and both fit.
The first repair answered one question and came back; answer every bracket in a sentence before you rewrite it.
