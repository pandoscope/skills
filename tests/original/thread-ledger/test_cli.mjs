// The command line — argument grammar, output, declare, render.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import {
  append,
  parseArgs,
  push,
  declareText,
} from "../../../original/thread-ledger/ledger.mjs";
import {
  readTurnSummary,
  resolveSummaryFile,
} from "../../../original/thread-ledger/heartbeat.mjs";
import {
  opened,
  throws,
  tempStore,
  writeLog,
  SKILL,
} from "./helpers.mjs";

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

describe("declare", () => {
  it("round-trips through the heartbeat's own reader", () => {
    const text = declareText({
      tickets: "pandoscope/skills#157",
      reviews: "nothing-to-persist",
      rulings: "bundle-minimal-core-curated",
      "no-update": ["pandoscope/skills#71 blocked on the principal"],
    });
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "declare-"));
    try {
      const file = path.join(dir, "summary.txt");
      fs.writeFileSync(file, text, "utf8");
      const parsed = readTurnSummary(file);
      assert.deepEqual(parsed.threads, []);
      assert.deepEqual(parsed.tickets, ["pandoscope/skills#157"]);
      assert.equal(parsed.reviews, "nothing-to-persist");
      assert.deepEqual(parsed.rulings, ["bundle-minimal-core-curated"]);
      assert.deepEqual(parsed.waivers, {
        "pandoscope/skills#71": "blocked on the principal",
      });
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("writes to the default path when nothing names one", () => {
    // The CLI's own resolution, run as a process: `declareText` is pure
    // and never reaches it, so the branch that builds the fallback path
    // had no test and a missing import broke it silently (#188).
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "declare-home-"));
    try {
      const result = spawnSync(
        process.execPath,
        [path.join(SKILL, "ledger.mjs"), "declare", "--reviews", "none"],
        {
          encoding: "utf8",
          env: { ...process.env, HOME: dir, TURN_SUMMARY_PATH: undefined },
        },
      );
      assert.equal(result.status, 0, result.stderr);
      const written = path.join(dir, ".claude", "turn-summary.txt");
      assert.ok(fs.existsSync(written), `nothing at ${written}`);
      assert.match(fs.readFileSync(written, "utf8"), /^reviews: none$/m);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("writes the two core lines even when empty", () => {
    const text = declareText({ reviews: "none" });
    assert.equal(text, "tickets: \nreviews: none\n");
  });

  it("keeps detail after the reviews state word", () => {
    const text = declareText({ reviews: "persisted em record for dm!29" });
    assert.match(text, /^reviews: persisted em record for dm!29$/m);
  });

  it("requires a reviews declaration", () => {
    throws(() => declareText({}), "--reviews is required");
  });

  it("refuses a reviews word outside the heartbeat's grammar", () => {
    throws(() => declareText({ reviews: "done" }), "names no state");
  });

  it("refuses the retired --threads flag with the skills#153 pointer", () => {
    throws(
      () => declareText({ reviews: "none", threads: "handoff-skill" }),
      "observed from the ledger",
    );
  });

  it("refuses a bare ticket number", () => {
    throws(
      () => declareText({ reviews: "none", tickets: "#157" }),
      "owner/repo#n",
    );
  });

  it("refuses a waiver without a reason", () => {
    throws(
      () => declareText({ reviews: "none", "no-update": ["skills#71"] }),
      "target and a reason",
    );
  });

  it("accumulates repeated --no-update flags", () => {
    const [cmd, opts] = parseArgs([
      "declare", "--reviews", "none",
      "--no-update", "a/b#1 first reason",
      "--no-update", "a/b#2 second reason",
    ]);
    assert.equal(cmd, "declare");
    const text = declareText(opts);
    assert.match(text, /no-update: a\/b#1 first reason\n/);
    assert.match(text, /no-update: a\/b#2 second reason\n/);
  });
});

describe("summary path resolution (skills#153)", () => {
  // One env var is the wrapper/writer/checker agreement; these pin the
  // fallback ladder so a migration cannot silently strand either side.
  const withEnv = (vars, fn) => {
    const saved = {};
    for (const [k, v] of Object.entries(vars)) {
      saved[k] = process.env[k];
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    try {
      return fn();
    } finally {
      for (const [k, v] of Object.entries(saved)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    }
  };

  it("reads the v2 path when the env var names one", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sumpath-"));
    try {
      const v2 = path.join(dir, ".turn", "summary.txt");
      fs.mkdirSync(path.dirname(v2), { recursive: true });
      fs.writeFileSync(v2, "tickets: \nreviews: none\n", "utf8");
      withEnv({ TURN_SUMMARY_PATH: v2, HOME: dir }, () => {
        const resolved = resolveSummaryFile();
        assert.equal(resolved.file, v2);
        assert.equal(resolved.legacy, false);
      });
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("falls back to the legacy home file and says so", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sumpath-"));
    try {
      const legacy = path.join(dir, ".claude", "turn-summary.txt");
      fs.mkdirSync(path.dirname(legacy), { recursive: true });
      fs.writeFileSync(legacy, "tickets: \nreviews: none\n", "utf8");
      withEnv({ TURN_SUMMARY_PATH: path.join(dir, ".turn", "summary.txt"), HOME: dir }, () => {
        const resolved = resolveSummaryFile();
        assert.equal(resolved.file, legacy);
        assert.equal(resolved.legacy, true);
      });
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("uses the legacy path when the env var is unset", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sumpath-"));
    try {
      withEnv({ TURN_SUMMARY_PATH: undefined, HOME: dir }, () => {
        const resolved = resolveSummaryFile();
        assert.equal(resolved.file, path.join(dir, ".claude", "turn-summary.txt"));
        assert.equal(resolved.legacy, true);
      });
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
