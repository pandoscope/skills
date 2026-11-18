// The org's one shortcode map, read from the session's waybill checkout
// (pandoscope/pandoscope#61).

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import { checkResponseHygiene } from "../../../original/thread-ledger/checks/response.mjs";
import { readCodes, readForge } from "../../../original/thread-ledger/store/io.mjs";
import { codesOf, readShortcodeMap } from "../../../original/thread-ledger/store/shortcodes.mjs";

const MAP = {
  _comment: "the waybill's own comment",
  repos: { AET: "pandoscope/agentic-engineering-template", skills: "pandoscope/skills" },
};

/** A session root holding a store and, when asked, a waybill with its map. */
function session({ waybill = true, storeMaps = [] } = {}) {
  const top = fs.mkdtempSync(path.join(os.tmpdir(), "shortcodes-"));
  const root = path.join(top, "session-memory");
  fs.mkdirSync(root);
  if (waybill) {
    fs.mkdirSync(path.join(top, "waybill"));
    fs.writeFileSync(path.join(top, "waybill", "shortcodes.json"), JSON.stringify(MAP));
  }
  for (const rel of storeMaps) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), JSON.stringify({ X: "o/x" }));
  }
  return root;
}

describe("the shortcode map", () => {
  it("is read from the waybill beside the store, without its comment", () => {
    const root = session();
    const { config, note } = readShortcodeMap(root, {});
    assert.equal(note, null);
    assert.deepEqual(config, { repos: MAP.repos });
  });

  it("is read from WAYBILL_ROOT when it names the waybill", () => {
    const root = session({ waybill: false });
    const elsewhere = fs.mkdtempSync(path.join(os.tmpdir(), "waybill-"));
    fs.writeFileSync(path.join(elsewhere, "shortcodes.json"), JSON.stringify(MAP));
    assert.deepEqual(readShortcodeMap(root, { WAYBILL_ROOT: elsewhere }).config, {
      repos: MAP.repos,
    });
  });

  it("is absent without a waybill checkout, and the note says where it looked", () => {
    const root = session({ waybill: false, storeMaps: ["config/shortcodes.json"] });
    const { config, note } = readShortcodeMap(root, {});
    assert.equal(config, null);
    assert.match(note ?? "", /waybill/);
    assert.match(note ?? "", /shortcodes\.json/);
  });

  for (const second of ["config/shortcodes.json", "repo-codes.json"]) {
    it(`fails beside a second map in the store: ${second}`, () => {
      const root = session({ storeMaps: [second] });
      assert.throws(() => readShortcodeMap(root, {}), (error) =>
        String(error.message).includes(second),
      );
    });
  }

  it("gives the views their labels: repository to shortcode", () => {
    assert.deepEqual(codesOf({ repos: MAP.repos }), {
      "pandoscope/agentic-engineering-template": "AET",
      "pandoscope/skills": "skills",
    });
    assert.deepEqual(codesOf(null), {});
  });

  it("is what the store readers return, and the store's own maps are not read", () => {
    const root = session();
    assert.deepEqual(readForge(root), { repos: MAP.repos });
    assert.deepEqual(readCodes(root), codesOf({ repos: MAP.repos }));
    const bare = session({ waybill: false, storeMaps: ["repo-codes.json"] });
    assert.deepEqual(readCodes(bare), {});
    assert.deepEqual(readForge(bare), {});
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

  it("checks references against the waybill's map", () => {
    const verdict = checkResponseHygiene(ctx(session()));
    assert.equal(verdict.verdict, "fail");
    assert.match(String(verdict.reason ?? verdict.detail), /AET#3/);
  });

  it("fails when the store holds a second map", () => {
    const verdict = checkResponseHygiene(ctx(session({ storeMaps: ["config/shortcodes.json"] })));
    assert.equal(verdict.verdict, "fail");
    assert.match(verdict.detail, /config\/shortcodes\.json/);
    // The Stop hook blocks with `reason`; without one the session read `undefined`.
    assert.match(String(verdict.reason), /config\/shortcodes\.json/);
  });

  it("is unconfigured without a waybill checkout, and says so", () => {
    const verdict = checkResponseHygiene(ctx(session({ waybill: false })));
    assert.equal(verdict.verdict, "unconfigured");
    assert.match(verdict.detail, /waybill/);
  });
});

describe("SKILL.md on the shortcode map", () => {
  const skill = fs
    .readFileSync(new URL("../../../original/thread-ledger/SKILL.md", import.meta.url), "utf8")
    .replace(/\s+/g, " ");

  it("states one condition for unconfigured: no waybill checkout", () => {
    assert.doesNotMatch(skill, /No map in the store means/);
    assert.match(skill, /Without a waybill checkout the check reports unconfigured/);
  });

  it("says that an unreadable or non-object map fails the check and render", () => {
    assert.match(skill, /A waybill map that does not parse, or is not an object, fails the response check and render/);
  });
});
