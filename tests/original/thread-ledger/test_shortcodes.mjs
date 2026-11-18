// The org's one shortcode map, read from the file `SHORTCODE_MAP` names
// (pandoscope/pandoscope#61, skills#287).

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { afterEach, describe, it } from "node:test";

import { checkResponseHygiene } from "../../../original/thread-ledger/checks/response.mjs";
import { readCodes, readForge } from "../../../original/thread-ledger/store/io.mjs";
import { codesOf, readShortcodeMap } from "../../../original/thread-ledger/store/shortcodes.mjs";

const LEDGER = new URL("../../../original/thread-ledger/ledger.mjs", import.meta.url).pathname;

const MAP = {
  _comment: "the map's own comment",
  repos: { AET: "pandoscope/agentic-engineering-template", skills: "pandoscope/skills" },
};

/**
 * A store, and a map file somewhere else under a name of its own.
 *
 * `beside` also puts a map where the ledger once looked for one:
 * `waybill/shortcodes.json` in the store's parent.
 */
function session({ map = true, storeMaps = [], beside = false } = {}) {
  const top = fs.mkdtempSync(path.join(os.tmpdir(), "shortcodes-"));
  const root = path.join(top, "session-memory");
  fs.mkdirSync(root);
  const elsewhere = fs.mkdtempSync(path.join(os.tmpdir(), "org-config-"));
  const file = path.join(elsewhere, "codes-of-the-org.json");
  if (map) fs.writeFileSync(file, JSON.stringify(MAP));
  if (beside) {
    fs.mkdirSync(path.join(top, "waybill"));
    fs.writeFileSync(path.join(top, "waybill", "shortcodes.json"), JSON.stringify(MAP));
  }
  for (const rel of storeMaps) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), JSON.stringify({ X: "o/x" }));
  }
  return { root, file };
}

/** The readers that take no env read the process's: set it for one test. */
const saved = process.env.SHORTCODE_MAP;
function useMap(file) {
  if (file === undefined) delete process.env.SHORTCODE_MAP;
  else process.env.SHORTCODE_MAP = file;
}
afterEach(() => useMap(saved));

describe("the shortcode map", () => {
  it("is read from the file SHORTCODE_MAP names, anywhere and under any name, without its comment", () => {
    const { root, file } = session();
    const { config, note } = readShortcodeMap(root, { SHORTCODE_MAP: file });
    assert.equal(note, null);
    assert.deepEqual(config, { repos: MAP.repos });
  });

  it("is absent with SHORTCODE_MAP unset, and the note names the variable", () => {
    const { root } = session({ storeMaps: ["config/shortcodes.json"] });
    const { config, note } = readShortcodeMap(root, {});
    assert.equal(config, null);
    assert.match(note ?? "", /no shortcode map is configured/);
    assert.match(note ?? "", /SHORTCODE_MAP/);
  });

  it("is not looked for beside the store with SHORTCODE_MAP unset", () => {
    const { root } = session({ beside: true });
    assert.equal(readShortcodeMap(root, {}).config, null);
    assert.equal(readShortcodeMap(root, { WAYBILL_ROOT: path.join(path.dirname(root), "waybill") }).config, null);
  });

  it("fails and names the file when SHORTCODE_MAP names a missing file", () => {
    const { root, file } = session({ map: false });
    assert.throws(() => readShortcodeMap(root, { SHORTCODE_MAP: file }), (error) =>
      String(error.message).includes(file),
    );
  });

  for (const [label, text] of [["does not parse", "{"], ["is not an object", "[]"]]) {
    it(`fails and names the file when the map ${label}`, () => {
      const { root, file } = session();
      fs.writeFileSync(file, text);
      assert.throws(() => readShortcodeMap(root, { SHORTCODE_MAP: file }), (error) =>
        String(error.message).includes(file),
      );
    });
  }

  for (const second of ["config/shortcodes.json", "repo-codes.json"]) {
    it(`fails beside a second map in the store: ${second}`, () => {
      const { root, file } = session({ storeMaps: [second] });
      assert.throws(() => readShortcodeMap(root, { SHORTCODE_MAP: file }), (error) =>
        String(error.message).includes(second),
      );
    });
  }

  it("runs the second-map guard before it reads the configured file", () => {
    const { root, file } = session({ map: false, storeMaps: ["repo-codes.json"] });
    assert.throws(() => readShortcodeMap(root, { SHORTCODE_MAP: file }), (error) =>
      String(error.message).includes("repo-codes.json"),
    );
  });

  it("gives the views their labels: repository to shortcode", () => {
    assert.deepEqual(codesOf({ repos: MAP.repos }), {
      "pandoscope/agentic-engineering-template": "AET",
      "pandoscope/skills": "skills",
    });
    assert.deepEqual(codesOf(null), {});
  });

  it("is what the store readers return, and the store's own maps are not read", () => {
    const { root, file } = session();
    useMap(file);
    assert.deepEqual(readForge(root), { repos: MAP.repos });
    assert.deepEqual(readCodes(root), codesOf({ repos: MAP.repos }));
    useMap(undefined);
    const bare = session({ storeMaps: ["repo-codes.json"], beside: true });
    assert.deepEqual(readCodes(bare.root), {});
    assert.deepEqual(readForge(bare.root), {});
  });
});

