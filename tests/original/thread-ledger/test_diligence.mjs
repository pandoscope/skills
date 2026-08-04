// The diligence report — friction and cost over the compliance log.
//
// Fixtures here are compliance records, not turns of real work: the
// report is a pure function over that log, and the log is the contract.

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { perCheck, perModel, report, turnsOf } from "../../../original/thread-ledger/diligence.mjs";

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
