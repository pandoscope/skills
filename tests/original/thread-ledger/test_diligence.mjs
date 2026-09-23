// The diligence report — friction and cost over the compliance log.
//
// Fixtures here are compliance records, not turns of real work: the
// report is a pure function over that log, and the log is the contract.

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  digestOf,
  disputed,
  perCheck,
  perModel,
  report,
  stretchOf,
  turnsOf,
  validDisputes,
} from "../../../original/thread-ledger/diligence.mjs";
import { validateDiligence } from "../../../original/thread-ledger/core.mjs";

/** One compliance record, with the fields the report reads. */
function stamp(msg, cycle, opts = {}) {
  return {
    session: opts.session ?? "s1",
    msg,
    cycle,
    model: "model" in opts ? opts.model : "model-a",
    tokens: { input: 0, output: opts.output ?? 0, cacheRead: 0, cacheCreation: 0 },
    outcome: opts.outcome ?? "sealed",
    fired: opts.fired ?? null,
    verdicts: opts.verdicts ?? [
      { check: "turn-summary", verdict: "pass" },
      { check: "ledger-event", verdict: "pass" },
    ],
  };
}

const failedLedger = [
  { check: "turn-summary", verdict: "pass" },
  { check: "ledger-event", verdict: "fail" },
];

describe("Diligence", () => {
  it("groups a turn's cycles and prices the correction", () => {
    const records = [
      stamp(4, 1, { outcome: "blocked", fired: "ledger-event", verdicts: failedLedger, output: 1000 }),
      stamp(4, 2, { output: 1350 }),
    ];
    const [turn] = turnsOf(records);
    assert.equal(turn.cycles, 2);
    // The reminder's price in round-trips, which is what makes it
    // comparable across checks that cost very different token amounts.
    assert.equal(turn.extra, 1);
    assert.equal(turn.cost.output, 350);
  });

  // A turn that passed first time has no second stamp to difference
  // against, and reporting that as a free turn would understate every
  // average it lands in.
  it("a single-cycle turn has unknown cost, not zero", () => {
    const [turn] = turnsOf([stamp(5, 1, { output: 900 })]);
    assert.equal(turn.cost, null);
    assert.equal(turn.extra, 0);
  });

  // Two conversations writing one log both have a turn 3.
  it("turns are keyed by session as well as index", () => {
    const turns = turnsOf([stamp(3, 1), stamp(3, 1, { session: "s2" })]);
    assert.equal(turns.length, 2);
  });

  it("cycle 1 is the unprompted baseline, later cycles are not", () => {
    const records = [
      stamp(1, 1, { outcome: "blocked", fired: "ledger-event", verdicts: failedLedger }),
      stamp(1, 2),
    ];
    const [turn] = turnsOf(records);
    assert.equal(turn.unprompted["ledger-event"], "fail");
    assert.equal(turn.final["ledger-event"], "pass");
  });

  it("a check that fires and passes next cycle counts as cleared", () => {
    const records = [
      stamp(1, 1, { outcome: "blocked", fired: "ledger-event", verdicts: failedLedger }),
      stamp(1, 2),
    ];
    const row = perCheck(records, turnsOf(records)).find((r) => r.check === "ledger-event");
    assert.equal(row.fired, 1);
    assert.equal(row.cleared, 1);
    assert.equal(row.unpromptedFail, 1);
  });

  // A shadowed check's would-be failure is its own column (skills#192):
  // never a fail, never fired, and the rate that argues for arming it.
  it("counts a shadow verdict apart from failures", () => {
    const shadowed = [{ check: "branch-pattern", verdict: "shadow", detail: "off pattern" }];
    const records = [stamp(1, 1, { verdicts: shadowed }), stamp(2, 1, { verdicts: shadowed })];
    const row = perCheck(records, turnsOf(records)).find((r) => r.check === "branch-pattern");
    assert.equal(row.shadow, 2);
    assert.equal(row.unpromptedFail, 0);
    assert.equal(row.fired, 0);
    assert.match(report(records), /branch-pattern.*100%/);
  });

  // A check that fired and did NOT clear is pure cost — the case the
  // report exists to make visible, so it must not be counted as help.
  it("a check that fires and does not clear is not cleared", () => {
    const records = [
      stamp(1, 1, { outcome: "blocked", fired: "ledger-event", verdicts: failedLedger }),
      stamp(1, 2, { outcome: "unsealed", fired: "ledger-event", verdicts: failedLedger }),
    ];
    const row = perCheck(records, turnsOf(records)).find((r) => r.check === "ledger-event");
    assert.equal(row.cleared, 0);
  });

  // A check that never looked at anything must not be averaged in as a
  // pass — that is the whole reason the hook records a third value.
  it("unconfigured is counted apart from pass and fail", () => {
    const records = [
      stamp(1, 1, {
        verdicts: [{ check: "decision-record", verdict: "unconfigured" }],
      }),
    ];
    const row = perCheck(records, turnsOf(records)).find((r) => r.check === "decision-record");
    assert.equal(row.unconfigured, 1);
    assert.equal(row.unpromptedFail, 0);
  });

  it("a model is scored on turns it got right before being told", () => {
    const records = [
      stamp(1, 1),
      stamp(2, 1, { outcome: "blocked", fired: "ledger-event", verdicts: failedLedger, output: 10 }),
      stamp(2, 2, { output: 210 }),
    ];
    const [row] = perModel(turnsOf(records));
    assert.equal(row.turns, 2);
    assert.equal(row.clean, 1);
    assert.equal(row.extra, 1);
    assert.equal(row.output, 200);
  });

  it("a record with no model is not silently merged into one that has", () => {
    const rows = perModel(turnsOf([stamp(1, 1), stamp(2, 1, { model: null })]));
    assert.deepEqual(rows.map((row) => row.model).sort(), ["(unrecorded)", "model-a"]);
  });

  // Compaction rewrites the transcript, so the cumulative counters can
  // move BACKWARDS between two stamps of one turn. A negative cost is
  // not a discount; it is a reset observed mid-turn, and reporting it
  // as data would quietly subtract from every aggregate it lands in.
  it("a counter reset mid-turn makes the cost unknown, not negative", () => {
    const records = [
      stamp(6, 1, { outcome: "blocked", fired: "ledger-event", verdicts: failedLedger, output: 9000 }),
      stamp(6, 2, { output: 40 }),
    ];
    const [turn] = turnsOf(records);
    assert.equal(turn.cost, null);
  });

  // The research split this measure demands: a first-pass miss is
  // attention, a miss REPEATED after the reminder was delivered is the
  // model ignoring known work. The complement of cleared conflates that
  // with "turn ended, nothing was ignored" — so ignored is its own
  // column, and the two cannot be told apart from cleared alone.
  it("failing again after the reminder counts as ignored, not merely uncleared", () => {
    const shown = [
      stamp(1, 1, { outcome: "blocked", fired: "ledger-event", verdicts: failedLedger }),
      stamp(1, 2, { outcome: "unsealed", fired: "ledger-event", verdicts: failedLedger }),
    ];
    const interrupted = [
      stamp(2, 1, { outcome: "blocked", fired: "ledger-event", verdicts: failedLedger }),
    ];
    const row = perCheck([...shown, ...interrupted], turnsOf([...shown, ...interrupted])).find(
      (r) => r.check === "ledger-event",
    );
    assert.equal(row.fired, 3);
    assert.equal(row.ignored, 1); // cycle 2 of turn 1 — reminder shown, still failing
    assert.equal(row.cleared, 0); // turn 2's single stamp ignored nothing: no reminder landed
  });

  it("the baseline caveat is printed: cycle 1 is aware, not unmonitored", () => {
    assert.match(report([stamp(1, 1)]), /knows the hook exists/);
  });

  // The limits travel with the numbers. A measurement whose caveats
  // live in a ticket gets quoted without them.
  it("prints what it cannot see alongside what it can", () => {
    const text = report([stamp(1, 1)]);
    assert.match(text, /upper bound/);
    assert.match(text, /compliance, not value/);
    assert.match(text, /unknown,\n {4}never zero/);
  });

  it("says so rather than dividing by zero on an empty log", () => {
    assert.match(report([]), /nothing to measure/);
  });
});

