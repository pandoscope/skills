// Tests for the thread ledger's pure core and its views.
//
// The state machine and the ordering are the parts that can be wrong in
// ways nothing else would notice, so they carry the tests. IO (git,
// transcript counting) is a thin shell over them.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  LedgerError,
  currentStates,
  fold,
  isUserTurn,
  lastUserTurnAt,
  transcriptUsage,
  mergeLogLines,
  orderClosed,
  orderOpen,
  sessionFromUrl,
  stamp,
  tierOf,
  validate,
} from "../../../original/thread-ledger/core.mjs";
import {
  CSS,
  bar,
  linkify,
  renderBody,
  renderMarkdown,
  singlePrompt,
  stalePrompt,
} from "../../../original/thread-ledger/views.mjs";
import {
  checkSessionFile,
  countUserMessages,
  parseArgs,
  readAll,
  renderPage,
  resolveSession,
} from "../../../original/thread-ledger/ledger.mjs";

const SKILL = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../original/thread-ledger",
);
const PAGE_JS = fs.readFileSync(path.join(SKILL, "page.mjs"), "utf8");

function opened(thread, extra = {}) {
  return { ev: "opened", thread, title: thread, ticket: "o/r#1", ...extra };
}

function throws(fn, fragment) {
  assert.throws(fn, (err) => {
    assert.ok(err instanceof LedgerError, `expected LedgerError, got ${err}`);
    if (fragment) assert.match(err.message, new RegExp(fragment, "i"));
    return true;
  });
}

/** A temp directory with a ledger/ inside, cleaned up by the caller. */
function tempStore() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ledger-test-"));
  fs.mkdirSync(path.join(root, "ledger"), { recursive: true });
  return root;
}

function writeLog(root, name, events) {
  fs.writeFileSync(
    path.join(root, "ledger", `${name}.jsonl`),
    events.map((e) => JSON.stringify(e)).join("\n") + "\n",
    "utf8",
  );
}

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

// ------------------------------------------------------------ rendering

describe("Rendering", () => {
  it("the page embeds every event", () => {
    // Rendering may summarize; the data may not. Graphs added later must
    // not need a second source.
    const events = [opened("a"), { ev: "progress", thread: "a", pct: 40 }];
    const page = renderPage(events, "t", null, {}, null);
    assert.match(page, /id="ledger-data"/);
    assert.match(page, /"pct":40/);
  });

  it("the page carries no rendered rows", () => {
    // State is folded in the browser from the events, so the file
    // carries each fact once.
    const events = [opened("a", { title: "unique-title-here" })];
    const page = renderPage(events, "t", null, {}, null);
    const body = page.slice(page.indexOf('<div id="view">'), page.indexOf("<script"));
    assert.doesNotMatch(body, /unique-title-here/);
  });

  it("ticket references linkify", () => {
    assert.match(linkify("see o/r#1"), /https:\/\/github\.com\/o\/r\/issues\/1/);
  });

  it("titles are escaped", () => {
    const events = [opened("a", { title: "<script>alert(1)</script>" })];
    assert.doesNotMatch(renderBody(fold(events), "t"), /<script>alert\(1\)<\/script>/);
  });

  it("the embedded payload cannot close its own script block", () => {
    const events = [opened("a", { title: "</script><b>x" })];
    const page = renderPage(events, "t", null, {}, null);
    const block = page.slice(page.indexOf('id="ledger-data"'));
    assert.doesNotMatch(block.slice(0, block.indexOf("</script>")), /<\/script>/);
  });
});

