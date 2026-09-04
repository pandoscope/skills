// The store's CI guard, the forge reconciler, and the one implementation.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import { fold } from "../../../original/thread-ledger/core.mjs";
import {
  append,
  mergedReport,
  push,
  renderPage,
} from "../../../original/thread-ledger/ledger.mjs";
import {
  opened,
  tempStore,
  writeLog,
  SKILL,
} from "./helpers.mjs";

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

// -------------------------------------------------------- one implementation

describe("OneImplementation", () => {
  it("the page bundles the same modules the recorder uses", () => {
    // The whole reason this is JavaScript: the browser is one of the
    // three consumers of the fold, and a second copy of these semantics
    // is the one that would drift.
    const page = renderPage([opened("a")], "t", null, {}, null);
    const state = fs.readFileSync(path.join(SKILL, "core/state.mjs"), "utf8");
    const marker = state.match(/function fold\(events\) \{[\s\S]{0,80}/)[0];
    assert.ok(page.includes(marker.replace(/^export /, "")), "fold() is not in the page");
  });

  it("the bundle names every part of the core and the views", () => {
    // `bundle()` inlines the parts by name because it strips module
    // syntax, so a part nobody added there is simply absent from the
    // page — and the page fails at boot, in the browser, with the
    // recorder's own tests still green.
    const source = fs.readFileSync(path.join(SKILL, "store/pages.mjs"), "utf8");
    for (const dir of ["core", "views"]) {
      const bundled = [...source.matchAll(new RegExp(`"(${dir}/[\\w-]+\\.mjs)"`, "g"))];
      const parts = fs
        .readdirSync(path.join(SKILL, dir))
        .filter((name) => name.endsWith(".mjs"))
        .map((name) => `${dir}/${name}`);
      assert.deepEqual(bundled.map((hit) => hit[1]).sort(), parts.sort(), dir);
    }
  });

  it("the core and the views import nothing but each other, so they run in a browser", () => {
    // Browser-safe means node builtins are the thing to keep out: a
    // `node:fs` anywhere under here is a part that cannot be inlined,
    // and the page would fail at boot rather than at build.
    for (const dir of ["core", "views"]) {
      const files = fs
        .readdirSync(path.join(SKILL, dir))
        .filter((name) => name.endsWith(".mjs"))
        .map((name) => `${dir}/${name}`);
      for (const name of [`${dir}.mjs`, ...files]) {
        const text = fs.readFileSync(path.join(SKILL, name), "utf8");
        assert.doesNotMatch(text, /require\(/, name);
        for (const [, specifier] of text.matchAll(/\bfrom "([^"]+)";/g)) {
          assert.match(
            specifier,
            /^(?:\.\/(?:core|views)\/[\w-]+\.mjs|\.\/[\w-]+\.mjs|\.\.\/core\.mjs)$/,
            `${name}: ${specifier}`,
          );
        }
      }
    }
  });
});
