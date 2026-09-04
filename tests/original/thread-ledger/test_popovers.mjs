// The page's interactive parts — anchors, popovers, the crash path.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import {
  currentStates,
  fold,
  isUserTurn,
  lastUserTurnAt,
  transcriptUsage,
  orderOpen,
  stamp,
  tierOf,
  validate,
} from "../../../original/thread-ledger/core.mjs";
import {
  CSS,
  renderBody,
} from "../../../original/thread-ledger/views.mjs";
import {
  countUserMessages,
  renderPage,
} from "../../../original/thread-ledger/ledger.mjs";
import {
  opened,
  throws,
  PAGE_JS,
} from "./helpers.mjs";

// ------------------------------------------------------------- anchors

describe("Anchors", () => {
  const transcript = (records) => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "tr-")), "t.jsonl");
    fs.writeFileSync(file, records.map((r) => JSON.stringify(r)).join("\n"), "utf8");
    return file;
  };

  it("tool results are not user turns", () => {
    // They carry type "user" too and outnumber real turns six to one.
    assert.equal(isUserTurn({ type: "user", message: { content: "hello" } }), true);
    assert.equal(
      isUserTurn({ type: "user", message: { content: [{ type: "tool_result" }] } }),
      false,
    );
    assert.equal(
      isUserTurn({ type: "user", message: { content: [{ type: "text", text: "hi" }] } }),
      true,
    );
  });

  it("counts only genuine turns", () => {
    const file = transcript([
      { type: "user", message: { content: "one" } },
      { type: "user", message: { content: [{ type: "tool_result" }] } },
      { type: "assistant", message: { content: "reply" } },
      { type: "user", message: { content: "two" } },
    ]);
    assert.equal(countUserMessages(file), 2);
  });

  it("a missing transcript yields no index", () => {
    assert.equal(countUserMessages(null), null);
    assert.equal(countUserMessages("/nope/missing.jsonl"), null);
  });

  // The newest user turn is where the current turn began, which is what
  // separates "this turn's bookkeeping" from the previous turn's.
  it("the turn boundary is the newest user turn's stamp", () => {
    const text = [
      { type: "user", message: { content: "one" }, timestamp: "2026-08-01T10:00:00.000Z" },
      { type: "assistant", message: { content: "reply" }, timestamp: "2026-08-01T10:01:00.000Z" },
      { type: "user", message: { content: "two" }, timestamp: "2026-08-01T10:02:00.000Z" },
      // A tool result is not a turn, so it cannot move the boundary.
      {
        type: "user",
        message: { content: [{ type: "tool_result" }] },
        timestamp: "2026-08-01T10:03:00.000Z",
      },
    ]
      .map((record) => JSON.stringify(record))
      .join("\n");
    assert.equal(lastUserTurnAt(text), "2026-08-01T10:02:00.000Z");
  });

  it("a transcript with no user turn has no boundary", () => {
    assert.equal(lastUserTurnAt(""), null);
    assert.equal(
      lastUserTurnAt(JSON.stringify({ type: "assistant", message: { content: "hi" } })),
      null,
    );
  });

  // Cost accounting. Each assistant message is one API call billed on
  // its own, so summing across them is the total rather than a double
  // count of one context — and the number is only useful as a
  // difference between two points, which is why it is stored raw.
  it("usage sums across every assistant message", () => {
    const call = (out, read, model) =>
      JSON.stringify({
        type: "assistant",
        message: {
          model,
          usage: {
            input_tokens: 5,
            output_tokens: out,
            cache_read_input_tokens: read,
            cache_creation_input_tokens: 0,
          },
        },
      });
    const text = [call(100, 1000, "model-a"), call(20, 1100, "model-a")].join("\n");
    assert.deepEqual(transcriptUsage(text), {
      model: "model-a",
      input: 10,
      output: 120,
      cacheRead: 2100,
      cacheCreation: 0,
    });
  });

  it("usage survives a torn line and a message with none", () => {
    const text = [
      '{"type":"assistant","message":{"model":"m","usage":{"output_tokens":7}}}',
      '{"type":"assistant","message":{"content":"no usage on this one"}}',
      '{"type":"user","message":{"content":"not counted"}}',
      '{"type":"assistant","message":{"usage":{"output_t',
    ].join("\n");
    assert.equal(transcriptUsage(text).output, 7);
    assert.equal(transcriptUsage("").model, null);
  });

  // A session can change model mid-run, and the verdict being recorded
  // belongs to whoever took THIS turn.
  it("the model is the newest one seen", () => {
    const text = [
      '{"type":"assistant","message":{"model":"old"}}',
      '{"type":"assistant","message":{"model":"new"}}',
    ].join("\n");
    assert.equal(transcriptUsage(text).model, "new");
  });

  // ------------------------------------------------- reprioritized

  // Priorities fold only on opening events, so without this a live
  // thread's urgency, importance and deps could never be corrected —
  // and the ledger cannot be the owner of fields it cannot amend.
  it("reprioritized updates deps, urgency and importance on a live thread", () => {
    const events = [
      opened("a", { urgency: "low" }),
      opened("b"),
      { ev: "reprioritized", thread: "a", urgency: "high", deps: ["b"] },
    ];
    validate(events[2], events.slice(0, 2));
    const [a] = fold(events);
    assert.equal(a.urgency, "high");
    assert.deepEqual(a.deps, ["b"]);
    assert.equal(a.importance, "normal");
  });

  // Metadata, not a move: correcting a blocked thread's priority must
  // not force a false unblocked into the log — same rule as promoted.
  it("reprioritized leaves the work state untouched", () => {
    const events = [
      opened("a"),
      { ev: "blocked", thread: "a", on: "internal", what: "w" },
    ];
    validate({ ev: "reprioritized", thread: "a", urgency: "high" }, events);
    const [a] = fold([...events, { ev: "reprioritized", thread: "a", urgency: "high" }]);
    assert.ok(a.blocked, "still blocked");
    assert.equal(currentStates([...events, { ev: "reprioritized", thread: "a", urgency: "high" }]).a, "blocked");
  });

  it("reprioritized needs a live thread and at least one field", () => {
    throws(
      () => validate({ ev: "reprioritized", thread: "ghost", urgency: "high" }, []),
      "ever opened",
    );
    throws(
      () => validate({ ev: "reprioritized", thread: "a" }, [opened("a")]),
      "at least one of",
    );
    throws(
      () => validate({ ev: "reprioritized", thread: "a", urgency: "sky-high" }, [opened("a")]),
      "urgency",
    );
    throws(
      () =>
        validate({ ev: "reprioritized", thread: "a", urgency: "high" }, [
          opened("a"),
          { ev: "completed", thread: "a" },
        ]),
      "is completed",
    );
  });

  it("a corrected priority moves the thread in the ordering", () => {
    const threads = fold([
      opened("quiet"),
      opened("loud"),
      { ev: "reprioritized", thread: "loud", urgency: "high", importance: "high" },
    ]);
    assert.equal(orderOpen(threads)[0].thread, "loud");
  });

  // ---------------------------------------------------- session filter

  it("the fold records which sessions touched a thread", () => {
    const [a] = fold([
      { ...opened("a"), anchor: { session: "s1", msg: 1 } },
      { ev: "progress", thread: "a", pct: 5, anchor: { session: "s2", msg: 3 } },
    ]);
    assert.deepEqual([...a.sessions].sort(), ["s1", "s2"]);
  });

  // ------------------------------------------------------ tier (SK#58)

  // The palette, as ruled: blocked+urgent red, blocked+important light
  // red, urgent orange, important yellow. Blocked-on-principal keeps
  // violet — the one state where the reader is the bottleneck — and the
  // quiet default stays quiet: a colour on everything is a colour on
  // nothing.
  it("tierOf implements the ruled palette with a quiet default", () => {
    const t = (extra) => tierOf({ urgency: "normal", importance: "normal", ...extra });
    assert.equal(t({ blocked: { on: "internal" }, urgency: "high" }), "blocking-urgent");
    assert.equal(t({ blocked: { on: "external" }, importance: "high" }), "blocking-important");
    assert.equal(t({ urgency: "high" }), "urgent");
    assert.equal(t({ importance: "high" }), "important");
    assert.equal(t({ blocked: { on: "principal" }, urgency: "high" }), null);
    assert.equal(t({}), null);
    // Urgency outranks importance when both apply.
    assert.equal(t({ blocked: { on: "internal" }, urgency: "high", importance: "high" }), "blocking-urgent");
  });

  it("the anchor shows index, distance and clock", () => {
    const events = [{ ...opened("a"), at: "2026-07-30T14:05:00+00:00", anchor: { session: "s", msg: 3 } }];
    const body = renderBody(fold(events), "t", 5);
    assert.match(body, /#3/);
    assert.match(body, /2 back/);
    assert.match(body, /14:05/);
  });

  it("the anchor degrades without a transcript", () => {
    const events = [{ ...opened("a"), at: "2026-07-30T14:05:00+00:00", anchor: { session: "s", msg: null } }];
    const body = renderBody(fold(events), "t", null);
    assert.match(body, /class="anchor"/);
    assert.doesNotMatch(body, /#null/);
  });

  it("no control characters reach the page", () => {
    const events = [opened("a", { title: "x" })];
    const page = renderPage(events, "t", null, {}, null);
    assert.doesNotMatch(page, /[\x00--]/);
  });
});

