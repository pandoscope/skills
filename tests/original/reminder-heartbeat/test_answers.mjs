// The session answers reader (skills#181 item 1).
//
// The composer writes the file with PyYAML's safe_dump; these fixtures
// are that dialect verbatim, so the reader is tested against what it
// will actually be handed and nothing wider.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import { parseYaml, readAnswers } from "../../../original/thread-ledger/answers.mjs";

const SPAWNED = `detected:
  spawned: true
  identity: p-40be564147c6
  model:
    configured: unknown
    served: unknown
  tools:
  - node
  repos:
  - path: /x
    slug: skills
passed:
  spawn_id: spawn-r0a1
  spawner: p-40be564147c6
  origin: spawner
  role: probe
  principal: p-40be564147c6
  thread: per-session-agent-config
  tickets:
  - pandoscope/skills#179
  - pandoscope/skills#181
  dojo: null
resolved:
  role: probe
  principal: p-40be564147c6
  model: unknown
mismatches: []
reference: session-memory@abc:intents/spawn-r0a1.yml
errors: []
`;

const MISMATCHED = `passed:
  tickets: []
mismatches:
- key: origin
  passed: spawner
  detected: principal
  resolved_to: spawner
errors:
- intent file lacks required key 'spawner' (x)
`;

describe("parseYaml", () => {
  it("reads the composer's answers file into plain objects", () => {
    const doc = parseYaml(SPAWNED);
    assert.equal(doc.detected.spawned, true);
    assert.equal(doc.detected.model.served, "unknown");
    assert.deepEqual(doc.detected.tools, ["node"]);
    assert.deepEqual(doc.detected.repos, [{ path: "/x", slug: "skills" }]);
    assert.equal(doc.passed.origin, "spawner");
    assert.deepEqual(doc.passed.tickets, ["pandoscope/skills#179", "pandoscope/skills#181"]);
    assert.equal(doc.passed.dojo, null);
    assert.equal(doc.resolved.role, "probe");
    assert.deepEqual(doc.mismatches, []);
    assert.deepEqual(doc.errors, []);
    assert.equal(doc.reference, "session-memory@abc:intents/spawn-r0a1.yml");
  });

  it("reads sequences of maps and quoted scalars", () => {
    const doc = parseYaml(MISMATCHED);
    assert.deepEqual(doc.passed, { tickets: [] });
    assert.deepEqual(doc.mismatches, [
      { key: "origin", passed: "spawner", detected: "principal", resolved_to: "spawner" },
    ]);
    assert.deepEqual(doc.errors, ["intent file lacks required key 'spawner' (x)"]);
  });

  it("reads the scalars safe_dump emits", () => {
    const doc = parseYaml(
      [
        "passed: null",
        "tilde: ~",
        "yes: true",
        "no: false",
        "count: 12",
        "single: 'a: b'",
        "double: \"c #d\"",
        "hash: pandoscope/skills#179",
        "empty:",
      ].join("\n"),
    );
    assert.deepEqual(doc, {
      passed: null,
      tilde: null,
      yes: true,
      no: false,
      count: 12,
      single: "a: b",
      double: "c #d",
      hash: "pandoscope/skills#179",
      empty: null,
    });
  });

  it("refuses what it does not read rather than guessing", () => {
    assert.throws(() => parseYaml("tickets: [a, b]\n"), /flow/);
    assert.throws(() => parseYaml("a:\n    b: 1\n  c: 2\n"), /indent/);
  });
});

describe("readAnswers", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "answers-"));

  it("reads nothing when no file is named", () => {
    assert.equal(readAnswers({}), null);
    assert.equal(readAnswers({ REINSET_ANSWERS: "" }), null);
  });

  it("reads nothing when the named file is absent — the first Stop's ordinary state", () => {
    assert.equal(readAnswers({ REINSET_ANSWERS: path.join(dir, "missing.yml") }), null);
  });

  it("returns the parsed answers with their path", () => {
    const file = path.join(dir, "answers.yml");
    fs.writeFileSync(file, SPAWNED);
    const read = readAnswers({ REINSET_ANSWERS: file });
    assert.equal(read.path, file);
    assert.equal(read.answers.resolved.role, "probe");
    assert.equal(read.error, undefined);
  });

  it("reports a torn file as an error, never as absence", () => {
    const file = path.join(dir, "torn.yml");
    fs.writeFileSync(file, "passed: {a: 1}\n");
    const read = readAnswers({ REINSET_ANSWERS: file });
    assert.equal(read.path, file);
    assert.equal(read.answers, undefined);
    assert.match(read.error, /flow/);
  });
});
