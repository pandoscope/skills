// Which conversation an event belongs to, and where the store is.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import {
  fold,
  sessionFromUrl,
  stamp,
  validate,
} from "../../../original/thread-ledger/core.mjs";
import {
  append,
  checkSessionFile,
  parseArgs,
  push,
  readAll,
  resolveRoot,
  resolveSession,
} from "../../../original/thread-ledger/ledger.mjs";
import {
  opened,
  throws,
  tempStore,
  writeLog,
  SKILL,
} from "./helpers.mjs";

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

  it("an explicit --session-url opens a second conversation's log beside the first", () => {
    // The guard exists to catch an INFERRED name disagreeing with the
    // store — one conversation acquiring two names between runs. An
    // identity stated by URL is authoritative (skills#62), so a genuine
    // second conversation appends without hand-creating its log file
    // first. Through the CLI, because that is the path the workaround
    // was invented for.
    const root = tempStore();
    writeLog(root, "session_abc", [{ ...opened("a"), at: "2026-01-01T00:00:00+00:00" }]);
    const run = spawnSync(
      process.execPath,
      [
        path.join(SKILL, "ledger.mjs"), "--root", root, "append",
        "--ev", "opened", "--thread", "b", "--title", "b", "--ticket", "o/r#2",
        "--session-url", "https://x.test/s/session_def", "--no-push",
      ],
      { encoding: "utf8", env: { PATH: process.env.PATH, HOME: root } },
    );
    assert.equal(run.status, 0, run.stderr);
    assert.ok(fs.existsSync(path.join(root, "ledger", "session_def.jsonl")));
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("an inferred --session that disagrees is still refused, toward the URL flag", () => {
    // The original incident stays caught — and the remedy the message
    // offers must not be deleting another session's record.
    const root = tempStore();
    writeLog(root, "chosen-name", [{ ...opened("a"), at: "2026-01-01T00:00:00+00:00" }]);
    const run = spawnSync(
      process.execPath,
      [
        path.join(SKILL, "ledger.mjs"), "--root", root, "append",
        "--ev", "progress", "--thread", "a", "--pct", "10",
        "--session", "uuid-stem", "--no-push",
      ],
      { encoding: "utf8", env: { PATH: process.env.PATH, HOME: root } },
    );
    assert.notEqual(run.status, 0);
    assert.match(run.stderr, /--session-url/);
    assert.doesNotMatch(run.stderr, /delete/i);
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("an explicit identity skips the guard on the direct append path too", () => {
    // The sealing hook appends through the same function with identity
    // from LEDGER_SESSION_URL — explicit there too (ctx.namedItself). A
    // guard that blocked the seal would re-create the workaround one
    // layer down.
    const root = tempStore();
    writeLog(root, "session_abc", [{ ...opened("a"), at: "2026-01-01T00:00:00+00:00" }]);
    const stamped = append(
      root, "session_def", { ev: "progress", thread: "a", pct: 5 },
      null, "https://x.test/s/session_def", true,
    );
    assert.equal(stamped.anchor.session, "session_def");
    assert.ok(fs.existsSync(path.join(root, "ledger", "session_def.jsonl")));
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

// ------------------------------------------------------- store resolution

describe("StoreResolution", () => {
  // The writer and the Stop-hook checker must resolve the SAME clone.
  // The heartbeat is handed SESSION_MEMORY_ROOT (the harness clone in
  // the session root); a writer that ignores it and falls back to a
  // path of its own recreates the split meta#67 removed from
  // ensure-stores.sh — silently, on the first append of every session.
  const withEnv = (vars, fn) => {
    const saved = process.env;
    try {
      process.env = { ...process.env, ...vars };
      return fn();
    } finally {
      process.env = saved;
    }
  };

  it("prefers SESSION_MEMORY_ROOT over any default path", () => {
    const root = tempStore();
    const url = "https://x.test/pandoscope/session-memory.git";
    spawnSync("git", ["-C", root, "init", "-q"]);
    spawnSync("git", ["-C", root, "remote", "add", "origin", url]);
    try {
      withEnv({ SESSION_MEMORY_ROOT: root, SESSION_MEMORY_URL: url }, () => {
        assert.equal(resolveRoot(null), root);
      });
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("derives the harness clone from session.env when no var is set", () => {
    // A bare `ledger.mjs append` in a session gets no exported
    // SESSION_MEMORY_ROOT — the sentinel exports it only inside the Stop
    // hook. Resolution therefore reads the same session.env the hooks
    // read, so the writer lands on the harness clone rather than on a
    // conventional path that may be a different clone entirely.
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "ledger-home-"));
    const sessionRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ledger-root-"));
    const url = "https://x.test/pandoscope/session-memory.git";
    const clone = path.join(sessionRoot, "session-memory");
    fs.mkdirSync(clone, { recursive: true });
    spawnSync("git", ["-C", clone, "init", "-q"]);
    spawnSync("git", ["-C", clone, "remote", "add", "origin", url]);
    fs.mkdirSync(path.join(home, ".claude"), { recursive: true });
    fs.writeFileSync(path.join(home, ".claude", "session.env"), `SESSION_ROOT=${sessionRoot}\n`);
    try {
      withEnv({ HOME: home, SESSION_MEMORY_URL: url, SESSION_MEMORY_ROOT: "" }, () => {
        assert.equal(resolveRoot(null), clone);
      });
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
      fs.rmSync(sessionRoot, { recursive: true, force: true });
    }
  });

  it("refuses rather than cloning a store of its own", () => {
    const absent = path.join(os.tmpdir(), "ledger-absent-store-xyz");
    fs.rmSync(absent, { recursive: true, force: true });
    withEnv(
      {
        SESSION_MEMORY_ROOT: absent,
        SESSION_MEMORY_URL: "https://x.test/pandoscope/session-memory.git",
      },
      () => {
        assert.throws(() => resolveRoot(null), /does not clone one/);
      },
    );
    assert.equal(fs.existsSync(absent), false);
  });
});