// ------------------------------------------------------------- popups

describe("Popups", () => {
  it("no ancestor of a popup clips it", () => {
    // A clipped card needs overflow:hidden, and that silently eats every
    // popup inside it.
    assert.doesNotMatch(CSS, /\.thread\{[^}]*overflow:hidden/);
  });

  it("the title filler is actually invoked", () => {
    // It was once defined and never called, which blanked every row.
    assert.match(PAGE_JS, /fitAll\(root\)/);
  });

  it("titles refit when the viewport changes", () => {
    assert.match(PAGE_JS, /addEventListener\("resize"/);
  });

  it("the full title is available behind the truncation", () => {
    const events = [opened("a", { title: "a very long title indeed" })];
    assert.match(renderBody(fold(events), "t"), /data-full="a very long title indeed"/);
  });

  it("the progress note rides in the title tooltip", () => {
    const events = [opened("a"), { ev: "progress", thread: "a", pct: 40, note: "the note" }];
    assert.match(renderBody(fold(events), "t"), /title="[^"]*the note/);
  });

  it("progress stays readable without the number", () => {
    const events = [opened("a"), { ev: "progress", thread: "a", pct: 40 }];
    const body = renderBody(fold(events), "t");
    assert.match(body, /--pct:40%/);
    assert.match(body, /aria-label="40 percent done"/);
  });

  it("tooltips are native, not overlays", () => {
    // Overlays failed twice — clipped by the card, then opening off the
    // bottom of the viewport — and each failure hid the text entirely.
    const events = [opened("a"), { ev: "blocked", thread: "a", on: "internal", what: "x" }];
    const body = renderBody(fold(events), "t");
    assert.doesNotMatch(body, /class="why"/);
    assert.match(body.match(/<span class="pill"[^>]*>/)[0], /title=/);
  });
});