// ------------------------------------------------------------ stretches

describe("Stretches", () => {
  it("the first stretch spans the whole log, with no baseline", () => {
    const records = [stamp(1, 1, { output: 100 })];
    const { window, baseline } = stretchOf(records, "s1");
    assert.equal(window.length, 1);
    assert.equal(baseline, null);
  });

  it("a stretch starts after the previous seal and ends at the current one", () => {
    const records = [
      stamp(1, 1, { output: 100 }),
      stamp(2, 1, { outcome: "blocked", fired: "ledger-event", verdicts: failedLedger, output: 200 }),
      stamp(2, 2, { output: 300 }),
    ];
    const { window, baseline } = stretchOf(records, "s1");
    assert.equal(window.length, 2);
    assert.equal(baseline.msg, 1);
  });

  it("another session's records are not in the window", () => {
    const records = [stamp(3, 1, { session: "s2" }), stamp(4, 1)];
    const { window } = stretchOf(records, "s1");
    assert.deepEqual(window.map((record) => record.msg), [4]);
  });
});

describe("Digest", () => {
  it("a clean single-turn stretch digests quiet", () => {
    const { window, baseline } = stretchOf([stamp(1, 1, { output: 500 })], "s1");
    const digest = digestOf(window, baseline);
    assert.equal(digest.turns, 1);
    assert.deepEqual(digest.executions, { sealed: 1, blocked: 0, unsealed: 0, observed: 0 });
    assert.deepEqual(digest.checks, {});
    assert.equal(digest.tokens.output, 500);
    assert.deepEqual(digest.models, ["model-a"]);
    assert.equal(digest.reset, undefined);
  });

  it("the digest it writes is the digest the schema accepts", () => {
    const { window, baseline } = stretchOf([stamp(1, 1, { output: 500 })], "s1");
    validateDiligence(digestOf(window, baseline));
  });

  it("stretch tokens are the counter difference from the previous seal", () => {
    const records = [
      stamp(1, 1, { output: 100 }),
      stamp(2, 1, { outcome: "blocked", fired: "ledger-event", verdicts: failedLedger, output: 200 }),
      stamp(2, 2, { output: 350 }),
    ];
    const { window, baseline } = stretchOf(records, "s1");
    assert.equal(digestOf(window, baseline).tokens.output, 250);
  });

  it("a counter reset inside the window is a gap, never zero", () => {
    const records = [
      stamp(1, 1, { output: 9000 }),
      stamp(2, 1, { output: 40 }),
    ];
    const { window, baseline } = stretchOf(records, "s1");
    const digest = digestOf(window, baseline);
    assert.equal(digest.tokens, null);
    assert.equal(digest.reset, true);
  });

  it("counts reminders and gave-ups by outcome", () => {
    const records = [
      stamp(1, 1, { outcome: "blocked", fired: "ledger-event", verdicts: failedLedger }),
      stamp(1, 2, { outcome: "unsealed", fired: "ledger-event", verdicts: failedLedger }),
      stamp(2, 1, { outcome: "blocked", fired: "turn-summary", verdicts: failedLedger }),
      stamp(2, 2, { output: 10 }),
    ];
    const { window, baseline } = stretchOf(records, "s1");
    const digest = digestOf(window, baseline);
    assert.equal(digest.turns, 2);
    assert.deepEqual(digest.executions, { sealed: 1, blocked: 2, unsealed: 1, observed: 0 });
  });

  it("per-check counters cover only checks that fired", () => {
    const records = [
      stamp(1, 1, { outcome: "blocked", fired: "ledger-event", verdicts: failedLedger }),
      stamp(1, 2, { output: 10 }),
    ];
    const { window, baseline } = stretchOf(records, "s1");
    assert.deepEqual(digestOf(window, baseline).checks, {
      "ledger-event": { fired: 1, cleared: 1, ignored: 0 },
    });
  });

  it("models are the distinct ones seen, unknowns dropped", () => {
    const records = [
      stamp(1, 1, { outcome: "blocked", fired: "ledger-event", verdicts: failedLedger, model: "model-b" }),
      stamp(1, 2, { model: null }),
    ];
    const { window, baseline } = stretchOf(records, "s1");
    assert.deepEqual(digestOf(window, baseline).models, ["model-b"]);
  });
});

