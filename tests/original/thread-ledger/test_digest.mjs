// The diligence digest and the stretch fold.

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  stretchesOf,
  validate,
} from "../../../original/thread-ledger/core.mjs";
import { parseArgs } from "../../../original/thread-ledger/ledger.mjs";
import {
  opened,
  throws,
  digest,
  sessEvent,
  sealDigest,
} from "./helpers.mjs";

describe("DiligenceDigest", () => {
  it("a seal without a digest stays valid", () => {
    validate({ ev: "sealed" }, []);
  });

  it("a seal carries a well-formed digest", () => {
    validate({ ev: "sealed", diligence: digest() }, []);
  });

  it("tokens may be null — a reset is a gap, not a number", () => {
    validate({ ev: "sealed", diligence: digest({ tokens: null, reset: true }) }, []);
  });

  it("a digest that is not an object is rejected", () => {
    throws(() => validate({ ev: "sealed", diligence: "looks fine" }, []), "diligence");
  });

  it("a digest without a turn count is rejected", () => {
    throws(() => validate({ ev: "sealed", diligence: digest({ turns: undefined }) }, []), "turns");
  });

  it("a digest with a non-integer execution count is rejected", () => {
    const bad = digest({ executions: { sealed: 1, blocked: "two", unsealed: 0, observed: 0 } });
    throws(() => validate({ ev: "sealed", diligence: bad }, []), "executions");
  });

  it("a digest with an unknown outcome is rejected", () => {
    const bad = digest({ executions: { sealed: 1, blocked: 0, unsealed: 0, observed: 0, crashed: 1 } });
    throws(() => validate({ ev: "sealed", diligence: bad }, []), "executions");
  });

  it("a check row missing a counter is rejected", () => {
    const bad = digest({ checks: { pushed: { fired: 1, cleared: 1 } } });
    throws(() => validate({ ev: "sealed", diligence: bad }, []), "checks");
  });

  it("tokens missing a component is rejected — a partial sum reads as a total", () => {
    const bad = digest({ tokens: { input: 1, output: 2, cacheRead: 3 } });
    throws(() => validate({ ev: "sealed", diligence: bad }, []), "tokens");
  });

  it("models must be strings", () => {
    throws(() => validate({ ev: "sealed", diligence: digest({ models: [42] }) }, []), "models");
  });

  it("a digest on a thread event is rejected — it describes a stretch, not a thread", () => {
    const event = { ...opened("a"), diligence: digest() };
    throws(() => validate(event, []), "diligence");
  });

  it("the CLI has no flag that reaches the digest", () => {
    throws(() => parseArgs(["append", "--diligence", "{}"]), "unknown option");
  });
});

describe("StretchFold", () => {
  it("groups stretches by session, bounded at each seal", () => {
    const events = [
      sessEvent("s1", 0, opened("a")),
      sessEvent("s1", 1, { ev: "sealed", diligence: sealDigest() }),
      sessEvent("s1", 2, { ev: "progress", thread: "a", pct: 10 }),
      sessEvent("s1", 3, { ev: "sealed", diligence: sealDigest() }),
      sessEvent("s2", 4, opened("b")),
      sessEvent("s2", 5, { ev: "sealed", diligence: sealDigest() }),
    ];
    const sessions = stretchesOf(events);
    assert.deepEqual(sessions.map((entry) => entry.session).sort(), ["s1", "s2"]);
    const s1 = sessions.find((entry) => entry.session === "s1");
    assert.equal(s1.stretches.length, 2);
    assert.deepEqual(s1.stretches[0].threads, ["a"]);
  });

  it("a stretch's span runs from the previous seal to its own", () => {
    const events = [
      sessEvent("s1", 0, opened("a")),
      sessEvent("s1", 2, { ev: "sealed", diligence: sealDigest() }),
      sessEvent("s1", 14, { ev: "sealed", diligence: sealDigest() }),
    ];
    const [s1] = stretchesOf(events);
    // First stretch: from the session's first event. Second: from the
    // previous seal.
    assert.equal(s1.stretches[0].spanMs, 2 * 60000);
    assert.equal(s1.stretches[1].spanMs, 12 * 60000);
  });

  it("events after the last seal are the unsealed tail", () => {
    const events = [
      sessEvent("s1", 0, opened("a")),
      sessEvent("s1", 1, { ev: "sealed", diligence: sealDigest() }),
      sessEvent("s1", 2, { ev: "progress", thread: "a", pct: 30 }),
    ];
    const [s1] = stretchesOf(events);
    assert.deepEqual(s1.tail.threads, ["a"]);
  });

  // The digest is a projection of retained data. When the seal itself
  // carries none (it predates the field) but the raw per-Stop records
  // reached the store, the projection is computed at render time — the
  // same digestOf, joined by the msg both sides already carry.
  it("raw records give a digest-less seal a render-time digest", () => {
    const rec = (msg, outcome, output, cycle = 1) => ({
      session: "s1",
      msg,
      cycle,
      outcome,
      fired: outcome === "blocked" ? "ledger-event" : null,
      model: "model-a",
      tokens: { input: 0, output, cacheRead: 0, cacheCreation: 0 },
      verdicts: [],
    });
    const events = [
      sessEvent("s1", 0, { ...opened("a"), anchor: { session: "s1", msg: 1 } }),
      sessEvent("s1", 1, { ev: "sealed", anchor: { session: "s1", msg: 1 } }),
      sessEvent("s1", 2, { ev: "progress", thread: "a", pct: 10, anchor: { session: "s1", msg: 2 } }),
      sessEvent("s1", 3, { ev: "sealed", anchor: { session: "s1", msg: 2 } }),
    ];
    const records = [
      rec(1, "sealed", 100),
      rec(2, "blocked", 250),
      rec(2, "sealed", 300, 2),
    ];
    const [s1] = stretchesOf(events, records);
    assert.equal(s1.stretches[0].digest.executions.sealed, 1);
    assert.equal(s1.stretches[1].digest.executions.blocked, 1);
    // Token cost differences against the previous stretch's last record.
    assert.equal(s1.stretches[1].digest.tokens.output, 200);
  });

  it("a seal with no matching records stays legacy", () => {
    const events = [
      sessEvent("s1", 0, { ...opened("a"), anchor: { session: "s1", msg: 1 } }),
      sessEvent("s1", 1, { ev: "sealed", anchor: { session: "s1", msg: 1 } }),
    ];
    const other = [{ session: "s2", msg: 1, outcome: "sealed", tokens: null, verdicts: [] }];
    const [s1] = stretchesOf(events, other);
    assert.equal(s1.stretches[0].digest, null);
  });

  it("a legacy seal folds with no digest, and stays a stretch", () => {
    const events = [
      sessEvent("s1", 0, opened("a")),
      sessEvent("s1", 1, { ev: "sealed" }),
    ];
    const [s1] = stretchesOf(events);
    assert.equal(s1.stretches.length, 1);
    assert.equal(s1.stretches[0].digest, null);
  });

  it("sessions come newest-last-event first, for the chip order", () => {
    const events = [
      sessEvent("old", 0, opened("a")),
      sessEvent("old", 1, { ev: "sealed" }),
      sessEvent("new", 2, opened("b")),
      sessEvent("new", 3, { ev: "sealed" }),
    ];
    assert.deepEqual(stretchesOf(events).map((entry) => entry.session), ["new", "old"]);
  });
});
