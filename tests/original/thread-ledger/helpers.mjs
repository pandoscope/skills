// Shared fixtures for the thread-ledger suites.
//
// One home for the builders every suite reaches for, so a fixture is
// read once and a change to one reaches every test that uses it.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { LedgerError } from "../../../original/thread-ledger/core.mjs";

export const SKILL = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../original/thread-ledger",
);

export const PAGE_JS = fs.readFileSync(path.join(SKILL, "page.mjs"), "utf8");

export function opened(thread, extra = {}) {
  return { ev: "opened", thread, title: thread, ticket: "o/r#1", ...extra };
}

export function throws(fn, fragment) {
  assert.throws(fn, (err) => {
    assert.ok(err instanceof LedgerError, `expected LedgerError, got ${err}`);
    if (fragment) assert.match(err.message, new RegExp(fragment, "i"));
    return true;
  });
}

/** A temp directory with a ledger/ inside, cleaned up by the caller. */
export function tempStore() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ledger-test-"));
  fs.mkdirSync(path.join(root, "ledger"), { recursive: true });
  return root;
}

export function writeLog(root, name, events) {
  fs.writeFileSync(
    path.join(root, "ledger", `${name}.jsonl`),
    events.map((e) => JSON.stringify(e)).join("\n") + "\n",
    "utf8",
  );
}

/** A well-formed digest; a caller breaks one field at a time. */
export function digest(extra = {}) {
  return {
    turns: 2,
    executions: { sealed: 1, blocked: 2, unsealed: 1, observed: 0 },
    checks: { "turn-summary": { fired: 2, cleared: 1, ignored: 1 } },
    tokens: { input: 10, output: 20, cacheRead: 30, cacheCreation: 40 },
    models: ["claude-test-1"],
    ...extra,
  };
}

/** An event stamped into session `s` at minute `min`. */
export function sessEvent(s, min, extra) {
  return {
    at: `2026-01-01T05:${String(min).padStart(2, "0")}:00+00:00`,
    anchor: { session: s, msg: 1, url: `https://x.test/code/${s}` },
    ...extra,
  };
}

/** A digest whose only interesting numbers are the ones passed in. */
export function sealDigest(extra = {}) {
  return {
    turns: 1,
    executions: { sealed: 1, blocked: 0, unsealed: 0, observed: 0 },
    checks: {},
    tokens: { input: 10, output: 100, cacheRead: 1000, cacheCreation: 0 },
    models: ["claude-test-1"],
    ...extra,
  };
}
