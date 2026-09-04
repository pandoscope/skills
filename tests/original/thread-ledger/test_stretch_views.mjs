// The diligence section — stretches as the page shows them.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import { fold } from "../../../original/thread-ledger/core.mjs";
import { renderBody } from "../../../original/thread-ledger/views.mjs";
import { append } from "../../../original/thread-ledger/ledger.mjs";
import {
  opened,
  tempStore,
  writeLog,
  digest,
  sessEvent,
  sealDigest,
  SKILL,
} from "./helpers.mjs";

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
