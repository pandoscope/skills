// The preflight — the heartbeat run as a linter before the turn ends.
//
// skills#126: same checks, same wording, run as a tool call while the
// reply is still a draft. Preflight REPORTS — it never seals, never
// blocks, never writes ledger events or the correction exercise — and
// with --fix it repairs notation in the draft file (refs, commit
// hashes) and nothing else. These tests spawn the CLI exactly as an
// agent would, against the staged state of kata 43 (a clean turn whose
// only fault can come from the draft under test).

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const HEARTBEAT = path.join(HERE, "../../../original/thread-ledger/heartbeat.mjs");
const KATAS = path.join(HERE, "katas");
const BASE = "43-unlinked-ref-in-the-response";

/** Stage kata 43's state in a throwaway directory, as the runner does. */
function stage() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "preflight-"));
  fs.cpSync(path.join(KATAS, BASE), dir, { recursive: true });
  fs.cpSync(path.join(KATAS, "_lib.sh"), path.join(dir, "_lib.sh"));
  fs.mkdirSync(path.join(dir, "repos"), { recursive: true });
  const built = spawnSync("bash", [path.join(dir, "setup.sh")], { cwd: dir, encoding: "utf8" });
  assert.equal(built.status, 0, `setup.sh failed:\n${built.stderr}`);
  const spec = JSON.parse(fs.readFileSync(path.join(dir, "expected.json"), "utf8"));
  const summary = path.join(dir, "home", ".claude", "turn-summary.txt");
  const stamp = new Date(spec.summary_written_at);
  fs.utimesSync(summary, stamp, stamp);
  return dir;
}

function preflight(dir, draftText, extraArgs = []) {
  const draft = path.join(dir, "draft.md");
  fs.writeFileSync(draft, draftText, "utf8");
  const stdin = JSON.stringify({
    hook_event_name: "Stop",
    session_id: "kata",
    transcript_path: path.join(dir, "transcript.jsonl"),
    cwd: dir,
    stop_hook_active: false,
  });
  const result = spawnSync(
    process.execPath,
    [HEARTBEAT, "--preflight", "--draft", draft, ...extraArgs],
    {
      input: stdin,
      encoding: "utf8",
      env: {
        PATH: process.env.PATH,
        HOME: path.join(dir, "home"),
        SESSION_MEMORY_ROOT: path.join(dir, "store"),
        WORKSPACE_ROOT: path.join(dir, "workspace"),
        HEARTBEAT_REPO_ROOT: path.join(dir, "repos"),
      },
    },
  );
  return { ...result, draft };
}

function storeLog(dir) {
  return fs.readFileSync(
    path.join(dir, "store", "ledger", "session_kata_clean.jsonl"),
    "utf8",
  );
}

function complianceRecords(dir) {
  const file = path.join(dir, "home", ".claude", "reminder-compliance.jsonl");
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

describe("preflight", () => {
  it("reports every check and seals nothing on a clean draft", () => {
    const dir = stage();
    const before = storeLog(dir);
    const result = preflight(dir, "All checks are green; nothing else changed this turn.\n");
    assert.equal(result.status, 0, `expected clean preflight, got:\n${result.stdout}${result.stderr}`);
    assert.match(result.stdout, /response-hygiene/);
    assert.match(result.stdout, /turn-summary/);
    // Advisory, never a gate: the store's log is byte-identical — no
    // seal, no event, nothing the Stop hook alone is allowed to write.
    assert.equal(storeLog(dir), before);
    // The round is still a compliance record, the trace the dojo mines.
    const outcomes = complianceRecords(dir).map((record) => record.outcome);
    assert.deepEqual(outcomes, ["preflight"]);
  });

  it("names the canonical form for a bare ref and exits nonzero", () => {
    const dir = stage();
    const result = preflight(dir, "Merged skills#97 and pushed the follow-up.\n");
    assert.equal(result.status, 1);
    assert.match(
      result.stdout,
      /\[skills#97\]\(https:\/\/github\.com\/pandoscope\/skills\/issues\/97\)/,
    );
    // Reporting is not the exercise: preflight assigns no homework the
    // Stop hook would later grade.
    assert.equal(
      fs.existsSync(path.join(dir, "home", ".claude", "hygiene-corrections.json")),
      false,
    );
  });

  it("--fix rewrites a bare ref to its canonical link in the draft", () => {
    const dir = stage();
    const result = preflight(dir, "Merged skills#97 and pushed the follow-up.\n", ["--fix"]);
    assert.equal(result.status, 0, `expected clean after fix:\n${result.stdout}${result.stderr}`);
    const fixed = fs.readFileSync(result.draft, "utf8");
    assert.match(
      fixed,
      /\[skills#97\]\(https:\/\/github\.com\/pandoscope\/skills\/issues\/97\)/,
    );
    assert.doesNotMatch(fixed, /(?<!\[)skills#97(?!\])/);
  });

  it("--fix links a commit hash written as inline code", () => {
    const dir = stage();
    const full = spawnSync("git", ["-C", path.join(dir, "repos", "skills"), "rev-parse", "HEAD"], {
      encoding: "utf8",
    }).stdout.trim();
    const short = full.slice(0, 7);
    const result = preflight(dir, `The fix landed as \`${short}\` on the branch.\n`, ["--fix"]);
    assert.equal(result.status, 0, `expected clean after fix:\n${result.stdout}${result.stderr}`);
    const fixed = fs.readFileSync(result.draft, "utf8");
    assert.match(
      fixed,
      new RegExp(
        `\\[skills@${short}\\]\\(https://github\\.com/pandoscope/skills/commit/${full}\\)`,
      ),
    );
  });

  it("leaves an unresolvable hash alone and reports it", () => {
    const dir = stage();
    const result = preflight(dir, "Reverted `deadbeefcafe` before the release.\n", ["--fix"]);
    assert.equal(result.status, 1);
    assert.match(result.stdout, /deadbeefcafe/);
    assert.match(result.stdout, /no clone/);
    assert.match(fs.readFileSync(result.draft, "utf8"), /`deadbeefcafe`/);
  });

  it("never touches hashes inside fenced blocks", () => {
    const dir = stage();
    const full = spawnSync("git", ["-C", path.join(dir, "repos", "skills"), "rev-parse", "HEAD"], {
      encoding: "utf8",
    }).stdout.trim();
    const short = full.slice(0, 7);
    const text = "Quoted log output:\n\n```\ncommit " + short + "\n```\n";
    const result = preflight(dir, text, ["--fix"]);
    assert.equal(result.status, 0, `fenced hash must not fail preflight:\n${result.stdout}`);
    assert.equal(fs.readFileSync(result.draft, "utf8"), text);
  });
});
