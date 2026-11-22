// The review driver katas' order, run and staged session (skills#195, skills#292, skills#295).
//
// A staged session has two origins, the reviewed repository and the waybill,
// and a clone of each under the session's root,
// as a session fired by a waybill order has them.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { orderRun } from "../../../original/thread-ledger/review/policy.mjs";

export const HERE = path.dirname(fileURLToPath(import.meta.url));
export const DRIVER = path.join(HERE, "../../../original/thread-ledger/review-driver.mjs");

export const PROMPT = "PANDO-REVIEW: spec-fidelity tier=sonnet\n\nReview the pull request named in the trigger.";
// Every kata session is dispatched by this order.
// The Routine's prompt, DISPATCH below, carries no data (skills#195, waybill#1).
// Its id has the name form of pandoscope 0.5.0: an underscore separates the parts,
// a hyphen stands only inside a part (skills#295).
export const ORDER_ID = "review_spec-fidelity_sonnet_meta143_1";
// The name form of the orders placed before pandoscope 0.5.0, which keep working (skills#295).
export const OLD_ORDER_ID = "review-spec-fidelity-sonnet-meta143-1";
export const ORDER =
  `id: ${ORDER_ID}\nrole: reviewer\npass: spec-fidelity\nmodel_tier: sonnet\n` +
  "subject: pandoscope/meta#143\ntickets:\n  - pandoscope/skills#195\n";
export const ORDER_REF = `order/${ORDER_ID}`;
export const DISPATCH = "A waybill order dispatched this autonomous session. Read CLAUDE.md and follow it.";
// The policy katas place the waybill where a session has it.
export const WAYBILL = "/home/user/waybill";
export const RESULT = `${WAYBILL}/results/${ORDER_ID}.json`;
export const ORDER_FILE = `${WAYBILL}/orders/${ORDER_ID}.yml`;
export const PARSED = orderRun(ORDER, ORDER_FILE);
if (!PARSED) throw new Error("the kata order did not parse as a review run");
export const RUN = PARSED;

// ------------------------------------------------------------ staged

/** @param {string} cwd @param {...string} args */
export function sh(cwd, ...args) {
  const r = spawnSync(args[0], args.slice(1), { cwd, encoding: "utf8" });
  assert.equal(r.status, 0, `${args.join(" ")}\n${r.stderr}`);
  return r.stdout.trim();
}

/** @param {string} dir */
export function identity(dir) {
  sh(dir, "git", "config", "user.email", "kata@example.test");
  sh(dir, "git", "config", "user.name", "kata");
  sh(dir, "git", "config", "commit.gpgsign", "false");
}

/**
 * The two origins a review session has: the reviewed repository and the waybill, each seeded on main.
 * @returns {{ root: string, meta: string, waybill: string }}
 */
export function origins() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "review-driver-"));
  const meta = path.join(root, "meta.git");
  const waybill = path.join(root, "waybill.git");
  for (const [remote, file] of [[meta, "README.md"], [waybill, "AGENTS.md"]]) {
    sh(root, "git", "init", "-q", "--bare", "-b", "main", remote);
    const seed = fs.mkdtempSync(path.join(root, "seed-"));
    sh(seed, "git", "init", "-q", "-b", "main");
    identity(seed);
    fs.writeFileSync(path.join(seed, file), "seed\n");
    sh(seed, "git", "add", "-A");
    sh(seed, "git", "commit", "-q", "-m", "chore: seed");
    sh(seed, "git", "remote", "add", "origin", remote);
    sh(seed, "git", "push", "-q", "origin", "main");
  }
  return { root, meta, waybill };
}

/**
 * Places an order as Pando does: orders/<id>.yml on order/<id> of the waybill's origin.
 * @param {ReturnType<typeof origins>} o @param {string} id
 */
export function placeOrder(o, id) {
  const work = fs.mkdtempSync(path.join(o.root, "place-"));
  sh(work, "git", "clone", "-q", o.waybill, ".");
  identity(work);
  sh(work, "git", "switch", "-q", "-c", `order/${id}`);
  fs.mkdirSync(path.join(work, "orders"));
  fs.writeFileSync(path.join(work, "orders", `${id}.yml`), ORDER.replace(`id: ${ORDER_ID}`, `id: ${id}`));
  sh(work, "git", "add", "-A");
  sh(work, "git", "commit", "-q", "-m", `order: ${id}`);
  sh(work, "git", "push", "-q", "origin", `order/${id}`);
}

/**
 * A session fired by order `id`: a clone of each origin under its own root,
 * the waybill's on a branch of the harness's name at the order's head.
 * @param {ReturnType<typeof origins>} o @param {string} id
 */
