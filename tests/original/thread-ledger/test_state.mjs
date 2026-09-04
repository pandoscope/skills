// The state machine, the guards on an append, and the fold.
//
// These are the parts that can be wrong in ways nothing else would
// notice, so they carry the tests. IO is a thin shell over them.

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  currentStates,
  fold,
  orderClosed,
  orderOpen,
  stamp,
  validate,
} from "../../../original/thread-ledger/core.mjs";
import {
  bar,
  renderBody,
} from "../../../original/thread-ledger/views.mjs";
import {
  opened,
  throws,
} from "./helpers.mjs";

// ------------------------------------------------------- state machine

describe("StateMachine", () => {
  it("a thread opens from nothing", () => {
    validate(opened("a"), []);
  });

  it("reopening an open thread is rejected", () => {
    throws(() => validate(opened("a"), [opened("a")]), "illegal transition");
  });

  it("completing twice is rejected", () => {
    const history = [opened("a"), { ev: "completed", thread: "a" }];
    throws(() => validate({ ev: "completed", thread: "a" }, history));
  });

  it("completed → reopened → completed is legal", () => {
    const history = [
      opened("a"),
      { ev: "completed", thread: "a" },
      opened("a", { ev: "reopened" }),
    ];
    validate({ ev: "completed", thread: "a" }, history);
  });

  it("progress on a blocked thread is rejected", () => {
    const history = [opened("a"), { ev: "blocked", thread: "a", on: "internal", what: "x" }];
    throws(() => validate({ ev: "progress", thread: "a", pct: 10 }, history), "unblocked");
  });

  it("unblocking restores progress", () => {
    const history = [
      opened("a"),
      { ev: "blocked", thread: "a", on: "internal", what: "x" },
      { ev: "unblocked", thread: "a" },
    ];
    validate({ ev: "progress", thread: "a", pct: 10 }, history);
  });

  it("an unknown event kind is rejected", () => {
    throws(() => validate({ ev: "invented", thread: "a" }, []), "unknown event kind");
  });
});

// --------------------------------------------------------------- guards

describe("Guards", () => {
  it("a thread needs a ticket or conversation_only", () => {
    throws(
      () => validate({ ev: "opened", thread: "a", title: "a" }, []),
      "exactly one",
    );
  });

  it("both ticket and conversation_only is rejected", () => {
    throws(
      () => validate(opened("a", { conversation_only: true }), []),
      "exactly one",
    );
  });

  it("promotion is one way", () => {
    const history = [opened("a")];
    throws(
      () => validate({ ev: "promoted", thread: "a", ticket: "o/r#2" }, history),
      "one-way",
    );
  });

  it("parking without a trigger is rejected", () => {
    throws(() => validate({ ev: "parked", thread: "a" }, [opened("a")]), "trigger");
  });

  it("a fork needs an existing parent", () => {
    throws(
      () => validate(opened("b", { parent: "ghost" }), [opened("a")]),
      "does not exist",
    );
  });

  it("progress needs an integer pct", () => {
    throws(() => validate({ ev: "progress", thread: "a" }, [opened("a")]), "integer");
  });

  it("blocked needs a named blocker", () => {
    throws(
      () => validate({ ev: "blocked", thread: "a", on: "internal" }, [opened("a")]),
      "what",
    );
  });

  // The dojo's incident discipline, in the validator's own suite
  // (skills#114): a shortcode ticket like "AET#137" validated, landed,
  // and the close-loop run later filed the unreadable reference under
  // "give the bot Issues read access" — a remedy that cannot work. The
  // refusal belongs at the write, in the same words as the pr check's.
  it("an opened event refuses a ticket that is not owner/repo#n", () => {
    for (const bad of ["#137", "AET#137", "pandoscope/skills #46", "owner/repo#", "owner/repo", "o/r#1 extra"]) {
      throws(
        () => validate({ ev: "opened", thread: "t", title: "t", ticket: bad }, []),
        "ticket must look like owner/repo#123",
      );
    }
  });

  it("promoted refuses the same malformed shapes", () => {
    const history = [
      { ev: "opened", thread: "t", title: "t", conversation_only: true },
    ];
    throws(
      () => validate({ ev: "promoted", thread: "t", ticket: "AET#137" }, history),
      "ticket must look like owner/repo#123",
    );
  });

  it("dots and dashes in either segment still pass", () => {
    validate(
      { ev: "opened", thread: "t", title: "t", ticket: "some-org.x/repo-a.b#12" },
      [],
    );
    validate(
      { ev: "promoted", thread: "c", ticket: "some-org.x/repo-a.b#12" },
      [{ ev: "opened", thread: "c", title: "c", conversation_only: true }],
    );
  });

  it("recorder-owned fields are overwritten", () => {
    const stamped = stamp(
      { ...opened("a"), at: "1999-01-01T00:00:00+00:00", anchor: { session: "fake" } },
      "real",
      7,
    );
    assert.notEqual(stamped.at, "1999-01-01T00:00:00+00:00");
    assert.deepEqual(stamped.anchor, { session: "real", msg: 7 });
  });
});

// ------------------------------------------------------------- ordering

