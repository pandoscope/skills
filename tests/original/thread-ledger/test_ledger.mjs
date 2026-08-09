// Tests for the thread ledger's pure core and its views.
//
// The state machine and the ordering are the parts that can be wrong in
// ways nothing else would notice, so they carry the tests. IO (git,
// transcript counting) is a thin shell over them.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  ATTRIBUTION_FOOTER,
  LedgerError,
  currentStates,
  fold,
  forgeOf,
  grillingInvokedAt,
  isUserTurn,
  knownPrs,
  lastAssistantText,
  lastUserTurnAt,
  refViolations,
  reviewSignals,
  stripCode,
  ticketWrites,
  transcriptUsage,
  mergeLogLines,
  orderClosed,
  orderOpen,
  sessionFromUrl,
  stamp,
  stretchesOf,
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
  append,
  checkSessionFile,
  mergedReport,
  countUserMessages,
  parseArgs,
  push,
  readAll,
  renderPage,
  resolveSession,
} from "../../../original/thread-ledger/ledger.mjs";
import {
  blocklistTerms,
  scanText,
  shellRef,
} from "../../../original/thread-ledger/scan.mjs";

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

  // The session chips filter on data the events already carry: every
  // anchor names its session, so the row only has to say which sessions
  // its events came from and the chips only have to hide the rest.
  it("rows carry the sessions whose events built them", () => {
    const body = renderBody(fold(withAnchors), "t");
    assert.match(body, /data-sessions="[^"]*s1[^"]*s2|data-sessions="[^"]*s2[^"]*s1/);
    assert.match(body, /data-sessions="s2"/);
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

// The recorder assumed one writer. A workflow that closes a thread when
// its ticket closes is a second one, and an event nobody can attribute
// is an event nobody can correct: a wrongly closed ticket and a genuine
// completion read exactly alike.
describe("Provenance", () => {
  it("an event with no writer is the session's own", () => {
    const event = { ev: "progress", thread: "a", pct: 10 };
    validate(event, [opened("a")]);
    assert.equal(event.by, undefined);
  });

  it("a known writer is legal", () => {
    validate({ ev: "completed", thread: "a", by: "bot" }, [opened("a")]);
  });

  it("an unknown writer is refused", () => {
    throws(
      () => validate({ ev: "completed", thread: "a", by: "ghost" }, [opened("a")]),
      "by must be one of",
    );
  });

  it("a writer files under its own name, never a conversation's", () => {
    // The workflow is not a conversation, so it does not go through
    // session resolution at all. Passing its name as a session id would
    // lose to the store's remembered URL — deliberately, because the
    // platform's session id matches no log and the URL is the better
    // guess for a session. A writer that is not one needs neither.
    //
    // Through the CLI, because the routing is in the command and an
    // event filed in the wrong log is exactly what nothing downstream
    // can see.
    const root = tempStore();
    resolveSession(root, "https://x.test/s/abc", null, null);
    writeLog(root, "session_abc", [{ ...opened("a"), at: "2026-01-01T00:00:00+00:00" }]);

    const run = spawnSync(
      process.execPath,
      [
        path.join(SKILL, "ledger.mjs"), "--root", root, "append",
        "--ev", "completed", "--thread", "a", "--by", "bot", "--no-push",
      ],
      { encoding: "utf8", env: { PATH: process.env.PATH, HOME: root } },
    );

    assert.equal(run.status, 0, run.stderr);
    const stamped = JSON.parse(run.stdout);
    assert.equal(stamped.anchor.session, "bot");
    assert.equal(stamped.anchor.url, undefined);
    assert.ok(fs.existsSync(path.join(root, "ledger", "bot.jsonl")));
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("a writer's log does not look like a conversation's", () => {
    // The reverse of the guard exemption: with only the workflow's log
    // present, a session's first append would be refused for splitting
    // a conversation's log that is not a conversation's at all.
    const root = tempStore();
    writeLog(root, "bot", [{ ev: "completed", thread: "a", by: "bot", at: "2026-01-01T00:00:00+00:00" }]);
    checkSessionFile(root, "session_abc");
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("a writer's event carries no message number", () => {
    // `msg` is a position in a conversation. A writer that is not one
    // has no position, and the recorder finds a transcript by taking
    // the most recently modified one under HOME — so left alone it
    // stamps the workflow's events with some passing session's count.
    const root = tempStore();
    const projects = path.join(root, ".claude", "projects", "p");
    fs.mkdirSync(projects, { recursive: true });
    fs.writeFileSync(
      path.join(projects, "someone-else.jsonl"),
      `${JSON.stringify({ type: "user", message: { role: "user", content: "hi" } })}\n`,
      "utf8",
    );
    writeLog(root, "session_abc", [{ ...opened("a"), at: "2026-01-01T00:00:00+00:00" }]);

    const run = spawnSync(
      process.execPath,
      [
        path.join(SKILL, "ledger.mjs"), "--root", root, "append",
        "--ev", "completed", "--thread", "a", "--by", "bot", "--no-push",
      ],
      { encoding: "utf8", env: { PATH: process.env.PATH, HOME: root } },
    );

    assert.equal(run.status, 0, run.stderr);
    assert.deepEqual(JSON.parse(run.stdout).anchor, { session: "bot" });
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("the writer survives stamping", () => {
    const stamped = stamp({ ev: "completed", thread: "a", by: "bot" }, "s", 1, null);
    assert.equal(stamped.by, "bot");
  });

  it("--by reaches the event", () => {
    const [, opts] = parseArgs(["append", "--ev", "completed", "--thread", "a", "--by", "bot"]);
    assert.equal(opts.by, "bot");
  });
});

// Conversations overlap in time: one starts, a second starts and ends,
// the first writes again. Ordering whole files puts every one of the
// first file's later events before every one of the second's, so an
// older event lands on top of a newer one — and because the recorder
// validates each append against this order, the state machine then
// guards a history that never happened.
describe("EventOrderAcrossFiles", () => {
  /** Two overlapping logs: the earlier file also holds the latest event. */
  function overlappingStore() {
    const root = tempStore();
    writeLog(root, "first", [
      { ...opened("a"), at: "2026-01-01T00:00:00+00:00" },
      { ev: "progress", thread: "a", note: "latest", pct: 90, at: "2026-06-01T00:00:00+00:00" },
    ]);
    writeLog(root, "second", [
      { ev: "progress", thread: "a", note: "middle", pct: 20, at: "2026-03-01T00:00:00+00:00" },
    ]);
    return root;
  }

  it("events interleave by stamp across files", () => {
    const root = overlappingStore();
    assert.deepEqual(readAll(root).map((e) => e.pct), [undefined, 20, 90]);
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("the newest event decides the folded state", () => {
    const root = overlappingStore();
    const [thread] = fold(readAll(root));
    assert.equal(thread.pct, 90);
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("same stamp keeps the writing file's line order", () => {
    // Line order inside a file is the tiebreak: a second of wall clock
    // holds several appends, and only the file knows which came first.
    const root = tempStore();
    writeLog(root, "first", [
      { ...opened("a"), at: "2026-01-01T00:00:00+00:00" },
      { ev: "progress", thread: "a", note: "earlier line", pct: 10, at: "2026-06-01T00:00:00+00:00" },
      { ev: "progress", thread: "a", note: "later line", pct: 30, at: "2026-06-01T00:00:00+00:00" },
    ]);
    assert.deepEqual(readAll(root).map((e) => e.pct), [undefined, 10, 30]);
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("an illegal transition split across files is rejected", () => {
    // The guarantee the ordering restores, pinned end to end: with the
    // fold misordered, a `completed` in an earlier-starting file was
    // buried under an older `progress` from a later-starting one, and
    // the recorder accepted `progress` after `completed` — measured
    // live before the fix. Validation must see the completion.
    const root = tempStore();
    writeLog(root, "first", [
      { ...opened("a"), at: "2026-01-01T00:00:00+00:00" },
      { ev: "completed", thread: "a", at: "2026-06-01T00:00:00+00:00" },
    ]);
    writeLog(root, "second", [
      { ev: "progress", thread: "a", pct: 20, at: "2026-03-01T00:00:00+00:00" },
    ]);
    throws(
      () => validate({ ev: "progress", thread: "a", pct: 30 }, readAll(root)),
      "illegal transition",
    );
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("an unstamped event sorts after every stamped one", () => {
    // Unstamped means pre-contract, which is older than anything the
    // recorder wrote — but it cannot be placed, so it goes last rather
    // than silently claiming a position it does not have.
    const root = tempStore();
    writeLog(root, "first", [{ ...opened("a") }]);
    writeLog(root, "second", [
      { ev: "progress", thread: "a", note: "stamped", pct: 40, at: "2026-03-01T00:00:00+00:00" },
    ]);
    assert.deepEqual(readAll(root).map((e) => e.ev), ["progress", "opened"]);
    fs.rmSync(root, { recursive: true, force: true });
  });
});

// A store holding several conversations is the documented shape — one
// log file per session, folded together. Rendering has to work there,
// and it is exercised through the shipped CLI rather than through the
// functions: the render that broke in production broke in `main`, which
// resolved a session identity that rendering never uses, and no test
// calling the functions directly could have seen it.
describe("MultiSessionRender", () => {
  /** Run the CLI with no HOME, the way CI has no transcript to fall back on. */
  function cli(root, ...args) {
    return spawnSync(process.execPath, [path.join(SKILL, "ledger.mjs"), "--root", root, ...args], {
      encoding: "utf8",
      env: { PATH: process.env.PATH, HOME: fs.mkdtempSync(path.join(os.tmpdir(), "nohome-")) },
    });
  }

  function twoSessionStore() {
    const root = tempStore();
    for (const name of ["session_one", "session_two"]) {
      writeLog(root, name, [{ ...opened(`${name}-a`), at: "2026-01-01T00:00:00+00:00" }]);
      fs.writeFileSync(
        path.join(root, "ledger", `${name}.url`),
        `https://x.test/code/${name}\n`,
        "utf8",
      );
    }
    return root;
  }

  it("renders markdown from a store with two conversations", () => {
    const root = twoSessionStore();
    const out = path.join(root, "LEDGER.md");
    const result = cli(root, "render", "--format", "md", "--out", out);
    assert.equal(result.status, 0, `render failed: ${result.stderr}`);
    const text = fs.readFileSync(out, "utf8");
    assert.match(text, /session_one-a/);
    assert.match(text, /session_two-a/);
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("renders the page from a store with two conversations", () => {
    const root = twoSessionStore();
    const out = path.join(root, "page.html");
    const result = cli(root, "render", "--out", out);
    assert.equal(result.status, 0, `render failed: ${result.stderr}`);
    fs.rmSync(root, { recursive: true, force: true });
  });

  // The writer reads the same variable the artifact-fresh check does
  // (skills#115): a path the model retypes each turn drifted once, and
  // the default removes the copy that can drift. Explicit --out wins.
  it("render defaults --out from LEDGER_RENDER_PATH", () => {
    const root = twoSessionStore();
    const out = path.join(root, "watched.html");
    const result = spawnSync(process.execPath, [path.join(SKILL, "ledger.mjs"), "--root", root, "render"], {
      encoding: "utf8",
      env: { PATH: process.env.PATH, HOME: fs.mkdtempSync(path.join(os.tmpdir(), "nohome-")), LEDGER_RENDER_PATH: out },
    });
    assert.equal(result.status, 0, `render failed: ${result.stderr}`);
    assert.ok(fs.existsSync(out), "the watched path was not written");
    assert.match(result.stdout, /watched\.html/);
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("explicit --out overrides LEDGER_RENDER_PATH", () => {
    const root = twoSessionStore();
    const explicit = path.join(root, "explicit.html");
    const result = spawnSync(process.execPath, [path.join(SKILL, "ledger.mjs"), "--root", root, "render", "--out", explicit], {
      encoding: "utf8",
      env: { PATH: process.env.PATH, HOME: fs.mkdtempSync(path.join(os.tmpdir(), "nohome-")), LEDGER_RENDER_PATH: path.join(root, "env.html") },
    });
    assert.equal(result.status, 0, `render failed: ${result.stderr}`);
    assert.ok(fs.existsSync(explicit));
    assert.ok(!fs.existsSync(path.join(root, "env.html")));
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("render with neither --out nor the variable names both", () => {
    const root = twoSessionStore();
    const result = cli(root, "render");
    assert.equal(result.status, 1);
    assert.match(result.stderr, /--out/);
    assert.match(result.stderr, /LEDGER_RENDER_PATH/);
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("reports folded state from a store with two conversations", () => {
    const root = twoSessionStore();
    const result = cli(root, "state");
    assert.equal(result.status, 0, `state failed: ${result.stderr}`);
    assert.equal(JSON.parse(result.stdout).length, 2);
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("appending still needs to know which conversation it is", () => {
    // The identity requirement is real for writes — it is only reads
    // that never needed it. Relaxing both would drop the guard that
    // keeps one conversation from acquiring two logs.
    const root = twoSessionStore();
    const result = cli(root, "append", "--ev", "progress", "--thread", "x", "--pct", "1");
    assert.equal(result.status, 1);
    assert.match(result.stderr, /refusing to append without an explicit identity/);
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

// ------------------------------------------------------- forge config

// The render path reads the same store config the response-hygiene
// check reads (skills#102): flat map = GitHub defaults, structured =
// the org's own base and patterns. Views take it as data.
describe("ForgeConfig", () => {
  const lab = {
    forge: "https://git.example.org",
    patterns: {
      ticket: "{base}/{repo}/-/issues/{n}",
      pr: "{base}/{repo}/-/merge_requests/{n}",
    },
    repos: { SK: "group/skills" },
  };
  const body = (events, forge) =>
    renderBody(fold(events), "t", null, {}, null, [], [], {}, forge);

  it("a structured config renders its own ticket pattern on the page", () => {
    const events = [opened("a", { ticket: "group/skills#5" })];
    assert.match(body(events, lab), /https:\/\/git\.example\.org\/group\/skills\/-\/issues\/5/);
    assert.doesNotMatch(body(events, lab), /github\.com/);
  });

  it("a structured config reaches notes and the markdown view", () => {
    const events = [
      opened("a", { ticket: "group/skills#5" }),
      { ev: "blocked", thread: "a", on: "internal", what: "see group/skills#9" },
    ];
    const md = renderMarkdown(fold(events), "t", null, {}, "", null, lab);
    assert.match(md, /git\.example\.org\/group\/skills\/-\/issues\/5/);
    assert.match(md, /git\.example\.org\/group\/skills\/-\/issues\/9/);
    assert.doesNotMatch(md, /github\.com/);
  });

  it("an absent config keeps the GitHub defaults byte-for-byte", () => {
    const events = [opened("a", { ticket: "o/r#1" })];
    assert.equal(body(events, {}), body(events, undefined));
    assert.match(body(events, {}), /https:\/\/github\.com\/o\/r\/issues\/1/);
  });

  it("linkify accepts the config too", () => {
    assert.match(
      linkify("see group/skills#3", lab),
      /git\.example\.org\/group\/skills\/-\/issues\/3/,
    );
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

// ------------------------------------------------------ diligence digest

/** A well-formed digest; tests below break one field at a time. */
function digest(extra = {}) {
  return {
    turns: 2,
    executions: { sealed: 1, blocked: 2, unsealed: 1, observed: 0 },
    checks: { "turn-summary": { fired: 2, cleared: 1, ignored: 1 } },
    tokens: { input: 10, output: 20, cacheRead: 30, cacheCreation: 40 },
    models: ["claude-test-1"],
    ...extra,
  };
}

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

// ------------------------------------------------------------ stretches

/** An event stamped into session `s` at minute `min`. */
function sessEvent(s, min, extra) {
  return {
    at: `2026-01-01T05:${String(min).padStart(2, "0")}:00+00:00`,
    anchor: { session: s, msg: 1, url: `https://x.test/code/${s}` },
    ...extra,
  };
}

/** A digest whose only interesting numbers are the ones passed in. */
function sealDigest(extra = {}) {
  return {
    turns: 1,
    executions: { sealed: 1, blocked: 0, unsealed: 0, observed: 0 },
    checks: {},
    tokens: { input: 10, output: 100, cacheRead: 1000, cacheCreation: 0 },
    models: ["claude-test-1"],
    ...extra,
  };
}

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

describe("DiligenceOnThePage", () => {
  it("the rendered page embeds the store's raw diligence records", () => {
    const root = tempStore();
    writeLog(root, "s1", [
      { ...opened("a"), at: "2026-01-01T00:00:00+00:00", anchor: { session: "s1", msg: 1 } },
      { ev: "sealed", at: "2026-01-01T00:01:00+00:00", anchor: { session: "s1", msg: 1 } },
    ]);
    fs.mkdirSync(path.join(root, "diligence"), { recursive: true });
    fs.writeFileSync(
      path.join(root, "diligence", "s1.jsonl"),
      `${JSON.stringify({ session: "s1", msg: 1, outcome: "sealed", marker: "diligence-embed-proof" })}\n`,
    );
    const out = path.join(root, "page.html");
    const result = spawnSync(
      process.execPath,
      [path.join(SKILL, "ledger.mjs"), "--root", root, "render", "--out", out],
      { encoding: "utf8", env: { PATH: process.env.PATH, HOME: fs.mkdtempSync(path.join(os.tmpdir(), "nohome-")) } },
    );
    assert.equal(result.status, 0, `render failed: ${result.stderr}`);
    assert.match(fs.readFileSync(out, "utf8"), /diligence-embed-proof/);
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("a session's name sidecar reaches the page", () => {
    const root = tempStore();
    writeLog(root, "s1", [
      { ...opened("a"), at: "2026-01-01T00:00:00+00:00", anchor: { session: "s1", msg: 1 } },
      { ev: "sealed", at: "2026-01-01T00:01:00+00:00", anchor: { session: "s1", msg: 1 } },
    ]);
    fs.writeFileSync(path.join(root, "ledger", "s1.name"), "the alpha build\n");
    const out = path.join(root, "page.html");
    const result = spawnSync(
      process.execPath,
      [path.join(SKILL, "ledger.mjs"), "--root", root, "render", "--out", out],
      { encoding: "utf8", env: { PATH: process.env.PATH, HOME: fs.mkdtempSync(path.join(os.tmpdir(), "nohome-")) } },
    );
    assert.equal(result.status, 0, `render failed: ${result.stderr}`);
    assert.match(fs.readFileSync(out, "utf8"), /the alpha build/);
    fs.rmSync(root, { recursive: true, force: true });
  });
});

describe("StretchesSection", () => {
  const twoSessions = [
    sessEvent("s1", 0, opened("a")),
    sessEvent("s1", 1, { ev: "sealed", diligence: sealDigest() }),
    sessEvent("s2", 2, opened("b")),
    sessEvent("s2", 3, { ev: "sealed", diligence: sealDigest() }),
  ];
  const body = (events, sessionUrl = "https://x.test/code/s2", names = {}) =>
    renderBody(fold(events), "T", null, {}, sessionUrl, events, [], names);

  it("the summary is the selected session's identity plus its totals", () => {
    const html = body(twoSessions);
    assert.match(html, /class="sesshead on" data-session="s2"/);
    const head = html.match(/<span class="sesshead on"[\s\S]*?<\/span><\/span>/)[0];
    assert.match(head, /s2/);
    assert.match(head, /1 turn/);
  });

  it("the picker lists every session and the overview, names beside ids", () => {
    const html = body(twoSessions, "https://x.test/code/s2", { s1: "alpha build" });
    assert.match(html, /class="opt"[^>]*data-session=""/);
    assert.match(html, /class="opt"[^>]*data-session="s1"[^>]*>[\s\S]*?alpha build/);
    assert.match(html, /class="opt"[^>]*data-session="s2"/);
  });

  it("the overview head carries the totals across every session", () => {
    const html = body(twoSessions);
    const head = html.match(/<span class="sesshead" data-session=""[\s\S]*?<\/span><\/span>/)[0];
    assert.match(head, /2 turns/);
  });

  it("there is no second selector — the head is the picker", () => {
    assert.doesNotMatch(body(twoSessions), /id="session-filter"/);
  });

  it("no seals, no section", () => {
    const html = body([sessEvent("s1", 0, opened("a"))]);
    assert.doesNotMatch(html, /class="picker"/);
  });

  it("a clean stretch renders quiet, a reminded one amber, a gave-up red", () => {
    const events = [
      sessEvent("s1", 0, opened("a")),
      sessEvent("s1", 1, { ev: "sealed", diligence: sealDigest() }),
      sessEvent("s1", 2, {
        ev: "sealed",
        diligence: sealDigest({
          executions: { sealed: 1, blocked: 2, unsealed: 0, observed: 0 },
          checks: { "ledger-event": { fired: 2, cleared: 2, ignored: 0 } },
        }),
      }),
      sessEvent("s1", 3, {
        ev: "sealed",
        diligence: sealDigest({
          executions: { sealed: 1, blocked: 1, unsealed: 1, observed: 0 },
          checks: { pushed: { fired: 2, cleared: 0, ignored: 1 } },
        }),
      }),
    ];
    const html = body(events, "https://x.test/code/s1");
    // Scoped to the session's own block: the overview block renders the
    // same stretches once more, deliberately.
    const block = html.match(/<div class="sess" data-session="s1">[\s\S]*?<\/ol><\/div>/)[0];
    const rows = block.match(/<li class="stretch[^"]*"/g);
    assert.deepEqual(rows, [
      '<li class="stretch"',
      '<li class="stretch st-remind"',
      '<li class="stretch st-gaveup"',
    ]);
    assert.match(block, /2 reminders/);
    assert.match(block, /gave up/);
  });

  it("a run of digest-less seals collapses to one legacy line", () => {
    const events = [
      sessEvent("s1", 0, opened("a")),
      sessEvent("s1", 1, { ev: "sealed" }),
      sessEvent("s1", 2, { ev: "sealed" }),
      sessEvent("s1", 3, { ev: "sealed" }),
      sessEvent("s1", 4, { ev: "sealed", diligence: sealDigest() }),
    ];
    const html = body(events, "https://x.test/code/s1");
    const block = html.match(/<div class="sess" data-session="s1">[\s\S]*?<\/ol><\/div>/)[0];
    assert.match(block, /3 stretches · no digest/);
    assert.equal(block.match(/<li class="stretch"/g).length, 1);
  });

  it("a reset digest renders as a gap, never as zero", () => {
    const events = [
      sessEvent("s1", 0, opened("a")),
      sessEvent("s1", 1, {
        ev: "sealed",
        diligence: sealDigest({ tokens: null, reset: true }),
      }),
    ];
    const html = body(events, "https://x.test/code/s1");
    assert.match(html, /class="gap"/);
    assert.doesNotMatch(html, /st-remind/);
  });

  it("an outlier stretch carries a hot multiplier against the session median", () => {
    const mk = (min, output) =>
      sessEvent("s1", min, {
        ev: "sealed",
        diligence: sealDigest({ tokens: { input: 0, output, cacheRead: 0, cacheCreation: 0 } }),
      });
    const events = [sessEvent("s1", 0, opened("a")), mk(1, 100), mk(2, 100), mk(3, 400)];
    const html = body(events, "https://x.test/code/s1");
    assert.match(html, /class="mult hot"[^>]*>×4\.0/);
  });

  it("a long session id renders as its tail, with the full id in the tooltip", () => {
    const name = "session_01KBsy9XFFuRepNnPNc6VqYb";
    const events = [
      sessEvent(name, 0, opened("a")),
      sessEvent(name, 1, { ev: "sealed", diligence: sealDigest() }),
    ];
    const html = body(events, `https://x.test/code/${name}`);
    assert.match(html, /class="sesshead on"[^>]*title="session_01KBsy9XFFuRepNnPNc6VqYb"/);
    assert.match(html, /…c6VqYb/);
  });

  it("only the last seal shows; the rest wait behind one expand", () => {
    const events = [sessEvent("s1", 0, opened("a"))];
    for (let index = 1; index <= 5; index += 1) {
      events.push(sessEvent("s1", index, { ev: "sealed", diligence: sealDigest() }));
    }
    const html = body(events, "https://x.test/code/s1");
    const block = html.match(/<div class="sess" data-session="s1">[\s\S]*?<\/ol><\/div>/)[0];
    assert.match(block, /<details class="allseals"><summary>all 5 stretches<\/summary>/);
    // Four folded inside the details, the newest one outside it.
    const [folded] = block.match(/<details class="allseals">[\s\S]*?<\/details>/);
    assert.equal((folded.match(/<li class="stretch"/g) ?? []).length, 4);
    assert.equal((block.match(/<li class="stretch"/g) ?? []).length, 5);
  });

  it("the tail after the last seal shows as unsealed, with its threads", () => {
    const events = [
      sessEvent("s1", 0, opened("a")),
      sessEvent("s1", 1, { ev: "sealed", diligence: sealDigest() }),
      sessEvent("s1", 2, { ev: "progress", thread: "a", pct: 30 }),
    ];
    const html = body(events, "https://x.test/code/s1");
    assert.match(html, /class="stretch tail"/);
    assert.match(html, /unsealed/);
  });
});

// -------------------------------------------------------- stdout drain

describe("PipedOutput", () => {
  /**
   * Run the CLI with stdout on a SHELL pipe — the mode a consumer uses.
   *
   * Through a shell, deliberately. `spawnSync` alone does not reproduce
   * this: its own read loop keeps the pipe drained, so the child's
   * writes complete before it exits and the payload arrives whole. A
   * test written the obvious way therefore passes against the broken
   * code — measured, and the reason this helper exists.
   */
  function cli(root, ...args) {
    const command = [
      JSON.stringify(process.execPath),
      JSON.stringify(path.join(SKILL, "ledger.mjs")),
      "--root",
      JSON.stringify(root),
      ...args,
    ].join(" ");
    // pipefail, so the pipeline reports the CLI's exit code rather than
    // `cat`'s — otherwise every failure would read as success here.
    return spawnSync("bash", ["-c", `set -o pipefail; ${command} | cat`], {
      encoding: "utf8",
      // Bigger than any output here, so a truncation this test sees is
      // the child's doing and never the parent's buffer.
      maxBuffer: 64 * 1024 * 1024,
      env: { PATH: process.env.PATH, HOME: fs.mkdtempSync(path.join(os.tmpdir(), "nohome-")) },
    });
  }

  /** A store whose folded state comfortably exceeds one pipe buffer. */
  function bigStore(threads = 60) {
    const root = tempStore();
    const note = "x".repeat(2000);
    const events = [];
    for (let index = 0; index < threads; index += 1) {
      events.push({
        ...opened(`t${index}`),
        at: `2026-01-01T00:00:${String(index % 60).padStart(2, "0")}+00:00`,
        anchor: { session: "s1", msg: 1 },
      });
      events.push({
        ev: "progress",
        thread: `t${index}`,
        pct: 50,
        note,
        at: `2026-01-02T00:00:${String(index % 60).padStart(2, "0")}+00:00`,
        anchor: { session: "s1", msg: 1 },
      });
    }
    writeLog(root, "s1", events);
    return root;
  }

  // `state` exists to be read by another program, and a pipe is how a
  // program reads it. Node's stdout writes are async on a pipe, so an
  // exit that does not drain them cuts the payload at one buffer — with
  // no error, and at a byte offset that reads like a corrupt store.
  it("state survives a pipe, whole", () => {
    const root = bigStore();
    const piped = cli(root, "state");
    assert.equal(piped.status, 0, `state failed: ${piped.stderr}`);
    assert.ok(
      piped.stdout.length > 64 * 1024,
      `the fixture must exceed one pipe buffer, got ${piped.stdout.length} bytes`,
    );
    const parsed = JSON.parse(piped.stdout);
    assert.equal(parsed.length, 60);
    fs.rmSync(root, { recursive: true, force: true });
  });

  // The same bytes either way: a file redirect is synchronous, so it
  // never lost anything and is the reference the pipe is measured to.
  it("piped output is byte-identical to a redirect", () => {
    const root = bigStore();
    const out = path.join(root, "state.json");
    const handle = fs.openSync(out, "w");
    const redirected = spawnSync(
      process.execPath,
      [path.join(SKILL, "ledger.mjs"), "--root", root, "state"],
      {
        stdio: ["ignore", handle, "pipe"],
        env: { PATH: process.env.PATH, HOME: fs.mkdtempSync(path.join(os.tmpdir(), "nohome-")) },
      },
    );
    fs.closeSync(handle);
    assert.equal(redirected.status, 0);
    assert.equal(cli(root, "state").stdout, fs.readFileSync(out, "utf8"));
    fs.rmSync(root, { recursive: true, force: true });
  });

  // The other half of the drain contract (#87): a consumer that stops
  // reading early — head, a pager quit half-way — closes the pipe, and
  // an unhandled EPIPE then stack-traces where every other CLI ends
  // quietly. The drain fix exposed this; before it, process.exit() died
  // ahead of the error one defect was masking with the other.
  it("a consumer that closes the pipe early ends the run quietly", () => {
    const root = bigStore();
    const command = [
      JSON.stringify(process.execPath),
      JSON.stringify(path.join(SKILL, "ledger.mjs")),
      "--root",
      JSON.stringify(root),
      "state",
    ].join(" ");
    const result = spawnSync("bash", ["-c", `${command} 2>stderr.txt | head -c 100 >/dev/null`], {
      cwd: root,
      encoding: "utf8",
      env: { PATH: process.env.PATH, HOME: fs.mkdtempSync(path.join(os.tmpdir(), "nohome-")) },
    });
    assert.equal(result.status, 0);
    assert.equal(
      fs.readFileSync(path.join(root, "stderr.txt"), "utf8"),
      "",
      "a closed pipe is how reading ends, not an error to report",
    );
    fs.rmSync(root, { recursive: true, force: true });
  });

  // Draining stdout must not cost the exit code — it is what a caller
  // branches on, and a failure that exits 0 is worse than a truncation.
  it("a failing command still exits non-zero, with its reason", () => {
    const root = bigStore(1);
    const result = cli(root, "nonsense");
    assert.equal(result.status, 1);
    assert.match(result.stderr, /unknown command/);
    fs.rmSync(root, { recursive: true, force: true });
  });
});

// ------------------------------------------------- concurrent writers

describe("PushRefusesWhatTheMergeInvalidates", () => {
  /** git in `dir`, throwing on failure. */
  function sh(dir, ...args) {
    const result = spawnSync("git", ["-C", dir, ...args], { encoding: "utf8" });
    assert.equal(result.status, 0, `git ${args.join(" ")} failed:\n${result.stderr}`);
    return result.stdout;
  }

  /**
   * A store with a bare origin, an opened thread pushed, and a second
   * writer's clone standing by — the shape skills#78 measured live.
   */
  function contendedStore() {
    const root = tempStore();
    sh(root, "init", "-q", "-b", "main");
    sh(root, "config", "user.email", "t@example.test");
    sh(root, "config", "user.name", "t");
    const origin = fs.mkdtempSync(path.join(os.tmpdir(), "ledger-origin-"));
    // `-b main`, or the bare HEAD points at master while everything
    // pushes main — and the bot's clone silently checks out nothing.
    spawnSync("git", ["init", "-q", "--bare", "-b", "main", origin], { encoding: "utf8" });
    sh(root, "remote", "add", "origin", origin);
    writeLog(root, "s1", [
      { ...opened("t"), at: "2026-01-01T00:00:00+00:00", anchor: { session: "s1", msg: 1 } },
    ]);
    fs.writeFileSync(path.join(root, "ledger", "s1.url"), "https://x.test/code/s1\n");
    sh(root, "add", "-A");
    sh(root, "commit", "-q", "-m", "seed");
    sh(root, "push", "-q", "-u", "origin", "main");

    const bot = fs.mkdtempSync(path.join(os.tmpdir(), "ledger-bot-"));
    const cloned = spawnSync("git", ["clone", "-q", origin, bot], { encoding: "utf8" });
    assert.equal(cloned.status, 0, `bot clone failed:\n${cloned.stderr}`);
    assert.ok(fs.existsSync(path.join(bot, "ledger")), "bot clone checked out the store");
    sh(bot, "config", "user.email", "bot@example.test");
    sh(bot, "config", "user.name", "bot");
    return { root, origin, bot };
  }

  /** The other writer publishes `event` while our clone stands stale. */
  function botPublishes(bot, event) {
    fs.appendFileSync(path.join(bot, "ledger", "bot.jsonl"), `${JSON.stringify(event)}\n`);
    sh(bot, "add", "ledger/bot.jsonl");
    sh(bot, "commit", "-q", "-m", "ledger(bot): concurrent write");
    sh(bot, "push", "-q", "origin", "main");
  }

  function cliAppend(root, ...args) {
    return spawnSync(
      process.execPath,
      [path.join(SKILL, "ledger.mjs"), "--root", root, "--session", "s1", "append", ...args],
      { encoding: "utf8", env: { PATH: process.env.PATH, HOME: fs.mkdtempSync(path.join(os.tmpdir(), "nohome-")) } },
    );
  }

  // The measured incident: a terminal event lands in another writer's
  // file, and 86 seconds later a stale clone appends a work event the
  // local fold genuinely allowed. The push is the only point where both
  // lines are visible, so the push is where the interleave must die.
  it("an append the merged fold forbids is refused, and withdrawn", () => {
    const { root, origin, bot } = contendedStore();
    botPublishes(bot, {
      ev: "completed",
      thread: "t",
      by: "bot",
      note: "closed by the loop",
      at: "2026-01-01T00:10:00+00:00",
      anchor: { session: "bot" },
    });
    const pushed = cliAppend(
      root, "--ev", "progress", "--thread", "t", "--pct", "60", "--note", "stale write",
    );
    assert.equal(pushed.status, 1, "the push must refuse the interleave");
    assert.match(pushed.stderr, /completed/);
    assert.match(pushed.stderr, /not recorded|withdrawn/i);
    // The clone is left clean at the remote state: no unpushed commit
    // carrying an event nobody validated, nothing stranded.
    const remoteTip = sh(root, "ls-remote", "origin", "main").split("\t")[0];
    assert.equal(sh(root, "rev-parse", "HEAD").trim(), remoteTip);
    // And the remote never saw the illegal line.
    const shipped = sh(root, "show", `${remoteTip}:ledger/s1.jsonl`);
    assert.doesNotMatch(shipped, /stale write/);
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(origin, { recursive: true, force: true });
    fs.rmSync(bot, { recursive: true, force: true });
  });

  // Withdrawal is surgical. The commit that carries a refused event
  // also carries whatever the heartbeat wrote since the last push —
  // seal lines, diligence records — and those are observed state that
  // must reach the store. Only the event is withdrawn; the rest ships.
  it("withdrawing the event does not take the seal down with it", () => {
    const { root, origin, bot } = contendedStore();
    botPublishes(bot, {
      ev: "completed",
      thread: "t",
      by: "bot",
      at: "2026-01-01T00:10:00+00:00",
      anchor: { session: "bot" },
    });
    // A seal the hook appended after the last push, still uncommitted —
    // the recorder's commit will sweep it up alongside the event.
    fs.appendFileSync(
      path.join(root, "ledger", "s1.jsonl"),
      `${JSON.stringify({ ev: "sealed", at: "2026-01-01T00:09:00+00:00", anchor: { session: "s1", msg: 1 } })}\n`,
    );
    const result = cliAppend(root, "--ev", "progress", "--thread", "t", "--pct", "60", "--note", "stale write");
    assert.equal(result.status, 1);
    const remoteTip = sh(root, "ls-remote", "origin", "main").split("\t")[0];
    const shipped = sh(root, "show", `${remoteTip}:ledger/s1.jsonl`);
    assert.match(shipped, /"ev":"sealed"/, "the seal must survive the withdrawal");
    assert.doesNotMatch(shipped, /stale write/);
    assert.equal(sh(root, "rev-parse", "HEAD").trim(), remoteTip);
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(origin, { recursive: true, force: true });
    fs.rmSync(bot, { recursive: true, force: true });
  });

  // Concurrency itself stays ordinary: another writer touching a
  // DIFFERENT thread must not turn into a refusal, or every busy hour
  // strands every session.
  it("a benign concurrent write still merges and pushes", () => {
    const { root, origin, bot } = contendedStore();
    botPublishes(bot, {
      ev: "opened",
      thread: "other",
      title: "another thread entirely",
      ticket: "o/r#9",
      by: "bot",
      at: "2026-01-01T00:10:00+00:00",
      anchor: { session: "bot" },
    });
    const result = cliAppend(root, "--ev", "progress", "--thread", "t", "--pct", "50");
    assert.equal(result.status, 0, `benign merge refused: ${result.stderr}`);
    const remoteTip = sh(root, "ls-remote", "origin", "main").split("\t")[0];
    const shipped = sh(root, "show", `${remoteTip}:ledger/s1.jsonl`);
    assert.match(shipped, /"pct":50/);
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(origin, { recursive: true, force: true });
    fs.rmSync(bot, { recursive: true, force: true });
  });
});

// -------------------------------------------------------- work location

describe("WorkLocation", () => {
  // skills#70: whether a branch merged is a pure git question, but only
  // if the log says which branch to ask about.
  it("branch and pr fold forward, latest wins", () => {
    const events = [
      { ...opened("t"), branch: "claude/1-first", at: "2026-01-01T00:00:00+00:00" },
      { ev: "progress", thread: "t", pct: 40, pr: "o/r#5", branch: "claude/1-redo", at: "2026-01-01T00:01:00+00:00" },
    ];
    const [thread] = fold(events);
    assert.equal(thread.branch, "claude/1-redo");
    assert.equal(thread.pr, "o/r#5");
  });

  it("a malformed pr is rejected at write time", () => {
    throws(() => validate({ ...opened("t"), pr: "not-a-ref" }, []), "owner\\/repo#123");
    throws(() => validate({ ...opened("t"), branch: "  " }, []), "non-empty");
    validate({ ...opened("t"), branch: "claude/1-x", pr: "o/r#9" }, []);
  });
});

// ------------------------------------------------------ merged reporter

describe("MergedWorkReporter", () => {
  function sh(dir, ...args) {
    const result = spawnSync("git", ["-C", dir, ...args], { encoding: "utf8" });
    assert.equal(result.status, 0, `git ${args.join(" ")} failed:\n${result.stderr}`);
    return result.stdout;
  }

  /**
   * A clones dir holding one clone of "o/r" with a merged and an
   * unmerged branch, plus the store recording threads on each.
   */
  function world() {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), "ledger-mr-"));
    const origin = path.join(base, "o", "r.git"); // tail = "o/r", matching the tickets
    fs.mkdirSync(path.dirname(origin), { recursive: true });
    spawnSync("git", ["init", "-q", "--bare", "-b", "main", origin], { encoding: "utf8" });
    const seed = path.join(base, "seed");
    spawnSync("git", ["clone", "-q", origin, seed], { encoding: "utf8" });
    sh(seed, "checkout", "-q", "-b", "main");
    sh(seed, "config", "user.email", "t@example.test");
    sh(seed, "config", "user.name", "t");
    fs.writeFileSync(path.join(seed, "README.md"), "seed\n");
    sh(seed, "add", "-A");
    sh(seed, "commit", "-q", "-m", "seed");
    sh(seed, "push", "-q", "-u", "origin", "main");
    // A branch merged into main, and one that is not.
    sh(seed, "checkout", "-q", "-b", "claude/1-done");
    fs.writeFileSync(path.join(seed, "done.txt"), "done\n");
    sh(seed, "add", "-A");
    sh(seed, "commit", "-q", "-m", "feat: done");
    sh(seed, "push", "-q", "-u", "origin", "claude/1-done");
    sh(seed, "checkout", "-q", "main");
    sh(seed, "merge", "-q", "--no-ff", "-m", "merge", "claude/1-done");
    sh(seed, "push", "-q", "origin", "main");
    sh(seed, "checkout", "-q", "-b", "claude/2-open");
    fs.writeFileSync(path.join(seed, "open.txt"), "open\n");
    sh(seed, "add", "-A");
    sh(seed, "commit", "-q", "-m", "feat: open");
    sh(seed, "push", "-q", "-u", "origin", "claude/2-open");

    const repos = path.join(base, "repos");
    fs.mkdirSync(repos);
    spawnSync("git", ["clone", "-q", "-b", "main", origin, path.join(repos, "r")], { encoding: "utf8" });

    const root = tempStore();
    writeLog(root, "s1", [
      { ...opened("done-thread", { ticket: "o/r#1" }), branch: "claude/1-done", at: "2026-01-01T00:00:00+00:00", anchor: { session: "s1", msg: 1 } },
      { ...opened("open-thread", { ev: "opened", ticket: "o/r#2" }), thread: "open-thread", branch: "claude/2-open", at: "2026-01-01T00:01:00+00:00", anchor: { session: "s1", msg: 1 } },
      { ...opened("no-branch", { ev: "opened", ticket: "o/r#3" }), thread: "no-branch", at: "2026-01-01T00:02:00+00:00", anchor: { session: "s1", msg: 1 } },
    ]);
    return { base, root, repos };
  }

  it("names the live thread whose branch merged, and only that one", () => {
    const { base, root, repos } = world();
    const text = mergedReport(root, repos);
    assert.match(text, /done-thread/);
    assert.match(text, /claude\/1-done/);
    assert.doesNotMatch(text, /open-thread/);
    assert.doesNotMatch(text, /no-branch/);
    fs.rmSync(base, { recursive: true, force: true });
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("a completed thread is not reported, and absence is silence", () => {
    const { base, root, repos } = world();
    fs.appendFileSync(
      path.join(root, "ledger", "s1.jsonl"),
      `${JSON.stringify({ ev: "completed", thread: "done-thread", at: "2026-01-01T01:00:00+00:00", anchor: { session: "s1", msg: 2 } })}\n`,
    );
    assert.equal(mergedReport(root, repos), "");
    // A missing clones dir reports nothing rather than failing: the
    // reporter must never become a gate.
    assert.equal(mergedReport(root, path.join(base, "nowhere")), "");
    fs.rmSync(base, { recursive: true, force: true });
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("a deleted branch ref is silence, not a claim", () => {
    const { base, root, repos } = world();
    const clone = path.join(repos, "r");
    sh(clone, "update-ref", "-d", "refs/remotes/origin/claude/1-done");
    assert.equal(mergedReport(root, repos), "");
    fs.rmSync(base, { recursive: true, force: true });
    fs.rmSync(root, { recursive: true, force: true });
  });
});

// ------------------------------------------------------------ reconcile

describe("Reconcile", () => {
  function ghStub(dir, script) {
    fs.mkdirSync(dir, { recursive: true });
    const stub = path.join(dir, "gh");
    fs.writeFileSync(stub, `#!/bin/sh\n${script}`);
    fs.chmodSync(stub, 0o755);
    return dir;
  }

  function cli(root, bindir, ...args) {
    return spawnSync(
      process.execPath,
      [path.join(SKILL, "ledger.mjs"), "--root", root, ...args],
      {
        encoding: "utf8",
        env: { PATH: bindir ? `${bindir}:${process.env.PATH}` : "/nonexistent-bin", HOME: fs.mkdtempSync(path.join(os.tmpdir(), "nohome-")) },
      },
    );
  }

  function storeWith(events) {
    const root = tempStore();
    writeLog(root, "s1", events);
    return root;
  }

  it("a live thread with a closed ticket is a divergence", () => {
    const root = storeWith([
      { ...opened("t", { ticket: "o/r#7" }), at: "2026-01-01T00:00:00+00:00", anchor: { session: "s1", msg: 1 } },
    ]);
    const bin = ghStub(fs.mkdtempSync(path.join(os.tmpdir(), "ghstub-")),
      'case "$*" in *--version*) exit 0 ;; *"issue view"*) echo \'{"state":"CLOSED"}\' ;; esac');
    const result = cli(root, bin, "reconcile");
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /! t is opened, but its ticket o\/r#7 is closed/);
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("a completed thread whose PR never merged is the other direction", () => {
    const root = storeWith([
      { ...opened("t", { ticket: "o/r#7" }), pr: "o/r#8", at: "2026-01-01T00:00:00+00:00", anchor: { session: "s1", msg: 1 } },
      { ev: "completed", thread: "t", at: "2026-01-01T00:10:00+00:00", anchor: { session: "s1", msg: 2 } },
    ]);
    const bin = ghStub(fs.mkdtempSync(path.join(os.tmpdir(), "ghstub-")),
      'case "$*" in *--version*) exit 0 ;; *"pr view"*) echo \'{"state":"OPEN"}\' ;; esac');
    const result = cli(root, bin, "reconcile");
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /! t is completed, but its PR o\/r#8 is open/);
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("without gh it refuses and says why — it never guesses", () => {
    const root = storeWith([
      { ...opened("t", { ticket: "o/r#7" }), at: "2026-01-01T00:00:00+00:00", anchor: { session: "s1", msg: 1 } },
    ]);
    const result = cli(root, null, "reconcile");
    assert.equal(result.status, 1);
    assert.match(result.stderr, /gh CLI/);
    fs.rmSync(root, { recursive: true, force: true });
  });
});

// ----------------------------------------------------- write identity

describe("AppendProvesItsIdentity", () => {
  /** A store already holding another conversation's log and its URL. */
  function adoptableStore() {
    const root = tempStore();
    writeLog(root, "session_other", [
      { ...opened("t"), at: "2026-01-01T00:00:00+00:00", anchor: { session: "session_other", msg: 1 } },
    ]);
    fs.writeFileSync(
      path.join(root, "ledger", "session_other.url"),
      "https://x.test/code/session_other\n",
    );
    return root;
  }

  function cli(root, env, ...args) {
    return spawnSync(
      process.execPath,
      [path.join(SKILL, "ledger.mjs"), "--root", root, ...args],
      {
        encoding: "utf8",
        env: { PATH: process.env.PATH, HOME: fs.mkdtempSync(path.join(os.tmpdir(), "nohome-")), ...env },
      },
    );
  }

  const files = (root) => fs.readdirSync(path.join(root, "ledger")).sort();

  // The measured incidents (skills#51): with no explicit identity the
  // append adopted the store's recorded URL once and the transcript
  // filename once — and pushed both before the warning could be read.
  it("an append with no identity refuses instead of adopting the recorded URL", () => {
    const root = adoptableStore();
    const before = files(root);
    const result = cli(root, {}, "append", "--ev", "progress", "--thread", "t", "--pct", "10", "--no-push");
    assert.notEqual(result.status, 0, "the append must refuse");
    assert.match(result.stderr, /--session-url/);
    assert.match(result.stderr, /LEDGER_SESSION_URL/);
    assert.match(result.stderr, /nothing was written/i);
    assert.deepEqual(files(root), before, "no file may be created or grown");
    assert.equal(
      fs.readFileSync(path.join(root, "ledger", "session_other.jsonl"), "utf8").split("\n").filter(Boolean).length,
      1,
      "the other conversation's log is untouched",
    );
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("a transcript is not an identity for a write", () => {
    const root = adoptableStore();
    const transcript = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "ledger-tr-")), "abc123.jsonl");
    fs.writeFileSync(transcript, `${JSON.stringify({ type: "user", timestamp: "2026-01-01T00:00:00Z" })}\n`);
    const result = cli(
      root, {}, "append", "--ev", "progress", "--thread", "t", "--pct", "10",
      "--transcript", transcript, "--no-push",
    );
    assert.notEqual(result.status, 0, "the transcript stem must not name a write");
    assert.ok(!files(root).includes("abc123.jsonl"), "no log under the transcript stem");
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("a render with no identity still succeeds — the fallback belongs to reads", () => {
    const root = adoptableStore();
    const out = path.join(root, "page.html");
    const result = cli(root, {}, "render", "--out", out);
    assert.equal(result.status, 0, `render refused: ${result.stderr}`);
    assert.ok(fs.existsSync(out));
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("LEDGER_SESSION_URL names the write like --session-url does", () => {
    // A fresh store, so the one-log-per-conversation guard (its own
    // describe) stays out of what this test measures.
    const root = tempStore();
    const result = cli(
      root, { LEDGER_SESSION_URL: "https://x.test/code/session_mine" },
      "append", "--ev", "opened", "--thread", "u", "--title", "U", "--conversation-only", "--no-push",
    );
    assert.equal(result.status, 0, `append refused: ${result.stderr}`);
    assert.match(
      fs.readFileSync(path.join(root, "ledger", "session_mine.jsonl"), "utf8"),
      /"session":"session_mine"/,
    );
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("--session is explicit enough for a store naming its logs outright", () => {
    const root = adoptableStore();
    const result = cli(
      root, {}, "--session", "session_other",
      "append", "--ev", "progress", "--thread", "t", "--pct", "30", "--no-push",
    );
    assert.equal(result.status, 0, `append refused: ${result.stderr}`);
    assert.match(
      fs.readFileSync(path.join(root, "ledger", "session_other.jsonl"), "utf8"),
      /"pct":30/,
    );
    fs.rmSync(root, { recursive: true, force: true });
  });
});

// -------------------------------------------------------- branch guard

describe("AppendRefusesOffTheDefaultBranch", () => {
  function sh(dir, ...args) {
    const result = spawnSync("git", ["-C", dir, ...args], { encoding: "utf8" });
    assert.equal(result.status, 0, `git ${args.join(" ")} failed:\n${result.stderr}`);
    return result.stdout;
  }

  /** A store clone with a bare origin, seeded and pushed on main. */
  function clonedStore() {
    const root = tempStore();
    sh(root, "init", "-q", "-b", "main");
    sh(root, "config", "user.email", "t@example.test");
    sh(root, "config", "user.name", "t");
    const origin = fs.mkdtempSync(path.join(os.tmpdir(), "ledger-origin-"));
    spawnSync("git", ["init", "-q", "--bare", "-b", "main", origin], { encoding: "utf8" });
    sh(root, "remote", "add", "origin", origin);
    writeLog(root, "s1", [
      { ...opened("t"), at: "2026-01-01T00:00:00+00:00", anchor: { session: "s1", msg: 1 } },
    ]);
    fs.writeFileSync(path.join(root, "ledger", "s1.url"), "https://x.test/code/s1\n");
    sh(root, "add", "-A");
    sh(root, "commit", "-q", "-m", "seed");
    sh(root, "push", "-q", "-u", "origin", "main");
    return { root, origin };
  }

  function cliAppend(root, ...args) {
    return spawnSync(
      process.execPath,
      [path.join(SKILL, "ledger.mjs"), "--root", root, "--session", "s1", "append", ...args],
      { encoding: "utf8", env: { PATH: process.env.PATH, HOME: fs.mkdtempSync(path.join(os.tmpdir(), "nohome-")) } },
    );
  }

  // The measured incident (skills#76): the clone sat on a feature
  // branch carrying an unmerged commit, a routine append ran, and
  // `HEAD:main` published the commit — an unreviewed automation went
  // live on the store's default branch.
  it("a store clone on a feature branch refuses the append before writing", () => {
    const { root, origin } = clonedStore();
    sh(root, "checkout", "-q", "-b", "feature/unreviewed");
    fs.writeFileSync(path.join(root, "workflow.yml"), "on: schedule\n");
    sh(root, "add", "-A");
    sh(root, "commit", "-q", "-m", "feat: an automation awaiting review");
    const before = fs.readFileSync(path.join(root, "ledger", "s1.jsonl"), "utf8");

    const result = cliAppend(root, "--ev", "progress", "--thread", "t", "--pct", "10");
    assert.notEqual(result.status, 0, "the append must refuse");
    assert.match(result.stderr, /feature\/unreviewed/);
    assert.match(result.stderr, /default branch/i);
    // The refusal happens before the write: nothing half-recorded.
    assert.equal(fs.readFileSync(path.join(root, "ledger", "s1.jsonl"), "utf8"), before);
    // And the feature commit never reached main.
    const remoteTip = sh(root, "ls-remote", "origin", "main").split("\t")[0];
    assert.throws(() => sh(root, "show", `${remoteTip}:workflow.yml`));
    // The message names no store location.
    assert.ok(!result.stderr.includes(origin), "the refusal must not leak the store URL");
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(origin, { recursive: true, force: true });
  });

  it("a detached HEAD refuses too, named as such", () => {
    const { root, origin } = clonedStore();
    sh(root, "checkout", "-q", "--detach", "HEAD");
    throws(
      () => append(root, "s1", { ev: "progress", thread: "t", pct: 10 }, null, "https://x.test/code/s1"),
      "detached HEAD",
    );
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(origin, { recursive: true, force: true });
  });

  it("the ordinary append on main still lands", () => {
    const { root, origin } = clonedStore();
    const result = cliAppend(root, "--ev", "progress", "--thread", "t", "--pct", "20");
    assert.equal(result.status, 0, `append on main refused: ${result.stderr}`);
    const remoteTip = sh(root, "ls-remote", "origin", "main").split("\t")[0];
    assert.match(sh(root, "show", `${remoteTip}:ledger/s1.jsonl`), /"pct":20/);
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(origin, { recursive: true, force: true });
  });

  // The kata fixtures' shape: a store that is a plain directory inside
  // some other repository. `git -C` resolves the ENCLOSING repo there,
  // and a guard that judged its branch would refuse every append made
  // from a feature-branch checkout of the repo that happens to hold the
  // store. Only a store that is its own repository has a push to guard.
  it("a store that is not its own repository is not judged", () => {
    const enclosing = fs.mkdtempSync(path.join(os.tmpdir(), "ledger-encl-"));
    sh(enclosing, "init", "-q", "-b", "main");
    sh(enclosing, "checkout", "-q", "-b", "feature/elsewhere");
    const root = path.join(enclosing, "store");
    fs.mkdirSync(path.join(root, "ledger"), { recursive: true });
    fs.writeFileSync(path.join(root, "ledger", "s1.url"), "https://x.test/code/s1\n");
    const stamped = append(
      root, "s1", { ev: "opened", thread: "t", title: "T", conversation_only: true },
      null, "https://x.test/code/s1",
    );
    assert.equal(stamped.ev, "opened");
    fs.rmSync(enclosing, { recursive: true, force: true });
  });
});

// ---------------------------------------------------------- store guard

describe("LedgerGuard", () => {
  function sh(dir, ...args) {
    const result = spawnSync("git", ["-C", dir, ...args], { encoding: "utf8" });
    assert.equal(result.status, 0, `git ${args.join(" ")} failed:\n${result.stderr}`);
    return result.stdout;
  }

  function commitAll(root, message) {
    sh(root, "add", "-A");
    sh(root, "-c", "user.email=t@example.test", "-c", "user.name=t", "commit", "-q", "-m", message);
    return sh(root, "rev-parse", "HEAD").trim();
  }

  /** A store repo with one seeded commit: opened + progress on `t`. */
  function guardStore() {
    const root = tempStore();
    sh(root, "init", "-q", "-b", "main");
    writeLog(root, "s1", [
      { ...opened("t"), at: "2026-01-01T00:00:00+00:00", anchor: { session: "s1", msg: 1 } },
      { ev: "progress", thread: "t", pct: 40, at: "2026-01-01T00:01:00+00:00", anchor: { session: "s1", msg: 1 } },
    ]);
    const seed = commitAll(root, "seed");
    return { root, seed };
  }

  function guard(root, range) {
    return spawnSync(
      process.execPath,
      [path.join(SKILL, "ledger.mjs"), "--root", root, "guard", "--range", range],
      { encoding: "utf8", env: { PATH: process.env.PATH, HOME: fs.mkdtempSync(path.join(os.tmpdir(), "nohome-")) } },
    );
  }

  const logPath = (root) => path.join(root, "ledger", "s1.jsonl");

  // The #79 incident: two routine git commands removed a published line
  // and nothing anywhere objected. The guard is the thing that objects.
  it("a push that removes a ledger line is rejected, naming it", () => {
    const { root, seed } = guardStore();
    const lines = fs.readFileSync(logPath(root), "utf8").split("\n").filter((l) => l.trim());
    fs.writeFileSync(logPath(root), `${lines[0]}\n`, "utf8");
    const bad = commitAll(root, "conflict resolution gone wrong");
    const result = guard(root, `${seed}..${bad}`);
    assert.equal(result.status, 1);
    assert.match(result.stdout, /removed/i);
    assert.match(result.stdout, /ledger\/s1\.jsonl/);
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("a removed diligence record is rejected too — raw records are retained data", () => {
    const { root, seed } = guardStore();
    fs.mkdirSync(path.join(root, "diligence"), { recursive: true });
    fs.writeFileSync(path.join(root, "diligence", "s1.jsonl"), `${JSON.stringify({ cycle: 1 })}\n`);
    const withRecords = commitAll(root, "flush");
    fs.writeFileSync(path.join(root, "diligence", "s1.jsonl"), "", "utf8");
    const bad = commitAll(root, "oops");
    const result = guard(root, `${withRecords}..${bad}`);
    assert.equal(result.status, 1);
    assert.match(result.stdout, /diligence\/s1\.jsonl/);
    fs.rmSync(root, { recursive: true, force: true });
  });

  // The #78 shape, after the fact: the union of two writers' files holds
  // a transition nobody validated. CI folds what actually landed.
  it("an added event that is illegal from its history is rejected", () => {
    const { root, seed } = guardStore();
    fs.appendFileSync(
      logPath(root),
      `${JSON.stringify({ ev: "completed", thread: "t", at: "2026-01-01T00:02:00+00:00", anchor: { session: "s1", msg: 2 } })}\n`,
    );
    const closed = commitAll(root, "close");
    fs.appendFileSync(
      logPath(root),
      `${JSON.stringify({ ev: "progress", thread: "t", pct: 60, at: "2026-01-01T00:03:00+00:00", anchor: { session: "s1", msg: 3 } })}\n`,
    );
    const bad = commitAll(root, "stale interleave");
    const result = guard(root, `${closed}..${bad}`);
    assert.equal(result.status, 1);
    assert.match(result.stdout, /completed/);
    assert.match(result.stdout, /progress/);
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("an ordinary append passes, and says what it checked", () => {
    const { root, seed } = guardStore();
    fs.appendFileSync(
      logPath(root),
      `${JSON.stringify({ ev: "blocked", thread: "t", on: "internal", what: "waiting", at: "2026-01-01T00:02:00+00:00", anchor: { session: "s1", msg: 2 } })}\n`,
    );
    const good = commitAll(root, "append");
    const result = guard(root, `${seed}..${good}`);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /1 added/);
    fs.rmSync(root, { recursive: true, force: true });
  });

  // The corpus already holds one illegal interleave from before the
  // guard existed. History is not this push's fault: only lines ADDED
  // in the range are judged, so the guard can turn on without a
  // history rewrite — which the deletion rule itself forbids.
  it("an old illegal transition does not fail a clean push", () => {
    const { root } = guardStore();
    fs.appendFileSync(
      logPath(root),
      `${JSON.stringify({ ev: "completed", thread: "t", at: "2026-01-01T00:02:00+00:00", anchor: { session: "s1", msg: 2 } })}\n` +
        `${JSON.stringify({ ev: "progress", thread: "t", pct: 70, at: "2026-01-01T00:03:00+00:00", anchor: { session: "s1", msg: 3 } })}\n`,
    );
    const historic = commitAll(root, "the pre-guard corpus, interleave and all");
    fs.appendFileSync(
      logPath(root),
      `${JSON.stringify({ ev: "progress", thread: "t", pct: 80, at: "2026-01-01T00:04:00+00:00", anchor: { session: "s1", msg: 4 } })}\n`,
    );
    const clean = commitAll(root, "a legal append on top");
    const result = guard(root, `${historic}..${clean}`);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    fs.rmSync(root, { recursive: true, force: true });
  });
});

// ----------------------------------------------------------- publishing

describe("PushCarriesTheStretch", () => {
  it("the session's diligence file rides the same push as its log", () => {
    // The hook writes diligence/<session>.jsonl but never pushes; the
    // recorder's push is the only ride to the remote, and a push that
    // left the file behind would strand the raw records the seal's
    // digest claims are retained.
    const root = tempStore();
    const sh = (...args) => spawnSync("git", ["-C", root, ...args], { encoding: "utf8" });
    sh("init", "-q", "-b", "main");
    sh("config", "user.email", "t@example.test");
    sh("config", "user.name", "t");
    const origin = fs.mkdtempSync(path.join(os.tmpdir(), "ledger-origin-"));
    spawnSync("git", ["init", "-q", "--bare", origin], { encoding: "utf8" });
    sh("remote", "add", "origin", origin);
    fs.writeFileSync(path.join(root, "ledger", "s.jsonl"), `${JSON.stringify({ ev: "sealed" })}\n`);
    fs.writeFileSync(path.join(root, "ledger", "s.name"), "the alpha build\n");
    fs.mkdirSync(path.join(root, "diligence"), { recursive: true });
    fs.writeFileSync(path.join(root, "diligence", "s.jsonl"), `${JSON.stringify({ cycle: 1 })}\n`);

    push(root, "s", "sealed");

    const shipped = spawnSync(
      "git",
      ["-C", origin, "ls-tree", "-r", "--name-only", "main"],
      { encoding: "utf8" },
    ).stdout;
    assert.match(shipped, /diligence\/s\.jsonl/);
    assert.match(shipped, /ledger\/s\.name/);
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(origin, { recursive: true, force: true });
  });
});

describe("ResponseHygiene", () => {
  const MAP = { skills: "pandoscope/skills", AET: "pandoscope/agentic-engineering-template" };

  it("a linked shortcode ref with the right URL is clean", () => {
    const prose = "Merged [skills#97](https://github.com/pandoscope/skills/issues/97) today.";
    assert.deepEqual(refViolations(prose, MAP), []);
  });

  it("an unlinked shortcode ref names its canonical form", () => {
    const [v] = refViolations("see skills#97 for details", MAP);
    assert.equal(v.token, "skills#97");
    assert.equal(v.canonical, "[skills#97](https://github.com/pandoscope/skills/issues/97)");
  });

  it("a full owner/repo ref in prose asks for the shortcode", () => {
    const [v] = refViolations("pandoscope/skills#97 landed", MAP);
    assert.equal(v.canonical, "[skills#97](https://github.com/pandoscope/skills/issues/97)");
  });

  it("a number the ledger knows as a PR corrects the sigil to !", () => {
    const prs = new Set(["pandoscope/skills#97"]);
    const [v] = refViolations(
      "see [skills#97](https://github.com/pandoscope/skills/issues/97)",
      MAP,
      prs,
    );
    assert.equal(v.canonical, "[skills!97](https://github.com/pandoscope/skills/pull/97)");
  });

  it("a PR sigil links to /pull/ or is named", () => {
    const clean = "see [skills!98](https://github.com/pandoscope/skills/pull/98)";
    assert.deepEqual(refViolations(clean, MAP), []);
    const [v] = refViolations("see [skills!98](https://github.com/pandoscope/skills/issues/98)", MAP);
    assert.equal(v.canonical, "[skills!98](https://github.com/pandoscope/skills/pull/98)");
  });

  it("an unknown shortcode is a violation with no canonical form", () => {
    const [v] = refViolations("see xyz#4", { ...MAP }, new Set());
    assert.equal(v, undefined);
    const [linked] = refViolations("see [xyz#4](https://github.com/x/y/issues/4)", MAP);
    assert.equal(linked.canonical, null);
  });

  it("a bare repo-less number is a violation", () => {
    const [v] = refViolations("fixed in #137", MAP);
    assert.equal(v.token, "#137");
    assert.equal(v.canonical, null);
  });

  it("code spans are quoted material, not prose", () => {
    const text = "run `git log pandoscope/skills#97` and\n```\nskills#97 in a fence\n```\ndone";
    assert.deepEqual(refViolations(stripCode(text), MAP), []);
  });

  it("the last assistant text supersedes earlier messages", () => {
    const lines = [
      { type: "assistant", message: { content: [{ type: "text", text: "bad skills#97" }] } },
      { type: "assistant", message: { content: [{ type: "tool_use", id: "x" }] } },
      {
        type: "assistant",
        message: {
          content: [
            { type: "text", text: "good [skills#97](https://github.com/pandoscope/skills/issues/97)" },
          ],
        },
      },
    ]
      .map((r) => JSON.stringify(r))
      .join("\n");
    assert.match(lastAssistantText(lines), /^good/);
  });

  it("knownPrs reads pr fields off events", () => {
    const events = [{ ev: "opened", thread: "t", pr: "pandoscope/skills#98" }, { ev: "progress", thread: "t" }];
    assert.deepEqual([...knownPrs(events)], ["pandoscope/skills#98"]);
  });
});

describe("ForgeIndependence", () => {
  const MAP = { skills: "pandoscope/skills" };

  it("a structured config carries the forge, so nothing here names one", () => {
    const cfg = {
      forge: "https://git.example.org",
      patterns: {
        ticket: "{base}/{repo}/-/issues/{n}",
        pr: "{base}/{repo}/-/merge_requests/{n}",
      },
      repos: MAP,
    };
    const [v] = refViolations("see skills#97", cfg);
    assert.equal(v.canonical, "[skills#97](https://git.example.org/pandoscope/skills/-/issues/97)");
    const clean = "see [skills!98](https://git.example.org/pandoscope/skills/-/merge_requests/98)";
    assert.deepEqual(refViolations(clean, cfg), []);
    const [wrong] = refViolations(
      "see [skills#97](https://github.com/pandoscope/skills/issues/97)",
      cfg,
    );
    assert.equal(wrong.canonical, "[skills#97](https://git.example.org/pandoscope/skills/-/issues/97)");
  });

  it("a flat map keeps the GitHub defaults", () => {
    assert.deepEqual(
      refViolations("see [skills#97](https://github.com/pandoscope/skills/issues/97)", MAP),
      [],
    );
  });
});

// ------------------------------------------------- outgoing-content scan

// Check 7's shared scanner (skills#46): built-in terms are the store
// URL values, user terms come |-separated from PUSH_BLOCKLIST, and
// nothing here ever returns a value — labels only.
describe("OutgoingScan", () => {
  it("builds terms from the store variables and PUSH_BLOCKLIST", () => {
    const env = {
      SESSION_MEMORY_URL: "https://x@example.test/sm.git",
      PUSH_BLOCKLIST: "hunter2|the-codename",
    };
    assert.deepEqual(
      blocklistTerms(env).map((term) => term.label),
      ["SESSION_MEMORY_URL", "PUSH_BLOCKLIST term 1", "PUSH_BLOCKLIST term 2"],
    );
  });

  it("an unset blocklist means built-in scan only, and empty terms drop", () => {
    assert.deepEqual(blocklistTerms({}), []);
    assert.deepEqual(
      blocklistTerms({ PUSH_BLOCKLIST: "|a||" }).map((term) => term.label),
      ["PUSH_BLOCKLIST term 2"],
    );
  });

  it("reports labels, never values", () => {
    const terms = blocklistTerms({ PUSH_BLOCKLIST: "hunter2" });
    const hits = scanText("the diff says hunter2 somewhere", terms);
    assert.deepEqual(hits, ["PUSH_BLOCKLIST term 1"]);
    assert.ok(!JSON.stringify(hits).includes("hunter2"));
    assert.deepEqual(scanText("a clean diff", terms), []);
  });

  it("shell references expand without printing", () => {
    assert.equal(shellRef("SESSION_MEMORY_URL"), '"$SESSION_MEMORY_URL"');
    assert.equal(
      shellRef("PUSH_BLOCKLIST term 2"),
      "\"$(printf %s \"$PUSH_BLOCKLIST\" | cut -d'|' -f2)\"",
    );
  });
});

describe("ReviewSignals", () => {
  const fetchPayload = (payload, at = "2026-08-03T15:12:00.000Z") =>
    [
      {
        type: "assistant",
        timestamp: at,
        message: {
          role: "assistant",
          content: [
            {
              type: "tool_use",
              id: "toolu_1",
              name: "mcp__github__pull_request_read",
              input: { method: "get_review_comments" },
            },
          ],
        },
      },
      {
        type: "user",
        timestamp: at,
        message: {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: "toolu_1",
              content: [{ type: "text", text: JSON.stringify(payload) }],
            },
          ],
        },
      },
    ]
      .map((line) => JSON.stringify(line))
      .join("\n");

  const fetchLines = (body, at = "2026-08-03T15:12:00.000Z") =>
    fetchPayload({ comments: [{ body }] }, at);

  const authored = (body, login) => fetchPayload({ comments: [{ body, user: { login } }] });

  it("a fetched body without the footer is a human comment", () => {
    const signals = reviewSignals(fetchLines("Rename the flag — double negative."));
    assert.deepEqual(signals, { fetched: true, human: true, anomalies: [] });
  });

  it("a body carrying the footer is Claude's own post coming back", () => {
    const signals = reviewSignals(fetchLines(`Applied.\n\n---\n${ATTRIBUTION_FOOTER}`));
    assert.deepEqual(signals, { fetched: true, human: false, anomalies: [] });
  });

  it("no comment fetch means no signal at all", () => {
    const plain = JSON.stringify({
      type: "user",
      timestamp: "2026-08-03T15:10:00.000Z",
      message: { role: "user", content: "Finish the slice." },
    });
    assert.deepEqual(reviewSignals(plain), { fetched: false, human: false, anomalies: [] });
  });

  it("activity before the boundary is another turn's business", () => {
    const early = fetchLines("Rename it.", "2026-08-03T14:00:00.000Z");
    assert.deepEqual(reviewSignals(early, "2026-08-03T15:10:00.000Z"), {
      fetched: false,
      human: false,
      anomalies: [],
    });
  });

  it("webhook activity blocks carry bodies too", () => {
    const hook = JSON.stringify({
      type: "user",
      timestamp: "2026-08-03T15:12:00.000Z",
      message: {
        role: "user",
        content:
          '<github-webhook-activity>{"comment":{"body":"Why does this loop twice?"}}</github-webhook-activity>',
      },
    });
    assert.deepEqual(reviewSignals(hook), { fetched: true, human: true, anomalies: [] });
  });

  it("a result for a tool this check never asked about is ignored", () => {
    const other = fetchLines("Rename it.").replace("pull_request_read", "list_pull_requests");
    assert.deepEqual(reviewSignals(other), { fetched: false, human: false, anomalies: [] });
  });

  it("with accounts configured, authorship beats the footer", () => {
    const bare = authored("Rename the flag.", "the-principal");
    const read = reviewSignals(bare, null, ["pando-ramet"]);
    assert.equal(read.human, true);
    assert.deepEqual(read.anomalies, []);
    const own = authored(`Applied.\n\n---\n${ATTRIBUTION_FOOTER}`, "pando-ramet");
    assert.deepEqual(reviewSignals(own, null, ["pando-ramet"]), {
      fetched: true,
      human: false,
      anomalies: [],
    });
  });

  it("a footer on a foreign account is an anomaly, loudly", () => {
    const forged = authored(`LGTM.\n\n---\n${ATTRIBUTION_FOOTER}`, "the-principal");
    const read = reviewSignals(forged, null, ["pando-ramet"]);
    assert.deepEqual(read.anomalies, [{ kind: "foreign-footer", author: "the-principal" }]);
  });

  it("an agent account posting bare is footer drift", () => {
    const bare = authored("Applied, no footer.", "pando-ramet");
    const read = reviewSignals(bare, null, ["pando-ramet"]);
    assert.deepEqual(read.anomalies, [{ kind: "footer-drift", author: "pando-ramet" }]);
    assert.equal(read.human, false);
  });

  it("without accounts, the same texts raise no anomaly", () => {
    const forged = authored(`LGTM.\n\n---\n${ATTRIBUTION_FOOTER}`, "the-principal");
    assert.deepEqual(reviewSignals(forged), { fetched: true, human: false, anomalies: [] });
  });
});


describe("TicketWrites", () => {
  const write = (name, input, at = "2026-08-03T15:14:00.000Z") =>
    JSON.stringify({
      type: "assistant",
      timestamp: at,
      message: {
        role: "assistant",
        content: [{ type: "tool_use", id: "toolu_w", name, input }],
      },
    });

  it("an issue-writing call names its ticket", () => {
    const text = write("mcp__github__add_issue_comment", {
      owner: "o",
      repo: "r",
      issue_number: 61,
      body: "done",
    });
    assert.deepEqual([...ticketWrites(text)], ["o/r#61"]);
  });

  it("reading a ticket is not updating it", () => {
    const text = write("mcp__github__issue_read", { owner: "o", repo: "r", issue_number: 61 });
    assert.deepEqual([...ticketWrites(text)], []);
  });

  it("a write before the boundary is another turn's", () => {
    const text = write(
      "mcp__github__issue_write",
      { owner: "o", repo: "r", issue_number: 61 },
      "2026-08-03T14:00:00.000Z",
    );
    assert.deepEqual([...ticketWrites(text, "2026-08-03T15:10:00.000Z")], []);
  });

  it("owner and repo casing folds to one ticket", () => {
    const text = write("mcp__github__issue_write", { owner: "O", repo: "R", issue_number: 61 });
    assert.deepEqual([...ticketWrites(text)], ["o/r#61"]);
  });
});


describe("GrillingInvoked", () => {
  const user = (text, at) =>
    JSON.stringify({ type: "user", timestamp: at, message: { role: "user", content: text } });
  const skill = (name, at) =>
    JSON.stringify({
      type: "assistant",
      timestamp: at,
      message: {
        role: "assistant",
        content: [{ type: "tool_use", id: "t1", name: "Skill", input: { skill: name } }],
      },
    });

  it("the typed slash command counts", () => {
    const text = user(
      "<command-name>/grill-me</command-name>\n<command-args>the plan</command-args>",
      "2026-08-03T15:10:00.000Z",
    );
    assert.equal(grillingInvokedAt(text), "2026-08-03T15:10:00.000Z");
  });

  it("the Skill call counts, and the LAST invocation wins", () => {
    const text = [
      skill("grilling", "2026-08-03T15:00:00.000Z"),
      skill("grilling", "2026-08-03T16:00:00.000Z"),
    ].join("\n");
    assert.equal(grillingInvokedAt(text), "2026-08-03T16:00:00.000Z");
  });

  it("prose about grilling is not an invocation", () => {
    const text = [user("let us grill the plan later", "2026-08-03T15:10:00.000Z"), skill("tdd", "2026-08-03T15:11:00.000Z")].join("\n");
    assert.equal(grillingInvokedAt(text), null);
  });
});

// --------------------------------------------- render pulls first (#52)

describe("RenderPullsTheStoreFirst", () => {
  /** git in `dir`, throwing on failure. */
  function sh(dir, ...args) {
    const result = spawnSync("git", ["-C", dir, ...args], { encoding: "utf8" });
    assert.equal(result.status, 0, `git ${args.join(" ")} failed:\n${result.stderr}`);
    return result.stdout;
  }

  function cli(root, ...args) {
    return spawnSync(process.execPath, [path.join(SKILL, "ledger.mjs"), "--root", root, ...args], {
      encoding: "utf8",
      env: { PATH: process.env.PATH, HOME: fs.mkdtempSync(path.join(os.tmpdir(), "nohome-")) },
    });
  }

  /** A store clone whose origin holds one event, plus a second writer's clone. */
  function clonedStore() {
    const seed = tempStore();
    sh(seed, "init", "-q", "-b", "main");
    sh(seed, "config", "user.email", "t@example.test");
    sh(seed, "config", "user.name", "t");
    writeLog(seed, "s1", [{ ...opened("ours"), at: "2026-01-01T00:00:00+00:00" }]);
    fs.writeFileSync(path.join(seed, "ledger", "s1.url"), "https://x.test/code/s1\n");
    sh(seed, "add", "-A");
    sh(seed, "commit", "-q", "-m", "seed");
    const origin = fs.mkdtempSync(path.join(os.tmpdir(), "ledger-origin-"));
    spawnSync("git", ["init", "-q", "--bare", "-b", "main", origin], { encoding: "utf8" });
    sh(seed, "remote", "add", "origin", origin);
    sh(seed, "push", "-q", "-u", "origin", "main");

    const root = fs.mkdtempSync(path.join(os.tmpdir(), "ledger-ours-"));
    assert.equal(
      spawnSync("git", ["clone", "-q", origin, root], { encoding: "utf8" }).status,
      0,
    );
    sh(root, "config", "user.email", "t@example.test");
    sh(root, "config", "user.name", "t");
    return { root, origin, seed };
  }

  /** Another writer publishes a thread our clone has never seen. */
  function othersPublish(seed, slug) {
    fs.appendFileSync(
      path.join(seed, "ledger", "s2.jsonl"),
      `${JSON.stringify({ ...opened(slug), at: "2026-01-02T00:00:00+00:00" })}\n`,
    );
    fs.writeFileSync(path.join(seed, "ledger", "s2.url"), "https://x.test/code/s2\n");
    sh(seed, "add", "-A");
    sh(seed, "commit", "-q", "-m", "ledger(other): a thread we do not have");
    sh(seed, "push", "-q", "origin", "main");
  }

  // The measured cost this replaces: the discipline lived in SKILL.md as
  // "pull immediately before rendering", so every turn re-derived it and
  // a stale page published cleanly whenever a turn forgot.
  it("renders what the remote has, not what the checkout had", () => {
    const { root, seed } = clonedStore();
    othersPublish(seed, "theirs");
    const out = path.join(root, "LEDGER.md");
    const result = cli(root, "render", "--format", "md", "--out", out);
    assert.equal(result.status, 0, `render failed: ${result.stderr}`);
    const text = fs.readFileSync(out, "utf8");
    assert.match(text, /theirs/);
    assert.doesNotMatch(text, /Possibly outdated/);
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("--no-pull renders the checkout as it stands", () => {
    const { root, seed } = clonedStore();
    othersPublish(seed, "theirs");
    const out = path.join(root, "LEDGER.md");
    const result = cli(root, "render", "--format", "md", "--no-pull", "--out", out);
    assert.equal(result.status, 0, `render failed: ${result.stderr}`);
    const text = fs.readFileSync(out, "utf8");
    assert.doesNotMatch(text, /theirs/);
    assert.match(text, /ours/);
    // Honest about what it skipped: the page says so.
    assert.match(text, /Possibly outdated: rendered without checking the remote/);
    fs.rmSync(root, { recursive: true, force: true });
  });

  // Reports, never gates: a ledger that refuses to render when the
  // network is down is a worse tool than one that renders and says so.
  it("a store that cannot fast-forward still renders, and says why", () => {
    const { root } = clonedStore();
    // Diverged: a local commit the remote does not have, so --ff-only
    // has nowhere to go.
    fs.appendFileSync(
      path.join(root, "ledger", "s1.jsonl"),
      `${JSON.stringify({ ...opened("local-only"), at: "2026-01-03T00:00:00+00:00" })}\n`,
    );
    sh(root, "add", "-A");
    sh(root, "commit", "-q", "-m", "ledger(s1): local");
    sh(root, "remote", "set-url", "origin", path.join(root, "no-such-remote"));
    const out = path.join(root, "LEDGER.md");
    const result = cli(root, "render", "--format", "md", "--out", out);
    assert.equal(result.status, 0, `render failed: ${result.stderr}`);
    assert.match(result.stderr, /could not fast-forward/);
    const text = fs.readFileSync(out, "utf8");
    assert.match(text, /local-only/);
    // The reader learns what the operator would: the page banners it.
    assert.match(text, /Possibly outdated: the store could not be fast-forwarded/);
    // Same banner on the HTML page, as static markup the page script
    // cannot lose.
    const html = path.join(root, "ledger.html");
    const htmlRun = cli(root, "render", "--out", html);
    assert.equal(htmlRun.status, 0, `html render failed: ${htmlRun.stderr}`);
    assert.match(fs.readFileSync(html, "utf8"), /id="stale">⚠ Possibly outdated/);
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("a plain log directory renders without reaching for a remote", () => {
    const root = tempStore();
    writeLog(root, "s1", [{ ...opened("bare"), at: "2026-01-01T00:00:00+00:00" }]);
    fs.writeFileSync(path.join(root, "ledger", "s1.url"), "https://x.test/code/s1\n");
    const out = path.join(root, "LEDGER.md");
    const result = cli(root, "render", "--format", "md", "--out", out);
    assert.equal(result.status, 0, `render failed: ${result.stderr}`);
    assert.doesNotMatch(result.stderr, /fast-forward/);
    const text = fs.readFileSync(out, "utf8");
    assert.match(text, /bare/);
    assert.doesNotMatch(text, /Possibly outdated/);
    fs.rmSync(root, { recursive: true, force: true });
  });
});
