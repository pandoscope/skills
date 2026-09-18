---
name: making-decisions
description: Record an autonomous run's own choices as prediction records in the decision store. Use when an agent session makes a non-obvious choice with no principal present.
---

# Making Decisions

An autonomous run chooses under the active preference set with no
decider present. That is a **prediction**, not a ruling, and it
belongs in `predictions/` — same schema, same append-only guarantee,
outside the preference pipeline entirely.

Preferences learn the principal. Feeding an agent's own choices back
into them would be a rule confirming itself.

## Composes on `/documenting-decisions`

Both fire on the same moment — a non-obvious choice was just made — but
they stay separate skills so the marker skill keeps working with **no
infrastructure at all**, in any repo, store or no store.

Order:

1. Run `/documenting-decisions` and place the `DECISION:` marker.
2. Then record the prediction here, and put its ID in the marker:
   `DECISION(20260730T121506Z-a-slug):` — that ID is what later joins
   a reviewer's comment to the choice it judges.

If the store is unreachable, step 1 still happened and step 2 is
**declared** in the marker (`DECISION(unrecorded — no store):`) rather
than skipped in silence. The reason goes in the marker, because
"unreachable" and "this store has no predictions directory" call for
different fixes.

## What to record

The same shape a grilling produces, because that is what makes a
record replayable:

- `question`, `context` — written BEFORE the choice
- `options[]` with slots, the prediction slot's `rules_cited`, and each
  alternative's if-clause
- `prediction_stream`: `preference-driven` when a rule drove it,
  `cold` when none applied. **An honest cold claim costs nothing;** a
  false one is a detectable provenance defect, since replay can spot a
  rule that matched but went uncited.
- `chosen_slot`, `chosen`, `rejections[]`, `outcome`

Write the options as they actually stood, not as the outcome makes
them look. A record whose alternatives were invented afterwards
replays against a prediction nobody made.

## Writing

```bash
python3 tools/record.py record --predict --from draft.json
```

Commits as `prediction(<project>): <slug> — <chosen>`.

**The store's recorder does not accept `--predict` yet.** The
directory and the verb are specified in
pandoscope/agentic-engineering-template#121 and implemented in its
PR #125; until that lands and the store is restamped, `--predict` is
an unknown flag.

Until then, do not silently fall back: the marker reads
`DECISION(unrecorded — predictions/ not yet in this store):`, which
says *this store cannot take the record* rather than *the store was
down*. Those two need to stay distinguishable, or an absent capability
gets filed as weather and nobody ever builds it.

## Never

- bump a preference counter — `submit` reads `decisions/` only, and
  that is the point
- write to `decisions/` from an autonomous run; a ruling needs a ruler
- record a choice the principal already made in the ticket; that is
  not a prediction, it is instruction-following
