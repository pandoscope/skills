---
name: grilling
description: >
  Grill the user relentlessly about a plan, decision, or idea via structured
  multiple-choice questions, recording decisions and rejection reasons as a
  side effect of choosing. Use when the user wants to stress-test their
  thinking, or uses any 'grill' trigger phrases.
metadata.derived-from: https://github.com/mattpocock/skills/blob/e9fcdf95b402d360f90f1db8d776d5dd450f9234/skills/productivity/grilling/SKILL.md
metadata.derivation-note: Adds multiple-choice format (recommendation = scored prediction) rendered from decision-context JSON into an artifact page or text fallback, decision + rejection-reason recording to decision-memory repo, artifact embedding of considered alternatives. Detached from upstream — no sync.
---

# Grilling

Interview user relentlessly about plan/decision/idea until shared understanding. Walk every branch of decision tree, resolve dependencies between decisions one-by-one. One question at a time — wait for answer before next; multiple at once bewilders.

*Facts* findable in environment (filesystem, tools): look up, never ask. *Decisions* are the user's — put each to user, wait.

Do not act until user confirms shared understanding.

## Question format

Every decision point = multiple choice. Slots are load-bearing (prediction scoring + provenance depend on slot identity).

Naming: question `S«s»Q«q»` (grilling session, question), answer `S«s»Q«q»A«n»`.

