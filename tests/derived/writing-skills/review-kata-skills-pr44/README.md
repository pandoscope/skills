# Review kata: the skills#44 second round

A pressure scenario for the review use of `writing-skills`
("reviewing a change to a skill file").
It preserves, as frozen evidence, the exact state a principal reviewed
AFTER an agent review round had already run and its fixes were applied —
so every expected finding is one an unaided agent review missed.

## Provenance

- PR: pandoscope/skills#44 (thread-ledger + worker skill family).
- Round 1 (agent): review on commit `99f533d` — 9 findings,
  all fixed by the implementer before round 2.
- Round 2 (principal): review on commit `cc4ca41`
  (`fixtures/thread-ledger/SKILL.fixture.md`, `fixtures/AGENTS.fixture.md`).
- Round 3 (principal): review on commit `50a2ad2`
  (`fixtures/asking-for-help/SKILL.fixture.md`).
- Harness of the round-1 agent: Claude Code on the Web, 2026-07-30;
  model as recorded by the session links in the PR's review footers.

The fixtures are verbatim snapshots of those commits.
Never update them: they preserve the reviewed state, and a fixture
that tracks the living file stops being evidence.
Comments verbatim in [expected-findings.md](expected-findings.md).

## Running the kata

Give the reviewing agent the three fixtures as the PR state,
plus this repo's live `AGENTS.md` and `README.md` as the rules,
and the task:

> Review these skill files for the canonical skills repo.
> An earlier review round has already run and been applied.
> Report every remaining finding.

Run it once without the `writing-skills` skill (baseline)
and once with it.
Record harness and model version with each run.

## Grading

Score = expected findings surfaced, out of 11.
Judge by meaning, not wording: a finding counts when it names the same
passage and the same defect, whatever vocabulary it uses.
The baseline agent round scored 0 on this set by construction —
its own findings had already been applied into the fixtures.

## Why the round-1 agent missed these

Recorded because the miss pattern, not the findings, is what the kata
trains against.

1. **Evidence anchoring.** Round 1 flagged view-description prose only
   where a near-verbatim twin existed in `ledger.py` — duplication was
   the detector, so passages without a code-side copy
   (`Tickets that fell behind`) passed. The audience test —
   does the operating agent act on this line? — needs no twin.
2. **Plausible-use reasoning.** Round 1 explicitly advised *keeping*
   the ordering/blocking paragraph, on "the agent might need to
   predict the page". The strict test is behavioral: what would the
   agent do differently without the line? For view prose: nothing.
3. **Compliance statements taken as compliance.** The revised file
   declared "Nothing here needs repeating it" while adjacent sections
   kept repeating it. A stated principle beside its own violations
   lowered the reviewer's guard.
4. **Fixes in the requested shape went unre-reviewed.** Round 1
   demanded the env-var entry exist; the fix copied the sibling
   entry's contract, and the copy itself was the next finding.
5. **No who-runs-this question.** Round 1 reviewed the text in front
   of it and never asked which agent roles consume the skill or how
   many sessions question one principal — the scope findings
   (5, 6, 10) all come from that one unasked question.