// --------------------------------------------------------- the clipboard

describe("ClipboardFallback", () => {
  it("a second copy path exists", () => {
    // The async clipboard is refused in some embeddings; a click that
    // silently copies nothing is the bug being prevented.
    assert.match(PAGE_JS, /execCommand/);
  });

  it("the prompt is reachable without the script", () => {
    const events = [opened("a"), { ev: "stale", thread: "a", what: "scope grew" }];
    const body = renderBody(fold(events), "t");
    assert.match(body, /<details class="pop">/);
    assert.match(body, /scope grew/);
  });

  it("every attempt is logged for the report", () => {
    for (const fragment of ["async: resolved", "async: threw", "execCommand: returned"]) {
      assert.ok(PAGE_JS.includes(fragment), `missing ${fragment}`);
    }
  });

  it("a known block is not retried", () => {
    assert.match(PAGE_JS, /asyncBlocked/);
    assert.match(PAGE_JS, /NotAllowedError/);
  });
});

describe("ClosingThePopover", () => {
  it("there is an explicit close control", () => {
    const events = [opened("a"), { ev: "stale", thread: "a", what: "scope grew" }];
    assert.match(renderBody(fold(events), "t"), /class="x" type="button"/);
  });

  it("copying closes the box", () => {
    assert.match(PAGE_JS, /pop\.open = false/);
  });

  it("escape and outside clicks close it", () => {
    assert.match(PAGE_JS, /e\.key !== "Escape"/);
    assert.match(PAGE_JS, /!pop\.contains\(e\.target\)/);
  });
});

describe("PopoverStaysOnScreen", () => {
  it("it is clamped to the viewport", () => {
    assert.match(PAGE_JS, /innerWidth - EDGE - want/);
    assert.match(PAGE_JS, /Math\.max\(EDGE, top\)/);
  });

  it("it flips above when below does not fit", () => {
    assert.match(PAGE_JS, /anchor\.top - 6 - high/);
  });

  it("it is repositioned while open", () => {
    assert.match(PAGE_JS, /addEventListener\("scroll"/);
  });

  it("the unscripted placement still fits", () => {
    assert.match(CSS, /max-width:calc\(100vw - 1rem\)/);
  });
});

// -------------------------------------------------------- the crash path

describe("CrashReporting", () => {
  const page = () => renderPage([opened("a")], "t", null, {}, null);

  it("the failure state is the default, not something script must draw", () => {
    // A script that fails to parse never reaches its own error handler,
    // so the only reliable report is the one already in the markup.
    assert.match(page(), /render failed/);
    assert.match(page(), /id="crash-text"/);
  });

  it("the default carries a prompt to start debugging with", () => {
    assert.match(page(), /failed to render\. Debug it\./);
  });

  it("a successful boot removes it", () => {
    assert.match(PAGE_JS, /getElementById\("crash"\)\?\.remove\(\)/);
  });

  it("a caught error replaces the text in the markup too", () => {
    // Setting .value alone leaves a saved page reporting that the script
    // never ran, about a script that ran and threw.
    assert.match(PAGE_JS, /el\.textContent = text/);
  });

  it("the diagnostics default states the script did not run", () => {
    assert.match(page(), /script: DID NOT RUN/);
  });

  it("the script overwrites it when it runs", () => {
    assert.match(PAGE_JS, /script: RAN/);
  });

  it("errors are captured into the report", () => {
    assert.match(PAGE_JS, /addEventListener\("error"/);
  });
});
