#!/usr/bin/env node
// The review driver — the hooks that make a routine-fired session a
// review session (skills#195).
//
// Registered for `PreToolUse` and `Stop`. Reads the hook's JSON on
// stdin. When the transcript's first user message carries the
// `PANDO-REVIEW: <pass> tier=<tier>` marker the session is a review
// session; otherwise every event exits 0 untouched, and the ledger
// heartbeat keeps the session.
//
//     PreToolUse   exit 2 + stderr   the call is denied; the reason
//                                    names the rule and the alternative
//     Stop         exit 2 + stderr   the review is not complete; the
//                                    reason names the first unmet
//                                    criterion and the tool or
//                                    command that meets it
//     exit 0                         allowed, or complete
//
// Why two hooks: a Stop hook fires after the turn, so it can refuse
// completion but cannot undo code that ran or a comment that was
// posted. Prohibitions therefore fire BEFORE the call, and the Stop
// hook keeps only the completion criterion. Policy: `review/policy.mjs`.
//
// The driver's denials and a trace of the session's calls and usage
// are the measurement this exists for.
// The driver writes them beside the findings, on the review branch.
//
//     HEARTBEAT_REPO_ROOT   directory holding the session's clones
//     CCR_TRIGGER_HEAD_REF  the order branch, order/<name>; its order
//                           file waybill/orders/<name>.yml names the
//                           tickets the review must read
//     --is-review           exit 0 when the order makes the session a review,
//                           1 otherwise — the sentinel's skip test

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { findingsProblems, orderTickets, prNumber, reviewRun, ticketsRead, toolVerdict } from "./review/policy.mjs";

const MAX_BLOCKS = 3;

/** @typedef {import("./review/policy.mjs").ReviewRun} ReviewRun */
/**
 * What the platform pipes in — the fields this driver reads.
 * @typedef {object} HookInput
 * @property {string} [hook_event_name]
 * @property {string} [tool_name]
 * @property {Record<string, any>} [tool_input]
 * @property {string} [transcript_path]
 * @property {string} [session_id]
 * @property {boolean} [stop_hook_active]
 */
/**
 * @typedef {object} Ctx
 * @property {string | null} repoRoot   directory holding the session's clones
 * @property {string} transcriptText
 * @property {string} logFile           the driver's own observations
 * @property {string} stateFile         the loop guard's memory
 * @property {string} session
 * @property {string | null} orderFile  the waybill order, when one fired the session
 */
/** @typedef {{ check: string, detail: string, reason: string }} Failure */
/** @typedef {{ input: number, output: number, cacheRead: number, cacheCreation: number, messages: number }} Usage */

/** @param {string} name */
function localFile(name) {
  return path.join(process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude"), name);
}

/** @param {string} repo @param {...string} args @returns {string | null} */
function git(repo, ...args) {
  const r = spawnSync("git", ["-C", repo, ...args], { encoding: "utf8" });
  return r.status === 0 ? r.stdout.trim() : null;
}

/** @param {string} file @param {Record<string, unknown>} record */
function appendLog(file, record) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, `${JSON.stringify({ at: new Date().toISOString(), ...record })}\n`);
}

// -------------------------------------------------------------- trace

/**
 * What the session did, from its transcript: calls and usage per model.
 * @param {string} text
 */
export function traceOf(text) {
  /** @type {{ at: string | null, tool: string, arg: string | null }[]} */
  const calls = [];
  /** @type {Record<string, Usage>} */
  const usage = {};
  let turns = 0;
  for (const line of text.split("\n")) {
    let d;
    try {
      d = JSON.parse(line);
    } catch {
      continue;
    }
    const m = d?.message;
    if (!m || typeof m !== "object") continue;
    if (d.type === "user" && typeof m.content === "string") turns += 1;
    if (d.type !== "assistant") continue;
    const model = m.model ?? "unknown";
    const u = m.usage ?? {};
    const slot = (usage[model] ??= { input: 0, output: 0, cacheRead: 0, cacheCreation: 0, messages: 0 });
    slot.messages += 1;
    slot.input += u.input_tokens ?? 0;
    slot.output += u.output_tokens ?? 0;
    slot.cacheRead += u.cache_read_input_tokens ?? 0;
    slot.cacheCreation += u.cache_creation_input_tokens ?? 0;
    for (const b of m.content ?? []) {
      if (b?.type !== "tool_use") continue;
      const arg =
        b.name === "Bash" ? b.input?.command : (b.input?.file_path ?? b.input?.pattern ?? b.input?.url ?? null);
      calls.push({ at: d.timestamp ?? null, tool: b.name, arg: typeof arg === "string" ? arg.slice(0, 400) : null });
    }
  }
  return { turns, calls, usage };
}

// --------------------------------------------------------------- stop