export function sessionFor(o, id) {
  const root = fs.mkdtempSync(path.join(o.root, "session-"));
  const home = path.join(root, "home");
  const repos = path.join(root, "repos");
  const clone = path.join(repos, "meta");
  const waybill = path.join(repos, "waybill");
  fs.mkdirSync(home, { recursive: true });
  sh(root, "git", "clone", "-q", o.meta, clone);
  sh(root, "git", "clone", "-q", o.waybill, waybill);
  identity(clone);
  identity(waybill);
  sh(waybill, "git", "switch", "-q", "-c", "claude/harness-branch", `origin/order/${id}`);
  const transcript = path.join(root, "transcript.jsonl");
  fs.writeFileSync(
    transcript,
    `${JSON.stringify({ type: "user", message: { role: "user", content: DISPATCH } })}\n` +
      `${JSON.stringify({ type: "assistant", timestamp: "t", message: { role: "assistant", model: "claude-sonnet", usage: { input_tokens: 10, output_tokens: 5 }, content: [{ type: "tool_use", name: "Bash", input: { command: "git diff" } }] } })}\n`,
  );
  fs.appendFileSync(transcript, issueRead("r0", "pandoscope", "skills", 195));
  const order = path.join(waybill, "orders", `${id}.yml`);
  const result = path.join(waybill, "results", `${id}.json`);
  return { origins: o, id, ref: `order/${id}`, root, home, repos, clone, waybill, transcript, order, result };
}

export function stage() {
  const o = origins();
  placeOrder(o, ORDER_ID);
  return sessionFor(o, ORDER_ID);
}

/**
 * @param {ReturnType<typeof stage>} s
 * @param {Record<string, unknown>} input
 * @param {Record<string, string>} [env]
 */
export function fire(s, input, env = {}) {
  const r = spawnSync("node", [DRIVER], {
    input: JSON.stringify({ transcript_path: s.transcript, session_id: "kata", ...input }),
    encoding: "utf8",
    env: { ...process.env, HOME: s.home, CLAUDE_CONFIG_DIR: path.join(s.home, ".claude"), HEARTBEAT_REPO_ROOT: s.repos, CCR_TRIGGER_HEAD_REF: s.ref, ...env },
  });
  return { code: r.status, err: r.stderr ?? "" };
}

/** A valid result for the session's order. @param {ReturnType<typeof stage>} s */
export function resultFor(s) {
  return { order_id: s.id, pr: "pandoscope/meta#143", head: "22056ce0", pass: "spec-fidelity", model_tier: "sonnet", findings: [] };
}

/** @param {ReturnType<typeof stage>} s @param {unknown} doc */
export function writeResult(s, doc) {
  fs.mkdirSync(path.dirname(s.result), { recursive: true });
  fs.writeFileSync(s.result, JSON.stringify(doc));
}

/** Every ref an origin holds, with its commit. @param {string} remote */
export function refs(remote) {
  return sh(path.dirname(remote), "git", "--git-dir", remote, "for-each-ref", "--format=%(refname) %(objectname)");
}

/** The commit an origin's branch points at. @param {string} remote @param {string} branch */
export function tip(remote, branch) {
  return sh(path.dirname(remote), "git", "--git-dir", remote, "rev-parse", `refs/heads/${branch}`);
}

/**
 * One issue read call and its result, as the transcript records them.
 * @param {string} id @param {string} owner @param {string} repo @param {number} n @param {boolean} [error]
 */
export function issueRead(id, owner, repo, n, error = false) {
  return (
    `${JSON.stringify({ type: "assistant", message: { role: "assistant", model: "m", content: [{ type: "tool_use", id, name: "mcp__github__issue_read", input: { method: "get", owner, repo, issue_number: n } }] } })}\n` +
    `${JSON.stringify({ type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: id, is_error: error, content: [{ type: "text", text: "{\"number\":1}" }] }] } })}\n`
  );
}

/**
 * One Bash call and its result, as the transcript records them (skills#297).
 * @param {string} id @param {string} command @param {boolean} [error]
 */
export function bashCall(id, command, error = false) {
  return (
    `${JSON.stringify({ type: "assistant", message: { role: "assistant", model: "m", content: [{ type: "tool_use", id, name: "Bash", input: { command } }] } })}\n` +
    `${JSON.stringify({ type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: id, is_error: error, content: error ? "Exit code 1\ngh: Not Found (HTTP 404)" : "{\"number\":1}" }] } })}\n`
  );
}

/**
 * One ticket read through `gh api` and its result (skills#297).
 * @param {string} id @param {string} owner @param {string} repo @param {number} n @param {boolean} [error]
 */
export function ghRead(id, owner, repo, n, error = false) {
  return bashCall(id, `gh api repos/${owner}/${repo}/issues/${n}`, error);
}
