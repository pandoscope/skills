# Expected findings

The principal's review comments on skills#44, verbatim,
after an agent review round had already run and been applied.
Every finding here is one the agent round did NOT surface —
that is what makes the set discriminating.
Anchors are quoted passages, not line numbers, so they survive reflow.

Finding classes are the `writing-skills` skill's terms.

## On `fixtures/thread-ledger/SKILL.fixture.md`

### 1. Whole section is for the wrong reader

Anchor: `## Tickets that fell behind` (the entire section).

> I think this is all irrelevant. The agent that creates a record
> doesn't need to know how the page for the user looks like,
> if there's anything worth keeping, let me know

Class: audience drift.
The section names an agent-side verb (`synced`),
which disguises it as agent-relevant —
but the agent's whole duty is already in the events table
(`stale` with a `what`), and the copied prompt the human pastes
carries its own instructions.
The trap: the adjacent `## What the page shows` section *declares*
the right principle ("Nothing here needs repeating it") —
a compliance statement sitting beside the violations.

### 2. Rendering aside inside an agent-relevant section

Anchor: `— rather than a badge on its own line`.

> " — rather than a badge on its own line" -> can be removed, irrelevant

Class: audience drift, sentence-level.
The section (`## Ticket prefixes`) is agent-relevant
(the code map, the fallback); the aside about badge placement is not.

### 3. Implementation guarantee, not an instruction

Anchor: `Both read fold(), so they cannot disagree about what is open.`

> Irrelevant

Class: audience drift.
A correctness argument about the renderer's internals;
the agent does nothing differently for knowing it.

### 4. The skill documents a fragile identifier instead of questioning it

Anchor: `### The session id`.

> Since the session ID changes, we should maybe get rid of it entirely
> and only use the url as identifier

Class: design finding.
The section itself describes the id as unstable and the guard that
refuses its failure mode — a paragraph-length workaround is evidence
the identifier is wrong, and a reviewer should say so rather than
review the workaround's prose.

### 5. Who else runs this skill?

Anchor: the skill as a whole.

> We also want coding and reviewer agents to track their progress
> through this. Can we just reuse the same skill, or make a separate
> one (weigh duplication against skill clarity and conciseness)

And the follow-up comment:

> Probably in general good to keep in mind how to manage the skill-set
> for coding, review and orchestrator agent. If we have no ticket for
> that, please create

Class: splitting by agent role (skills#48).
A scope question, not a defect: the review should ask which agent
roles will run the skill, not only whether its text is right.

## On `fixtures/AGENTS.fixture.md`

### 6. One index for every agent role

Anchor: the skills trigger table.

> We need to rethink this, we only want to mention those that are
> relevant for the current type of agent, otherwise it gets confusing

Class: context load at the repo level — the per-role variant of
finding 5.

### 7. Two entries restating one contract

Anchor: `SESSION_MEMORY_URL` beside `DECISION_MEMORY_URL`
in Skill Environment Variables.

> "Same contract and same reasons as `DECISION_MEMORY_URL`" maybe we
> should group them together, describe the contract for these types of
> URLs and then just explain any specialities for the URLs if any there

Class: duplication.
The agent round had demanded the entry exist;
it did not notice that satisfying the demand by copying the sibling
entry duplicates the contract.
A fix applied in the shape the reviewer asked for still needs review.

## On `fixtures/asking-for-help/SKILL.fixture.md`

### 8. An interpretive condition where a checkable one exists

Anchor: `The decision does not exist yet, and only the principal can
make it.`

> Not a misunderstanding: nothing was misread. The decision does not
> exist yet and cannot be deduced from the decision-memory repo's
> `preferences.md`, so only the principal can make it.

(Suggested replacement text.)
Class: completion-criterion ladder applied to conditions —
"does not exist yet" is judged; "not derivable from the preference
set" is checked.

### 9. A sibling's format restated

Anchor: the grilling-form question template.

> Maybe better to refer to the /grilling skill here instead of
> riskng drift

Class: duplication across siblings — the named skill keeps its own
content.

### 10. Single-question rule breaks under several sessions

Anchor: `One question per comment.`

> No, all questions in one comment using identifiers such as "S2Q3"
> (questioning session 2, question 3), so the user can respond with
> "S2Q3: 2.". This avoids ambiguity if there are several sessions

Class: design finding.
The rule assumed one session at a time;
the principal fields questions from many.
Detectable by asking who consumes the output and at what volume.

### 11. Handoff instruction lives in the skill, not the artifact

Anchor: `the next session records it with real provenance`.

> This should be written as part of the question in the comment, so an
> agent reading it remembers to put it into the decision-memory

Class: outputs that outlive the run —
the posted comment's future reader may not have this skill,
so the comment itself must carry the instruction.
