// Appending and pushing — races, identity, and the branch guard.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import {
  fold,
  mergeLogLines,
  stamp,
  validate,
} from "../../../original/thread-ledger/core.mjs";
import {
  append,
  push,
} from "../../../original/thread-ledger/ledger.mjs";
import {
  opened,
  throws,
  tempStore,
  writeLog,
  SKILL,
} from "./helpers.mjs";

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