describe("the response check and the shortcode map", () => {
  const ctx = (root) => ({
    root,
    turnStart: new Date(0),
    assistantText: "Merged AET#3.",
    events: [],
    session: "s",
  });

  it("checks references against the configured map", () => {
    const { root, file } = session();
    useMap(file);
    const verdict = checkResponseHygiene(ctx(root));
    assert.equal(verdict.verdict, "fail");
    assert.match(String(verdict.reason ?? verdict.detail), /AET#3/);
  });

  it("fails when the store holds a second map", () => {
    const { root, file } = session({ storeMaps: ["config/shortcodes.json"] });
    useMap(file);
    const verdict = checkResponseHygiene(ctx(root));
    assert.equal(verdict.verdict, "fail");
    assert.match(verdict.detail, /config\/shortcodes\.json/);
    // The Stop hook blocks with `reason`; without one the session read `undefined`.
    assert.match(String(verdict.reason), /config\/shortcodes\.json/);
  });

  it("is unconfigured with SHORTCODE_MAP unset, says that no map is configured and names the variable", () => {
    const { root } = session({ beside: true });
    useMap(undefined);
    const verdict = checkResponseHygiene(ctx(root));
    assert.equal(verdict.verdict, "unconfigured");
    assert.match(verdict.detail, /no shortcode map is configured/);
    assert.match(verdict.detail, /SHORTCODE_MAP/);
  });

  for (const [label, text] of [["is missing", null], ["does not parse", "{"], ["is not an object", "[]"]]) {
    it(`fails and names the file when the configured map ${label}`, () => {
      const { root, file } = session({ map: text !== null });
      if (text !== null) fs.writeFileSync(file, text);
      useMap(file);
      const verdict = checkResponseHygiene(ctx(root));
      assert.equal(verdict.verdict, "fail");
      assert.ok(verdict.detail.includes(file), verdict.detail);
      assert.ok(String(verdict.reason).includes(file), String(verdict.reason));
    });
  }
});

describe("render and the shortcode map", () => {
  /** Render an empty store through the shipped CLI. */
  function render(root, env) {
    const out = path.join(root, "page.html");
    const base = { ...process.env };
    delete base.SHORTCODE_MAP;
    const result = spawnSync(
      process.execPath,
      [LEDGER, "render", "--root", root, "--out", out, "--no-pull", "--session-url", "https://x.test/code/s"],
      { encoding: "utf8", env: { ...base, ...env } },
    );
    return { ...result, out };
  }

  it("labels tickets from the configured map", () => {
    const { root, file } = session();
    fs.mkdirSync(path.join(root, "ledger"));
    fs.writeFileSync(
      path.join(root, "ledger", "s.jsonl"),
      `${JSON.stringify({ ev: "opened", thread: "t", title: "T", ticket: "pandoscope/agentic-engineering-template#5", at: "2026-01-01T00:00:00+00:00" })}\n`,
    );
    const result = render(root, { SHORTCODE_MAP: file });
    assert.equal(result.status, 0, result.stderr);
    // The page labels its tickets in the browser, from the codes it carries.
    assert.match(fs.readFileSync(result.out, "utf8"), /"codes":\{"pandoscope\/agentic-engineering-template":"AET"/);
  });

  it("says that no shortcode map is configured with SHORTCODE_MAP unset", () => {
    const { root } = session({ beside: true });
    const result = render(root, {});
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stderr, /no shortcode map is configured/);
  });

  for (const [label, text] of [["is missing", null], ["does not parse", "{"], ["is not an object", "[]"]]) {
    it(`stops and names the file when the configured map ${label}`, () => {
      const { root, file } = session({ map: text !== null });
      if (text !== null) fs.writeFileSync(file, text);
      const result = render(root, { SHORTCODE_MAP: file });
      assert.equal(result.status, 1, result.stderr);
      assert.ok(result.stderr.includes(file), result.stderr);
      assert.equal(fs.existsSync(result.out), false);
    });
  }

  it("stops beside a second map in the store", () => {
    const { root, file } = session({ storeMaps: ["repo-codes.json"] });
    const result = render(root, { SHORTCODE_MAP: file });
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, /repo-codes\.json/);
  });
});

describe("the skill's code and the shortcode map's owner", () => {
  const SKILL = new URL("../../../original/thread-ledger/", import.meta.url).pathname;
  // The review driver reads the order that fired the session from the
  // waybill's checkout: its own dependency, outside the shortcode map's.
  const OUTSIDE = new Set(["SKILL.md", "review-driver.mjs", path.join("review", "policy.mjs")]);

  it("names no waybill outside SKILL.md and the review driver", () => {
    const named = fs
      .readdirSync(SKILL, { recursive: true, encoding: "utf8" })
      .filter((rel) => fs.statSync(path.join(SKILL, rel)).isFile())
      .filter((rel) => !OUTSIDE.has(rel))
      .filter((rel) => /waybill/i.test(fs.readFileSync(path.join(SKILL, rel), "utf8")));
    assert.deepEqual(named, []);
  });
});

describe("SKILL.md on the shortcode map", () => {
  const skill = fs
    .readFileSync(new URL("../../../original/thread-ledger/SKILL.md", import.meta.url), "utf8")
    .replace(/\s+/g, " ");

  it("describes SHORTCODE_MAP and not the waybill lookup", () => {
    assert.match(skill, /`SHORTCODE_MAP`/);
    assert.doesNotMatch(skill, /WAYBILL_ROOT/);
    assert.doesNotMatch(skill, /beside the store/);
  });

  it("states one condition for unconfigured: SHORTCODE_MAP unset", () => {
    assert.match(skill, /With `SHORTCODE_MAP` unset the check reports unconfigured/);
  });

  it("says that a missing, unreadable or non-object map fails the check and render", () => {
    assert.match(skill, /A configured map that is missing, does not parse, or is not an object, fails the response check and render/);
  });
});