/** @param {string | null} root @returns {string[]} */
function clonesUnder(root) {
  if (!root || !fs.existsSync(root)) return [];
  return fs
    .readdirSync(root, { withFileTypes: true })
    .filter((e) => e.isDirectory() && fs.existsSync(path.join(root, e.name, ".git")))
    .map((e) => path.join(root, e.name));
}

/**
 * The first unmet completion criterion, or null when the review is complete.
 * Each failure carries the check name, the evidence, and the reason with its command.
 * @param {ReviewRun} run
 * @param {Ctx} ctx
 * @returns {Failure | null}
 */
export function stopVerdict(run, ctx) {
  if (ctx.orderFile && fs.existsSync(ctx.orderFile)) {
    const read = ticketsRead(ctx.transcriptText);
    const missing = orderTickets(fs.readFileSync(ctx.orderFile, "utf8")).filter((t) => !read.has(t));
    if (missing.length) {
      return {
        check: "tickets-read",
        detail: `unread: ${missing.join(", ")}`,
        reason: [
          "The review is not complete until every ticket the order names was read: the tickets are the specification.",
          "Read each with the GitHub issue read tool, method get:",
          ...missing.map((t) => `  ${t}`),
        ].join("\n"),
      };
    }
  }
  const clones = clonesUnder(ctx.repoRoot);
  const clone = clones.find((c) => fs.existsSync(path.join(c, run.findings)));
  const where = ctx.repoRoot ? ` under ${ctx.repoRoot}` : "";
  if (!clone) {
    return {
      check: "findings-written",
      detail: `no ${run.findings} in ${clones.length} clone(s)${where}`,
      reason:
        `The review is not complete until ${run.findings} exists in the clone of the reviewed ` +
        `repository${where}: a JSON object with pr (owner/repo#n), head (the reviewed commit sha), ` +
        `pass ("${run.pass}"), tier ("${run.tier}") and findings (an array, empty when nothing was found). ` +
        "Write it with the Write tool.",
    };
  }
  const file = path.join(clone, run.findings);
  let doc;
  try {
    doc = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (err) {
    const why = err instanceof Error ? err.message : String(err);
    return {
      check: "findings-valid",
      detail: `${file}: ${why}`,
      reason: `The review is not complete until ${file} parses as JSON: ${why}. Rewrite it with the Write tool.`,
    };
  }
  const problems = findingsProblems(doc, run);
  if (problems.length) {
    return {
      check: "findings-valid",
      detail: `${file}: ${problems.join("; ")}`,
      reason: [
        `The review is not complete until ${file} follows the contract:`,
        ...problems.map((p) => `  ${p}`),
        "Fix the file with the Edit tool.",
      ].join("\n"),
    };
  }
  const n = prNumber(doc);
  const branch = `claude/review-${run.pass}-${run.tier}-pr${n}`;
  // The driver's observations ride the same branch. Written once, when
  // the findings first validate: rewriting after the commit would dirty
  // the tree again and turn the completion check into a loop.
  const dir = path.join(clone, run.dir);
  // driver.jsonl holds the denials up to this point — written even when there were none,
  // so an empty file says "measured, nothing denied" and a missing one says "never written".
  // The Stop verdicts that follow stay in the local log:
  // copying them would dirty the tree after every commit.
  if (!fs.existsSync(path.join(dir, "trace.json"))) {
    fs.writeFileSync(path.join(dir, "trace.json"), `${JSON.stringify(traceOf(ctx.transcriptText), null, 1)}\n`);
    const denials = fs.existsSync(ctx.logFile)
      ? fs.readFileSync(ctx.logFile, "utf8").split("\n").filter((l) => l.includes('"event":"deny"'))
      : [];
    fs.writeFileSync(path.join(dir, "driver.jsonl"), denials.map((l) => `${l}\n`).join(""));
  }
  const current = git(clone, "rev-parse", "--abbrev-ref", "HEAD");
  if (current !== branch) {
    return {
      check: "review-branch",
      detail: `${path.basename(clone)} on ${current}, expected ${branch}`,
      reason:
        `The review is not complete until the findings sit on the review branch: ` +
        `${path.basename(clone)} is on ${current}.\n\n  git -C ${clone} switch -c ${branch}`,
    };
  }
  const dirty = git(clone, "status", "--porcelain", "--", run.dir);
  if (dirty === null || dirty.length) {
    return {
      check: "findings-committed",
      detail: `${run.dir} has uncommitted changes`,
      reason:
        `The review is not complete until ${run.dir}/ is committed:\n\n` +
        `  git -C ${clone} add ${run.dir} && git -C ${clone} commit -m "chore(review): ${run.pass} ${run.tier} findings for pr${n}"`,
    };
  }
  const head = git(clone, "rev-parse", "HEAD");
  const remote = git(clone, "rev-parse", "--verify", "-q", `refs/remotes/origin/${branch}`);
  if (!head || remote !== head) {
    return {
      check: "findings-pushed",
      detail: `origin/${branch} is ${remote ? remote.slice(0, 7) : "absent"}, HEAD ${head?.slice(0, 7)}`,
      reason: `The review is not complete until the branch is pushed:\n\n  git -C ${clone} push -u origin ${branch}`,
    };
  }
  return null;
}

// ---------------------------------------------------------------- run

/**
 * @param {string} file
 * @returns {Record<string, { blocks: number, delivered: string[] }>}
 */
function readState(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return {};
  }
}

