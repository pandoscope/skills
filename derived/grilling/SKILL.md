---
name: grilling
description: >
  Grill the user about a plan, decision, or idea via scored
  multiple-choice questions. Use when the user wants to stress-test
  their thinking or uses any 'grill' trigger phrase.
metadata.derived-from: https://github.com/mattpocock/skills/blob/e9fcdf95b402d360f90f1db8d776d5dd450f9234/skills/productivity/grilling/SKILL.md
metadata.derivation-note: Adds multiple-choice format (recommendation = scored prediction) rendered from grilling-session JSON into an interactive artifact page or text fallback, decision + rejection-reason recording to the decision-memory repo, artifact embedding of considered alternatives. Detached from upstream — no sync.
---

# Grilling

Interview user until shared understanding. Walk every branch of decision tree, resolve dependencies one by one. ONE question at a time — wait for answer before next. *Facts* findable in environment: look up, never ask. *Decisions* are user's — put each to user, wait. Do not act until user confirms shared understanding.

Naming: question `S«s»Q«q»` (session, question), answer `S«s»Q«q»A«n»`.

## Steps

1. Session start: shallow-clone decision-memory repo named EXCLUSIVELY by `DECISION_MEMORY_URL` (never hardcoded, never echoed into artifacts). Unset → tell user, skip recording, out loud: silent skip is indistinguishable from successful record. Inject ONLY rendered active preference set — never decision history.
2. Author every decision point as grilling-session JSON — whole session so far, answers included. Contract and field docs: `render/decision-context.ts` beside this file; semantics (slots, tags, scoring, citations): [format.md](format.md). NEVER hand-format a question; renderer appends free-text slot itself.
3. Derive both user-facing forms — validation failure names offending field; fix JSON, re-run:

   ```bash
   node --experimental-strip-types <skill-dir>/render/render.ts <session.json> --out <dir>
   ```

4. Publish `session.html` as artifact, redeploying same URL as session grows. Publishing unavailable → print `session.md` into chat verbatim — never as file attachment, never as timed question dialog (dialogs close while user still typing).
5. Answers arrive as page's copied answer JSON pasted into chat, or as chat replies: answer id ("S1Q2A1" or "1"), correction via "N, but actually because …" — shorthand "N, BAB …". Follow-ups: append new questions plus received answers to session JSON, re-render; user may also revisit and change earlier answers.
6. Session end: record every ruling to decision-memory repo, embed rejection reasons in session's target artifact, per [recording.md](recording.md).
7. Run this folder's `check.sh <session.json>`: re-validates session mechanically, prints residue to verify by hand.

## Question rules

- Slot 1 carries prediction: preference-driven when active rules match (named in `matches`), else cold pick. Diverging recommendation sits at slot 2, its if-clause arguing condition under which it beats slot 1.
- Wildcard ONLY when genuinely plausible unexplored branch exists; else omit.
- If-clause = condition under which option beats recommendation. Add "why not recommended" only when it differs from negated if-clause.
- Near-ties MUST be marked; never fabricate weaknesses for close calls. Near-ties never score as prediction misses.
- Correction ("N, BAB …") accepts option and overrides its stated reason — highest-signal event; flag it in record.
- Drill down with ONE follow-up question (2-3 ranked guesses + free text) only when free-text answer leaves rejection reasons unstated — never interrogate what is already answered. Guesses count as predictions.

## Non-goals

No automatic preference-rule acceptance — human in loop always. No embedding/RAG tooling here. No upstream sync after derivation.