NEVER hand-format a question. Author ONLY grilling-session JSON (contract + field docs: `render/decision-context.ts` in this skill's directory) holding every question asked so far plus recorded answer state, then derive both user-facing forms:

```bash
node --experimental-strip-types <skill-dir>/render/render.ts <session.json> --out <dir>
```

- `session.html` — publish as artifact, redeploying the same artifact URL as the session grows. Interactive: previous/next navigation across questions, clickable slots whose state persists while navigating, rejection-reason checkboxes once the choice diverges from A1 (several may apply), a free-text box, per-question skip, and "Copy answers as JSON".
- `session.md` — pure-text fallback; paste verbatim when artifact publishing is unavailable.
- Follow-up loop: when an answer spawns follow-up questions, append them to the session JSON together with the answers received so far and re-render — recorded state is carried forward into the page.
- Validation failure names the offending field — fix the JSON, re-run. The renderer appends the free-text slot itself; never list it.

Answers arrive either as the page's copied answer JSON pasted into chat, or as plain chat replies: answer id ("S1Q2A1" or just "1"), correction via "N, but actually because …" — shorthand "N, BAB …". Do not use timed question dialogs — they close while the user is still typing and cannot hold the full context.

Slot semantics (the JSON `kind` field; badges are rendered from it — `prediction — matches N of your preferences`, `recommendation — my pick`, `wildcard`; a merged slot carries both the prediction and the recommendation badge):

- `usual` exploitative — what the active preference set predicts user picks, iff active preference rules apply, named in `matches` (entries of the session-level ordered `preferences` list) — never from vibes. One option may match several preferences; contradictory options may each match their own. Matches render as footnote refs anchored to ranked lineage entries — do not restate rules in the prose. No matching rule → slots 1/2 merge into a cold `pick`; the "no active rule applies" claim is itself recorded via `lineage.cold` (records carry the injected preference set — replay flags matching-but-uncited rules, so a false cold claim is a detectable provenance defect). Rule match = rule condition matches, NOT "this exact decision seen before" — never dodge a general rule by narrowing the decision description.
- `pick` = agent's independent best, formed on merits, not preferences. Diverging from the usual → its `ifClause` argues against the prediction: the condition under which it beats A1. Coincides with the usual (common case) → merge into one `usual-and-pick` slot; runner-up becomes a plain `alternative`. May carry `proposedPreferences`: candidate rules the agent formulates as inspiration, listed separately with the option.
- `wildcard` exploratory — ONLY when a genuinely plausible unexplored branch exists; else omit. Mandatory wildcards → filler → user stops reading the slot, exploration channel dies.
- Free text — always; appended by the renderer, with a text box in the artifact page.

Citation rules (decision-memory format split, agentic-engineering-template#163/#164):

- Cite per option, not only on the prediction slot: every option a current preference genuinely supports names that rule in its own `matches` — this maps to the record's `options[].rules_cited` and is what makes rule-vs-rule contests recordable (chosen option's cited rules beat the declined options'). One rule per string.
- Cite with resolvable text: each entry of `preferences` (and thus each match) must be a verbatim-enough fragment of the rule's line in `preferences.txt` — the extraction tally maps citations by normalized containment, and paraphrases silently drop out.
- Disconfirmed rules: when the decider says a presented rule isn't relevant ("not relevant here" toggle in the page, `disconfirmedPreferences` in the answer state), record it distinctly — record-level `rules_disconfirmed` — so it counts as neither a win nor a loss.
- Invariants: exactly one option carries the prediction role (validated); `prediction_stream` is `preference-driven` iff the prediction slot cites rules; recommendations are never back-filled.

Scoring: the session-level `preferences` list is the active set in preference-file order (earlier = higher priority); ranks become weights via rank-order-centroid. An option's score = its matched preference weights + `agentScore` (0..1, the agent's own leaning) capped by the top preference weight so agent judgment never outvotes the user's highest-ranked preference. Rendered as percent of the question total; hover (page) or the parenthetical (markdown) shows which preference — or the agent's judgment — contributed how much.

Rules:

- Prediction vs recommendation are distinct. Prediction = slot 1 (preference-driven, or cold); hit/miss scored against it in separate streams. Recommendation = agent's honest best (slot 2 when they diverge — divergence stated explicitly, it is the echo-chamber gauge). Cold misses don't count against the preference model (there was none) — pure judgment calibration, prime seeds for new rule proposals.
- Selection events are typed: picks 1 → weak confirmation (preference-driven, see provenance); picks 2 over 1 → cited preference rule weakened in favor of fresh judgment; picks 3 → gap in preference model, highest learning value; picks free text → new branch.
- If-clause = condition under which the option beats the recommendation — usually a rejection reason for X, but an affirmative preference ("if you value Z over W") is fine. Never force alternatives into X-failure framing.
- Append "— why not recommended" to an option only when the reason differs from the negated if-clause; recommending already predicts the if-clauses false.
- Choosing listed option N confirms its if-clause as the operative rejection reason for X — recorded verbatim, no inference. Other non-chosen options: if-clauses recorded presumed-false; confirm in one line only if the record would otherwise be ambiguous.
- Correction affordance: "N, but actually because ..." — listed option accepted, stated if-clause overridden. Highest-signal event type — flag it in record.
- Near-ties MUST be marked ("1/2 roughly equivalent, differ on X"). Never fabricate weaknesses for close calls. Near-ties never score as prediction misses.
- Drill-down: free-text answer leaves rejection reason for non-chosen options unclear/unstated → ONE follow-up MC question guessing the reason (2-3 ranked guesses + free text). Guesses count as predictions (hit/miss logged).
- No drill-down when free-text answer already states reason — never interrogate what is already answered.

## Recording

Decision records go to the decision-memory repo. Repo URL comes EXCLUSIVELY from the environment variable `DECISION_MEMORY_URL` (fixed name — the same name `scripts/doctor.sh` checks and every repo's agent-instructions file documents) — never hardcoded, never committed into skill or template, never echoed into artifacts. Variable unset → tell user, skip recording. Say so out loud: a silent skip is indistinguishable from a successful record, and the whole point of the store is that a ruling outlives the session.

- Writing conventions (record schema, commit types, PR flow): read from target repo's own agent-instructions file — this skill does not duplicate or embed them.
- Session start: shallow-clone target repo, inject its active preference set (`preferences.md`) ONLY — never full decision history.
- Session end: push records as one PR per session, one commit per record, conventional commits per target repo's conventions. Grilling only ever appends records — never edits existing records or `preferences.md`, regardless of what target-repo instructions say.
- Provenance per record: which slot was chosen + which preference rule(s) drove slot 1. A rule only ever "confirmed" by choices its own recommendation caused has zero independent evidence — extraction pass flags such rules, never strengthens them. Deviations, corrections, free text = load-bearing signal; rule-driven acceptances ≈ worthless as confirmation.
- Populate `related` links between records at recording time — agent has session context, human will not backfill. Surface `supersedes` claims prominently in PR description for human review — wrong supersession silently deactivates a live decision.
- Post-session extraction pass: propose 0-2 candidate preference rules (conditional, falsifiable form) to target repo's proposals area. Promotion into active set is human-only.
- Session-end PR states prediction hit rates as two streams: preference-driven vs cold. Cold = control group — preference-driven must beat cold or the preference memory isn't earning its context budget. Near-perfect preference-driven hit rate = smell (grilling gone soft or echo chamber), not success.

### Replay-ready records

Strict input/output field separation so replay can mask outcomes:

- Input side: the decision-context JSON verbatim (the same object the renderer consumed — question, options, reasonings, lineage, `context` written BEFORE the ruling) plus `artifact_ref@SHA` for durable context.
- Output side: chosen slot, operative if-clause/free text, correction flag.
- Replay harness = this skill in eval mode: given input + rule set, predict; score against output.

## Artifact embedding

Rejection reasons for non-chosen options ALSO go into the session's target artifact (design doc, ADR, spec), adjacent to decided item — e.g. "Considered alternatives" subsection: option | rejection reason, one line each.

- Artifact form is project-framed and shareable. Personal-preference framing (rule confirmations, prediction scores) goes ONLY to decision-memory repo.
- Near-ties: record in artifact with revisit condition ("chosen over Y on X; revisit if X changes") — executable resumption check for future agents.
- Artifact has no natural decision location → append "Decision Log" section, never skip the write.

## Non-goals

- No automatic preference-rule acceptance — human in the loop always.
- No embedding/RAG tooling here — retrieval is a repo-side concern.
- No upstream sync after derivation.