/** @param {HookInput} input @returns {number} */
export function run(input) {
  const transcript = input.transcript_path ?? null;
  const text = transcript && fs.existsSync(transcript) ? fs.readFileSync(transcript, "utf8") : "";
  const review = reviewRun(text);
  if (!review) return 0;
  const repoRoot = process.env.HEARTBEAT_REPO_ROOT || process.env.SESSION_ROOT || null;
  const orderRef = process.env.CCR_TRIGGER_HEAD_REF ?? "";
  const ctx = {
    repoRoot,
    orderFile:
      repoRoot && orderRef.startsWith("order/")
        ? path.join(repoRoot, "waybill", "orders", `${orderRef.slice("order/".length)}.yml`)
        : null,
    transcriptText: text,
    logFile: localFile("review-driver.jsonl"),
    stateFile: localFile("review-driver-state.json"),
    session: input.session_id ?? "unknown",
  };
  const event = input.hook_event_name;
  if (event === "PreToolUse") {
    const verdict = toolVerdict(input.tool_name ?? "(unnamed tool)", input.tool_input ?? {}, review);
    if (verdict.allow) return 0;
    appendLog(ctx.logFile, {
      event: "deny",
      session: ctx.session,
      tool: input.tool_name,
      arg: JSON.stringify(input.tool_input ?? {}).slice(0, 400),
      why: verdict.why,
    });
    process.stderr.write(
      `${verdict.why}\n\nThis is a ${review.pass} review session (tier ${review.tier}): read-only, ` +
        `one findings file, one branch, nothing posted. The denial is logged.\n`,
    );
    return 2;
  }
  if (event !== "Stop") return 0;
  const failed = stopVerdict(review, ctx);
  const state = readState(ctx.stateFile);
  const mine = state[ctx.session] ?? { blocks: 0, delivered: [] };
  if (!failed) {
    appendLog(ctx.logFile, { event: "stop", session: ctx.session, verdict: "complete" });
    process.stderr.write(`Review complete: findings committed and pushed.\n`);
    return 0;
  }
  const guarded = input.stop_hook_active === true;
  const heard = mine.delivered.includes(failed.check);
  if (guarded && (heard || mine.blocks >= MAX_BLOCKS)) {
    appendLog(ctx.logFile, { event: "stop", session: ctx.session, verdict: "released", check: failed.check, detail: failed.detail });
    process.stderr.write(
      `The review is released INCOMPLETE — ${failed.check} is still unmet: ${failed.detail}. Not blocking again.\n`,
    );
    return 0;
  }
  mine.blocks += 1;
  mine.delivered.push(failed.check);
  state[ctx.session] = mine;
  fs.mkdirSync(path.dirname(ctx.stateFile), { recursive: true });
  fs.writeFileSync(ctx.stateFile, JSON.stringify(state, null, 1));
  appendLog(ctx.logFile, { event: "stop", session: ctx.session, verdict: "blocked", check: failed.check, detail: failed.detail });
  process.stderr.write(`${failed.reason}\n`);
  return 2;
}

// ---------------------------------------------------------------- cli

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  /** @type {HookInput} */
  let input = {};
  try {
    const raw = fs.readFileSync(0, "utf8");
    input = raw.trim() ? JSON.parse(raw) : {};
  } catch {
    // Unparsable stdin: treat it as an empty event.
  }
  process.stderr.on("error", (err) => {
    if (err?.code === "EPIPE") process.exit(process.exitCode ?? 0);
    throw err;
  });
  if (process.argv.includes("--is-review")) {
    const transcript = input.transcript_path ?? null;
    const text = transcript && fs.existsSync(transcript) ? fs.readFileSync(transcript, "utf8") : "";
    process.exitCode = reviewRun(text) ? 0 : 1;
  } else {
    try {
      process.exitCode = run(input);
    } catch (err) {
      // A crashed driver must not end a review turn quietly, and must not trap it either:
      // block once, release on the guarded fire.
      if (input.stop_hook_active === true) {
        process.exitCode = 0;
      } else {
        const detail = err instanceof Error ? (err.stack ?? err.message) : String(err);
        process.stderr.write(`The review driver could not check this event:\n\n${detail}\n`);
        process.exitCode = 2;
      }
    }
  }
}