// -------------------------------------------------------------- disputes

// A dispute corrects the ACCOUNTING for a filed check defect (#66):
// three false-positive classes were measured this leg (#73, #86, #89),
// and each booked its firings as model non-compliance. The records are
// immutable, so the correction lives beside the corpus, is bounded by
// timestamps, and must cite the ticket that names the defect.
describe("Disputes", () => {
  const window = {
    check: "decision-record",
    ticket: "o/skills#86",
    reason: "kata fixture literals counted as markers",
    from: "2026-08-03T00:00:00Z",
    until: "2026-08-06T09:26:00Z",
  };

  it("a dispute needs check, ticket, reason and from — or it is dropped", () => {
    const { disputes, invalid } = validDisputes([
      window,
      { ...window, ticket: "no number" },
      { ...window, reason: "" },
      { ...window, from: "not a date" },
      "garbage",
    ]);
    assert.equal(disputes.length, 1);
    assert.equal(invalid, 4);
  });

  it("matches by check and window; an open dispute has no end", () => {
    assert.ok(disputed("decision-record", "2026-08-05T12:00:00Z", [window]));
    assert.ok(!disputed("ledger-event", "2026-08-05T12:00:00Z", [window]));
    assert.ok(!disputed("decision-record", "2026-08-07T00:00:00Z", [window]));
    assert.ok(disputed("decision-record", "2026-08-07T00:00:00Z", [{ ...window, until: null }]));
    assert.ok(!disputed("decision-record", null, [window]));
  });

  it("a disputed failure is billed to neither side of the rate", () => {
    const at = "2026-08-05T12:00:00Z";
    const failed = [{ check: "decision-record", verdict: "fail" }];
    const records = [
      { ...stamp(1, 1, { outcome: "blocked", fired: "decision-record", verdicts: failed }), at },
      { ...stamp(2, 1, { verdicts: [{ check: "decision-record", verdict: "pass" }] }), at },
    ];
    const turns = turnsOf(records);
    const clean = perCheck(records, turns).find((r) => r.check === "decision-record");
    assert.equal(clean.unpromptedFail, 1);
    assert.equal(clean.fired, 1);
    const row = perCheck(records, turns, [window]).find((r) => r.check === "decision-record");
    assert.equal(row.disputed, 2, "the failing verdict and the firing, apart");
    assert.equal(row.unpromptedFail, 0);
    assert.equal(row.fired, 0);
    // The denominator shrinks with the numerator: only the undisputed
    // turn is counted, so the rate is not quietly diluted.
    assert.equal(row.turns, 1);
  });

  it("a pass inside the window still counts — the defect class is false positives", () => {
    const at = "2026-08-05T12:00:00Z";
    const records = [
      { ...stamp(3, 1, { verdicts: [{ check: "decision-record", verdict: "pass" }] }), at },
    ];
    const turns = turnsOf(records);
    const row = perCheck(records, turns, [window]).find((r) => r.check === "decision-record");
    assert.equal(row.turns, 1);
    assert.equal(row.disputed, 0);
  });

  it("the report names the applied disputes and their tickets", () => {
    const at = "2026-08-05T12:00:00Z";
    const records = [{ ...stamp(4, 1), at }];
    const text = report(records, [window]);
    assert.match(text, /Disputes applied/);
    assert.match(text, /o\/skills#86/);
    assert.match(text, /disputed/);
  });
});