describe("TitlesWithoutScript", () => {
  it("the title text is in the row", () => {
    const events = [opened("a", { title: "ship the exporter" })];
    assert.match(renderBody(fold(events), "t"), /">ship the exporter<\/span>/);
  });

  it("the script only refits the text it finds", () => {
    const events = [opened("a", { title: "ship the exporter" })];
    assert.match(renderBody(fold(events), "t"), /data-full="ship the exporter"/);
  });
});

// ---------------------------------------------------------- tier colours

describe("TierColours", () => {
  it("a row carries its tier as a class, and quiet threads carry none", () => {
    const events = [
      opened("loud", { urgency: "high" }),
      opened("quiet"),
      opened("stuck", { importance: "high" }),
      { ev: "blocked", thread: "stuck", on: "internal", what: "w" },
    ];
    const body = renderBody(fold(events), "t");
    assert.match(body, /class="thread[^"]*t-urgent/);
    assert.match(body, /class="thread[^"]*t-blocking-important/);
    assert.doesNotMatch(body, /class="thread[^"]*t-(?:urgent|important)[^"]*"[^>]*>[\s\S]{0,40}quiet/);
  });

  // Violet is the page's own signal for the one state where the reader
  // is the bottleneck; a tier colour on top would bury it.
  it("blocked-on-principal keeps violet and takes no tier class", () => {
    const events = [
      opened("you", { urgency: "high" }),
      { ev: "blocked", thread: "you", on: "principal", what: "review" },
    ];
    const body = renderBody(fold(events), "t");
    assert.match(body, /s-blocked-principal/);
    assert.doesNotMatch(body, /t-blocking-urgent/);
  });

  it("the palette is in the stylesheet, both tiers of red", () => {
    assert.match(CSS, /t-blocking-urgent/);
    assert.match(CSS, /t-blocking-important/);
    assert.match(CSS, /t-urgent/);
    assert.match(CSS, /t-important/);
  });
});

// --------------------------------------------------------- session filter

describe("SessionFilter", () => {
  const withAnchors = [
    { ...opened("a", { title: "one" }), anchor: { session: "s1", msg: 1, url: "https://claude.test/s1" } },
    { ...opened("b", { title: "two" }), anchor: { session: "s2", msg: 4, url: "https://claude.test/s2" } },
    { ev: "progress", thread: "a", pct: 5, anchor: { session: "s2", msg: 5, url: "https://claude.test/s2" } },
  ];

  // The filter works on data the events already carry: every anchor
  // names its session, so the row only has to say which sessions its
  // events came from and the control only has to hide the rest.
  it("rows carry the sessions whose events built them", () => {
    const body = renderBody(fold(withAnchors), "t");
    assert.match(body, /data-sessions="[^"]*s1[^"]*s2|data-sessions="[^"]*s2[^"]*s1/);
    assert.match(body, /data-sessions="s2"/);
  });

  it("the page offers one filter option per session, ALL by default", () => {
    const body = renderBody(fold(withAnchors), "t");
    assert.match(body, /<select id="session-filter"/);
    assert.match(body, /<option value=""[^>]*>/);
    assert.match(body, /<option value="s1"/);
    assert.match(body, /<option value="s2"/);
  });

  it("a store with one session gets no filter control", () => {
    const events = [{ ...opened("a"), anchor: { session: "s1", msg: 1 } }];
    assert.doesNotMatch(renderBody(fold(events), "t"), /session-filter/);
  });
});

// -------------------------------------------------------------- session