describe("Ordering", () => {
  it("priority propagates through the dependency chain", () => {
    // `b` is low priority but blocks nothing; `a` waits on it and is
    // urgent. The cluster ranks by the thread that must move first.
    const events = [
      opened("b", { urgency: "low" }),
      opened("a", { urgency: "high", deps: ["b"] }),
    ];
    const order = orderOpen(fold(events)).map((t) => t.thread);
    assert.deepEqual(order, ["b", "a"]);
  });

  it("a blocked thread keeps its place", () => {
    const events = [
      opened("a", { urgency: "high" }),
      opened("b"),
      { ev: "blocked", thread: "a", on: "external", what: "x" },
    ];
    assert.equal(orderOpen(fold(events))[0].thread, "a");
  });

  it("ties break by event order, not timestamp", () => {
    const events = [
      { ...opened("a"), at: "2026-12-31T00:00:00+00:00" },
      { ...opened("b"), at: "2020-01-01T00:00:00+00:00" },
    ];
    assert.deepEqual(orderOpen(fold(events)).map((t) => t.thread), ["a", "b"]);
  });

  it("a dependency cycle does not hang", () => {
    const events = [opened("a", { deps: ["b"] }), opened("b", { deps: ["a"] })];
    assert.equal(orderOpen(fold(events)).length, 2);
  });

  it("closed threads sort by completion order", () => {
    const events = [
      opened("a"),
      opened("b"),
      { ev: "completed", thread: "b" },
      { ev: "completed", thread: "a" },
    ];
    assert.deepEqual(orderClosed(fold(events)).map((t) => t.thread), ["b", "a"]);
  });

  it("dropped is terminal but not done", () => {
    const events = [opened("a"), { ev: "dropped", thread: "a", note: "why" }];
    const [thread] = orderClosed(fold(events));
    assert.equal(thread.state, "dropped");
    assert.notEqual(thread.pct, 100);
  });

  it("completing a thread fills its bar", () => {
    const events = [opened("a"), { ev: "completed", thread: "a" }];
    assert.equal(fold(events)[0].pct, 100);
  });
});

// -------------------------------------------------------------- folding

describe("Folding", () => {
  it("metadata events never overwrite the work state", () => {
    const events = [
      { ...opened("a"), ticket: null, conversation_only: true },
      { ev: "blocked", thread: "a", on: "internal", what: "x" },
      { ev: "promoted", thread: "a", ticket: "o/r#9" },
    ];
    assert.equal(currentStates(events).a, "blocked");
    const [thread] = fold(events);
    assert.equal(thread.ticket, "o/r#9");
    assert.deepEqual(thread.blocked, { on: "internal", what: "x" });
  });
});

// ----------------------------------------------------- metadata events

describe("MetadataEvents", () => {
  const convo = (thread) => ({
    ev: "opened",
    thread,
    title: thread,
    conversation_only: true,
  });

  it("a blocked thread can be promoted", () => {
    const history = [convo("a"), { ev: "blocked", thread: "a", on: "internal", what: "x" }];
    validate({ ev: "promoted", thread: "a", ticket: "o/r#1" }, history);
  });

  it("promotion leaves the work state alone", () => {
    const events = [
      convo("a"),
      { ev: "blocked", thread: "a", on: "internal", what: "x" },
      { ev: "promoted", thread: "a", ticket: "o/r#1" },
    ];
    assert.equal(currentStates(events).a, "blocked");
  });

  it("a promoted thread still needs its unblock", () => {
    const history = [
      convo("a"),
      { ev: "blocked", thread: "a", on: "internal", what: "x" },
      { ev: "promoted", thread: "a", ticket: "o/r#1" },
    ];
    throws(() => validate({ ev: "progress", thread: "a", pct: 10 }, history), "unblocked");
  });

  it("promotion stays one way across a block", () => {
    const history = [
      convo("a"),
      { ev: "promoted", thread: "a", ticket: "o/r#1" },
      { ev: "blocked", thread: "a", on: "internal", what: "x" },
    ];
    throws(() => validate({ ev: "promoted", thread: "a", ticket: "o/r#2" }, history), "one-way");
  });

  it("a finished thread cannot be promoted", () => {
    const history = [convo("a"), { ev: "completed", thread: "a" }];
    throws(() => validate({ ev: "promoted", thread: "a", ticket: "o/r#1" }, history), "completed");
  });

  it("a promoted thread loses its NO TICKET picker", () => {
    const events = [convo("a"), { ev: "promoted", thread: "a", ticket: "o/r#1" }];
    assert.doesNotMatch(renderBody(fold(events), "t"), /NO TICKET/);
  });
});

// ------------------------------------------------------------- seals

// The seal marks a TURN's bookkeeping complete, so it belongs to the
// log rather than to any thread. Everything below pins that separation:
// a seal needs no thread, and it must be invisible to every function
// that answers a question about one.
describe("Seals", () => {
  it("a seal is legal on an empty log", () => {
    validate({ ev: "sealed" }, []);
  });

  it("a seal names no thread", () => {
    throws(() => validate({ ev: "sealed", thread: "a" }, []), "not about a thread");
  });

  it("a seal leaves the work state alone", () => {
    const events = [opened("a"), { ev: "progress", thread: "a", pct: 10 }, { ev: "sealed" }];
    assert.deepEqual(currentStates(events), { a: "progress" });
  });

  it("a sealed thread is not a thread", () => {
    assert.deepEqual(
      fold([opened("a"), { ev: "sealed" }]).map((item) => item.thread),
      ["a"],
    );
  });
});