describe("SessionLink", () => {
  const row = (page) => page.match(/<li class="thread[\s\S]*?<\/li>/)[0];

  it("no url renders no link", () => {
    const events = [opened("a", { title: "x" })];
    assert.doesNotMatch(row(renderBody(fold(events), "t")), /tlink/);
  });

  it("the title links to the session when known", () => {
    const events = [opened("a", { title: "x" })];
    const body = renderBody(fold(events), "t", null, {}, "https://example.test/s/1");
    assert.match(body, /href="https:\/\/example\.test\/s\/1"/);
  });

  it("a url is escaped like any other text", () => {
    const events = [opened("a", { title: "x" })];
    const body = renderBody(fold(events), "t", null, {}, '"><script>bad()</script>');
    assert.doesNotMatch(body, /<script>bad\(\)<\/script>/);
  });

  it("the url is remembered across calls", () => {
    const root = tempStore();
    const first = resolveSession(root, "https://x.test/s/abc", null, null);
    const second = resolveSession(root, null, null, null);
    assert.deepEqual(first, second);
    fs.rmSync(root, { recursive: true, force: true });
  });
});

describe("IdentityComesFromTheURL", () => {
  it("the id is the url's last segment", () => {
    assert.equal(sessionFromUrl("https://x.test/code/session_01ABC"), "session_01ABC");
  });

  it("a trailing slash does not change identity", () => {
    assert.equal(
      sessionFromUrl("https://x.test/code/session_01ABC/"),
      sessionFromUrl("https://x.test/code/session_01ABC"),
    );
  });

  it("characters unsafe in a filename are replaced", () => {
    assert.equal(sessionFromUrl("https://x.test/a%2Fb"), "a-2Fb");
  });

  it("a url with no path is refused", () => {
    throws(() => sessionFromUrl("https://x.test"), "no session id");
  });

  it("an explicit id still wins when no url is known", () => {
    const root = tempStore();
    const [session, url] = resolveSession(root, null, "chosen", null);
    assert.equal(session, "chosen");
    assert.equal(url, null);
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("with nothing at all it refuses rather than guesses", () => {
    const root = tempStore();
    throws(() => resolveSession(root, null, null, null), "cannot tell");
    fs.rmSync(root, { recursive: true, force: true });
  });
});

describe("OneLogPerConversation", () => {
  it("a different session id is refused", () => {
    const root = tempStore();
    writeLog(root, "chosen-name", [{ ...opened("a"), at: "2026-01-01T00:00:00+00:00" }]);
    throws(() => checkSessionFile(root, "uuid-stem"), "chosen-name");
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("the matching session id passes", () => {
    const root = tempStore();
    writeLog(root, "chosen-name", [{ ...opened("a"), at: "2026-01-01T00:00:00+00:00" }]);
    checkSessionFile(root, "chosen-name");
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("a genuinely multi-session store is left alone", () => {
    const root = tempStore();
    writeLog(root, "one", [{ ...opened("a"), at: "2026-01-01T00:00:00+00:00" }]);
    writeLog(root, "two", []);
    checkSessionFile(root, "three");
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("files order by stamp, not by name", () => {
    // "aaa" sorts first by name but is the later conversation.
    const root = tempStore();
    writeLog(root, "zzz", [{ ...opened("a"), at: "2026-01-01T00:00:00+00:00" }]);
    writeLog(root, "aaa", [{ ...opened("b", { ticket: "o/r#2" }), at: "2026-06-01T00:00:00+00:00" }]);
    assert.deepEqual(readAll(root).map((e) => e.thread), ["a", "b"]);
    fs.rmSync(root, { recursive: true, force: true });
  });
});

describe("PerThreadSessionLink", () => {
  it("the recorder stamps the url onto the event", () => {
    const stamped = stamp(opened("a"), "s", 1, "https://example.test/s/1");
    assert.equal(stamped.anchor.url, "https://example.test/s/1");
  });

  it("an unknown url leaves the anchor clean", () => {
    assert.ok(!("url" in stamp(opened("a"), "s", 1).anchor));
  });

  it("the fold carries the latest event's url", () => {
    const events = [
      { ...opened("a"), anchor: { session: "one", url: "https://one.test" } },
      { ev: "progress", thread: "a", pct: 50, anchor: { session: "two", url: "https://two.test" } },
    ];
    assert.equal(fold(events)[0].url, "https://two.test");
  });

  it("the markdown title is the link", () => {
    const events = [
      { ...opened("a", { title: "ship it" }), anchor: { session: "one", url: "https://one.test" } },
    ];
    const page = renderMarkdown(fold(events), "t");
    assert.match(page, /\[ship it\]\(https:\/\/one\.test\)/);
    assert.doesNotMatch(page, /Open the session/);
  });
});

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
      "no prior event",
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
      "illegal transition",
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
    assert.doesNotMatch(page, /[ --]/);
  });
});

// ---------------------------------------------------------- short codes

describe("ShortCodes", () => {
  const codes = { "pandoscope/skills": "SK" };

  it("a mapped repo renders its short code", () => {
    const events = [opened("a", { ticket: "pandoscope/skills#43" })];
    const body = renderBody(fold(events), "t", null, codes);
    assert.match(body, />SK#43</);
    assert.match(body, /https:\/\/github\.com\/pandoscope\/skills\/issues\/43/);
  });

  it("an unmapped repo falls back to its name", () => {
    const events = [opened("a", { ticket: "other/repo#7" })];
    assert.match(renderBody(fold(events), "t", null, codes), />other\/repo#7</);
  });

  it("a thread without a ticket has no prefix", () => {
    const events = [opened("a", { ticket: null, conversation_only: true })];
    assert.doesNotMatch(renderBody(fold(events), "t", null, codes), /class="ref"/);
  });
});

// -------------------------------------------------------- state pills

describe("StateEncoding", () => {
  const build = (extra) => renderBody(fold([opened("a"), ...extra]), "t");

  it("a quiet thread carries no state pill", () => {
    assert.doesNotMatch(build([]), /class="pill"/);
  });

  it("the card carries the state as a class", () => {
    assert.match(
      build([{ ev: "blocked", thread: "a", on: "internal", what: "x" }]),
      /s-blocked-internal/,
    );
  });

  it("blocking kinds are distinguishable", () => {
    const kinds = ["internal", "external", "principal"].map((on) =>
      build([{ ev: "blocked", thread: "a", on, what: "x" }]).match(/s-blocked-\w+/)[0],
    );
    assert.equal(new Set(kinds).size, 3);
  });

  it("the reason rides in a native tooltip", () => {
    const body = build([{ ev: "blocked", thread: "a", on: "internal", what: "the reason" }]);
    const pill = body.match(/<span class="pill"[^>]*>/)[0];
    assert.match(pill, /title="the reason"/);
  });

  it("a parked trigger is reachable from its pill", () => {
    assert.match(build([{ ev: "parked", thread: "a", trigger: "when X" }]), /trigger: when X/);
  });

  it("an unblocked thread carries no state class", () => {
    const body = build([
      { ev: "blocked", thread: "a", on: "internal", what: "x" },
      { ev: "unblocked", thread: "a" },
    ]);
    assert.doesNotMatch(body, /s-blocked/);
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

// ------------------------------------------------------- ticket picker

describe("TicketPicker", () => {
  const codes = { "o/one": "ONE", "o/two": "TWO" };

  it("a ticketless thread offers every repo", () => {
    const events = [opened("a", { ticket: null, conversation_only: true })];
    const body = renderBody(fold(events), "t", null, codes);
    assert.match(body, /NO TICKET/);
    assert.match(body, /value="o\/one"/);
    assert.match(body, /value="o\/two"/);
  });

  it("a ticketed thread offers no picker", () => {
    const events = [opened("a")];
    assert.doesNotMatch(renderBody(fold(events), "t", null, codes), /class="pick"/);
  });

  it("the picker carries what the prompt needs", () => {
    const events = [opened("a", { ticket: null, conversation_only: true, title: "the title" })];
    const body = renderBody(fold(events), "t", null, codes);
    assert.match(body, /data-thread="a"/);
    assert.match(body, /data-title="the title"/);
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

// -------------------------------------------------------- markdown view

describe("MarkdownView", () => {
  const md = (events, codes = {}) => renderMarkdown(fold(events), "t", null, codes);

  it("the bar shows its extent when empty", () => {
    assert.equal(bar(0).length, 10);
    assert.match(bar(0), /^░+$/);
  });

  it("the bar never overflows its width", () => {
    for (const pct of [0, 1, 33, 50, 99, 100, 150, -5]) {
      assert.equal([...bar(pct)].length, 10, `pct=${pct}`);
    }
  });

  it("it carries no css or script", () => {
    const page = md([opened("a")]);
    assert.doesNotMatch(page, /<style|<script|class=/);
  });

  it("notes hide behind a details disclosure", () => {
    const page = md([opened("a"), { ev: "progress", thread: "a", pct: 5, note: "the note" }]);
    assert.match(page, /<details><summary>note<\/summary>the note<\/details>/);
  });

  it("blockers and triggers are visible without a click", () => {
    const page = md([opened("a"), { ev: "blocked", thread: "a", on: "principal", what: "your call" }]);
    assert.match(page, /blocked · you/);
    assert.match(page, /your call/);
    assert.doesNotMatch(page, /<details><summary>note/);
  });

  it("ticket references in reasons become links", () => {
    const page = md([opened("a"), { ev: "blocked", thread: "a", on: "external", what: "waits on o/r#5" }]);
    assert.match(page, /\[o\/r#5\]\(https:\/\/github\.com\/o\/r\/issues\/5\)/);
  });

  it("both views read the same fold", () => {
    // A second view, never a second source.
    const events = [
      opened("a"),
      opened("b", { ticket: "o/r#2" }),
      { ev: "completed", thread: "b" },
    ];
    const threads = fold(events);
    const page = renderMarkdown(threads, "t");
    assert.equal(orderOpen(threads).length, 1);
    assert.match(page, /### Done/);
  });

  it("the generated banner warns against editing", () => {
    assert.match(md([opened("a")]), /overwritten on the next push/);
  });
});

// ------------------------------------------------------- stale tickets

describe("StaleTickets", () => {
  const OPEN = [opened("a")];

  it("a ticketless thread cannot go stale", () => {
    const history = [{ ev: "opened", thread: "a", title: "a", conversation_only: true }];
    throws(() => validate({ ev: "stale", thread: "a", what: "x" }, history), "no ticket");
  });

  it("stale needs what changed", () => {
    throws(() => validate({ ev: "stale", thread: "a" }, OPEN), "what");
  });

  it("a blocked thread can still go stale", () => {
    const history = [...OPEN, { ev: "blocked", thread: "a", on: "internal", what: "x" }];
    validate({ ev: "stale", thread: "a", what: "scope grew" }, history);
  });

  it("marking stale twice is rejected", () => {
    const history = [...OPEN, { ev: "stale", thread: "a", what: "x" }];
    throws(() => validate({ ev: "stale", thread: "a", what: "y" }, history), "already");
  });

  it("syncing an already current ticket is rejected", () => {
    throws(() => validate({ ev: "synced", thread: "a" }, OPEN), "not marked stale");
  });

  it("sync clears it and it can go stale again", () => {
    const history = [
      ...OPEN,
      { ev: "stale", thread: "a", what: "x" },
      { ev: "synced", thread: "a" },
    ];
    validate({ ev: "stale", thread: "a", what: "y" }, history);
    assert.equal(fold(history)[0].stale, null);
  });

  it("the marker and the button appear only when needed", () => {
    assert.doesNotMatch(renderBody(fold(OPEN), "t"), /tickets outdated/);
    const stale = [...OPEN, { ev: "stale", thread: "a", what: "scope grew" }];
    const body = renderBody(fold(stale), "t");
    assert.match(body, /tickets outdated/);
    assert.match(body, /class="info"/);
  });

  it("the marker carries what its prompt needs", () => {
    // The prompt is rendered, not assembled from data attributes: what
    // the button copies and what the reader can select must be one string.
    const stale = [...OPEN, { ev: "stale", thread: "a", what: "scope grew" }];
    const body = renderBody(fold(stale), "t");
    for (const fragment of ["o/r#1", "scope grew", "--ev synced --thread a"]) {
      assert.ok(body.includes(fragment), `missing ${fragment}`);
    }
  });

  it("the bulk prompt names every ticket", () => {
    // "Update the outdated tickets" would send the agent re-deriving
    // what the ledger already knows.
    const threads = [
      { thread: "a", ticket: "o/r#1", stale: "scope grew" },
      { thread: "b", ticket: "o/r#2", stale: "approach changed" },
    ];
    const prompt = stalePrompt(threads);
    for (const fragment of ["o/r#1", "scope grew", "o/r#2", "approach changed"]) {
      assert.ok(prompt.includes(fragment), `missing ${fragment}`);
    }
  });

  it("the single prompt closes its own loop", () => {
    const prompt = singlePrompt({ thread: "a", ticket: "o/r#1", stale: "scope grew" });
    assert.match(prompt, /--ev synced --thread a/);
  });

  it("staleness stays out of the markdown view", () => {
    // That view cannot copy a prompt, so a marker there would be a flag
    // nobody can act on.
    const stale = [...OPEN, { ev: "stale", thread: "a", what: "scope grew" }];
    assert.doesNotMatch(renderMarkdown(fold(stale), "t"), /outdated|scope grew/);
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

// -------------------------------------------------------- one implementation

describe("OneImplementation", () => {
  it("the page bundles the same modules the recorder uses", () => {
    // The whole reason this is JavaScript: the browser is one of the
    // three consumers of the fold, and a second copy of these semantics
    // is the one that would drift.
    const page = renderPage([opened("a")], "t", null, {}, null);
    const core = fs.readFileSync(path.join(SKILL, "core.mjs"), "utf8");
    const marker = core.match(/function fold\(events\) \{[\s\S]{0,80}/)[0];
    assert.ok(page.includes(marker.replace(/^export /, "")), "fold() is not in the page");
  });

  it("the core imports nothing, so it runs in a browser unchanged", () => {
    const core = fs.readFileSync(path.join(SKILL, "core.mjs"), "utf8");
    assert.doesNotMatch(core, /^import /m);
    assert.doesNotMatch(core, /require\(/);
  });

  it("the views import only the core", () => {
    const views = fs.readFileSync(path.join(SKILL, "views.mjs"), "utf8");
    const imports = views.match(/^import[\s\S]*?;$/gm) ?? [];
    assert.equal(imports.length, 1);
    assert.match(imports[0], /core\.mjs/);
  });
});

// ------------------------------------------------------------ the CLI

describe("ArgumentGrammar", () => {
  it("takes store-wide options before the command", () => {
    // How every caller writes it, including the store's render
    // workflow. Pinning the command to argv[0] made a flag's value
    // parse as a stray argument, and the whole suite stayed green
    // because nothing tested the command line.
    const [cmd, opts] = parseArgs([
      "--root", ".", "render", "--format", "md", "--out", "LEDGER.md",
    ]);
    assert.equal(cmd, "render");
    assert.equal(opts.root, ".");
    assert.equal(opts.format, "md");
    assert.equal(opts.out, "LEDGER.md");
  });

  it("takes them after the command too", () => {
    const [cmd, opts] = parseArgs(["render", "--root", ".", "--out", "x.html"]);
    assert.equal(cmd, "render");
    assert.equal(opts.root, ".");
  });

  it("accepts a value that looks like a path", () => {
    assert.equal(parseArgs(["state", "--root", "."])[1].root, ".");
  });

  it("refuses a second bare argument", () => {
    throws(() => parseArgs(["render", "state"]), "unexpected argument");
  });

  it("refuses an unknown option", () => {
    throws(() => parseArgs(["render", "--nope", "x"]), "unknown option");
  });

  it("refuses a flag with no value", () => {
    throws(() => parseArgs(["render", "--out"]), "needs a value");
  });

  it("collects the append flags a real call uses", () => {
    const [cmd, opts] = parseArgs([
      "append", "--ev", "progress", "--thread", "a", "--pct", "40",
      "--note", "moved", "--no-push",
    ]);
    assert.equal(cmd, "append");
    assert.equal(opts.ev, "progress");
    assert.equal(opts.pct, "40");
    assert.equal(opts["no-push"], true);
  });
});

describe("ReconcilingConcurrentAppends", () => {
  const line = (at, ev) => JSON.stringify({ at, ev, thread: "t" });

  it("keeps both sides", () => {
    // An append-only log has no losing side; an event dropped here is
    // an event nobody knows was written.
    const ours = [line("2026-01-02T00:00:00+00:00", "a")];
    const theirs = [line("2026-01-03T00:00:00+00:00", "b")];
    assert.deepEqual(mergeLogLines(ours, theirs).map((l) => JSON.parse(l).ev), ["a", "b"]);
  });

  it("orders by stamp, not by side", () => {
    const ours = [line("2026-01-04T00:00:00+00:00", "late")];
    const theirs = [line("2026-01-01T00:00:00+00:00", "early")];
    assert.deepEqual(
      mergeLogLines(ours, theirs).map((l) => JSON.parse(l).ev),
      ["early", "late"],
    );
  });

  it("collapses lines both sides already have", () => {
    // A retried push writes the same bytes twice.
    const shared = line("2026-01-01T00:00:00+00:00", "a");
    assert.deepEqual(mergeLogLines([shared], [shared]), [shared]);
  });

  it("preserves order for equal stamps", () => {
    // Second-precision stamps tie often, and line order within a file
    // is load-bearing.
    const at = "2026-01-01T00:00:00+00:00";
    const ours = [line(at, "first"), line(at, "second")];
    assert.deepEqual(
      mergeLogLines(ours, []).map((l) => JSON.parse(l).ev),
      ["first", "second"],
    );
  });

  it("drops blank lines rather than writing them back", () => {
    assert.deepEqual(mergeLogLines(["", line("2026-01-01T00:00:00+00:00", "a"), ""], []).length, 1);
  });

  it("keeps a line it cannot parse", () => {
    // Not ours to repair, and losing it would hide the corruption.
    const merged = mergeLogLines(["{broken", line("2026-01-01T00:00:00+00:00", "a")], []);
    assert.equal(merged.length, 2);
    assert.equal(merged[0], "{broken");
  });
});
