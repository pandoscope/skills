#!/usr/bin/env node
// The review driver — the hooks that make a waybill-fired session a review session (skills#195).
//
// Registered for `PreToolUse` and `Stop`.
// Reads the hook's JSON on stdin.
// When the waybill order that fired the session names `role: reviewer` with its pass and model tier,
// the session is a review session.
// Otherwise every event exits 0 untouched, and the ledger heartbeat keeps the session.
//
//     PreToolUse   exit 2 + stderr   the call is denied; the reason
//                                    names the rule and the alternative
//     Stop         exit 2 + stderr   the review is not complete; the
//                                    reason names the first unmet
//                                    criterion and the tool or
//                                    command that meets it
//     exit 0                         allowed, or complete
//
// Why two hooks: a Stop hook fires after the turn,
// so it can refuse completion but cannot undo code that ran or a comment that was posted.
// Prohibitions therefore fire before the call,
// and the Stop hook keeps only the completion criterion.
// Policy: `review/policy.mjs`.
//
// The driver's denials and a trace of the session's calls and usage are the measurement this exists for.
// They stay in the session, under the config directory:
// the waybill takes no session transcript, so neither is pushed (skills#292).
//
// The session's one output is the result file results/<id>.json in the clone of the waybill,
// beside the order file orders/<id>.yml.
// At Stop the driver commits that one file and pushes it on the order's branch order/<id>.
// It creates no branch and no commit in the reviewed repository (skills#292).
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

import { findingsProblems, orderRun, orderTickets, ticketsRead, toolVerdict } from "./review/policy.mjs";

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
 * @property {string} transcriptText
 * @property {string} logFile           the driver's own observations
 * @property {string} traceFile         the session's calls and usage
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

/**
 * Runs git in `repo`.
 * @param {string} repo @param {...string} args
 * @returns {{ ok: boolean, out: string, err: string }} the exit, stdout trimmed, and stderr trimmed
 *   (or the spawn error's message when git could not start)
 */
function git(repo, ...args) {
  const r = spawnSync("git", ["-C", repo, ...args], { encoding: "utf8" });
  const err = (r.stderr ?? "").trim() || (r.error ? r.error.message : "");
  return { ok: r.status === 0, out: (r.stdout ?? "").trim(), err };
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

/**
 * The first unmet completion criterion, or null when the review is complete.
 * Each failure carries the check name, the evidence, and the reason with its command.
 * Once the result validates, the driver writes the trace into the session and publishes the result.
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
  const file = run.result;
  if (!fs.existsSync(file)) {
    return {
      check: "result-written",
      detail: `no ${file}`,
      reason:
        `The review is not complete until the result file ${file} exists in the clone of the waybill: ` +
        `a JSON object with order_id ("${run.orderId}"), pr (owner/repo#n), head (the reviewed commit sha), ` +
        `pass ("${run.pass}"), model_tier ("${run.modelTier}") and findings (an array, empty when nothing was found). ` +
        "Write it with the Write tool.",
    };
  }
  let doc;
  try {
    doc = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (err) {
    const why = err instanceof Error ? err.message : String(err);
    return {
      check: "result-valid",
      detail: `${file}: ${why}`,
      reason: `The review is not complete until ${file} parses as JSON: ${why}. Rewrite it with the Write tool.`,
    };
  }
  const problems = findingsProblems(doc, run);
  if (problems.length) {
    return {
      check: "result-valid",
      detail: `${file}: ${problems.join("; ")}`,
      reason: [
        `The review is not complete until ${file} follows the contract:`,
        ...problems.map((p) => `  ${p}`),
        "Fix the file with the Edit tool.",
      ].join("\n"),
    };
  }
  fs.mkdirSync(path.dirname(ctx.traceFile), { recursive: true });
  fs.writeFileSync(ctx.traceFile, `${JSON.stringify(traceOf(ctx.transcriptText), null, 1)}\n`);
  return publish(run);
}

/**
 * Commits the result file alone in the clone of the waybill and pushes it on the order's branch.
 * The driver publishes, not the reviewer (skills#224): the policy denies the session every git write.
 * Commits only when the file differs from HEAD, so a retried Stop adds no second commit.
 * @param {ReviewRun} run
 * @returns {Failure | null} null once origin's order branch is the clone's HEAD;
 *   `result-committed` when git cannot stage or commit the file,
 *   `result-pushed` when the push did not land — each with git's own message
 */
function publish(run) {
  // DECISION:SCOPE — the driver makes the commit of the result, not the worker.
  // #278 leaves that open (decision 93); #292 says the driver commits the file,
  // and the policy denies the session every git write.
  const rel = path.relative(run.waybill, run.result);
  const where = `the waybill (${run.waybill})`;
  const status = git(run.waybill, "status", "--porcelain", "--", rel);
  if (!status.ok) {
    return {
      check: "result-committed",
      detail: `git status in ${run.waybill}: ${status.err}`,
      reason: `The review is not complete: the driver could not read the state of ${rel} in ${where}: ${status.err}. Stop again to retry.`,
    };
  }
  if (status.out.length) {
    const add = git(run.waybill, "add", "--", rel);
    const commit = add.ok ? git(run.waybill, "commit", "-q", "--no-verify", "-m", `result: ${run.orderId}`, "--", rel) : add;
    if (!commit.ok) {
      return {
        check: "result-committed",
        detail: `commit of ${rel} in ${run.waybill}: ${commit.err}`,
        reason: `The review is not complete: the driver could not commit ${rel} in ${where}: ${commit.err}. Stop again to retry.`,
      };
    }
  }
  const head = git(run.waybill, "rev-parse", "HEAD").out;
  const ref = `refs/heads/${run.orderBranch}`;
  const landed = () => git(run.waybill, "ls-remote", "origin", ref).out.split(/\s+/)[0] === head;
  if (landed()) return null;
  const push = git(run.waybill, "push", "-q", "origin", `HEAD:${ref}`);
  if (push.ok && landed()) return null;
  const why = push.err || `origin's ${run.orderBranch} is not ${head.slice(0, 7)} after the push`;
  return {
    check: "result-pushed",
    detail: `push of ${head.slice(0, 7)} to ${run.orderBranch} of ${run.waybill}: ${why}`,
    reason:
      `The review is not complete: the driver's push of ${rel} to ${run.orderBranch} of ${where} did not land: ${why}. ` +
      "Stop again to retry; the principal is told if it persists.",
  };
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

/**
 * The session's review run and where it came from (SKILL.md, "Review sessions").
 * @param {HookInput} input
 */
function session(input) {
  const transcript = input.transcript_path ?? null;
  const text = transcript && fs.existsSync(transcript) ? fs.readFileSync(transcript, "utf8") : "";
  const repoRoot = process.env.HEARTBEAT_REPO_ROOT || process.env.SESSION_ROOT || null;
  const orderRef = process.env.CCR_TRIGGER_HEAD_REF ?? "";
  const orderFile =
    repoRoot && orderRef.startsWith("order/")
      ? path.join(repoRoot, "waybill", "orders", `${orderRef.slice("order/".length)}.yml`)
      : null;
  const order = orderFile && fs.existsSync(orderFile) ? orderRun(fs.readFileSync(orderFile, "utf8"), orderFile) : null;
  return { text, orderFile, review: order };
}

/** @param {HookInput} input @returns {number} */
export function run(input) {
  const { text, orderFile, review } = session(input);
  if (!review) return 0;
  const ctx = {
    orderFile,
    transcriptText: text,
    logFile: localFile("review-driver.jsonl"),
    traceFile: localFile("review-trace.json"),
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
      `${verdict.why}\n\nThis is a ${review.pass} review session (model tier ${review.modelTier}): read-only, ` +
        `one result file, nothing posted. The denial is logged.\n`,
    );
    return 2;
  }
  if (event !== "Stop") return 0;
  const failed = stopVerdict(review, ctx);
  const state = readState(ctx.stateFile);
  const mine = state[ctx.session] ?? { blocks: 0, delivered: [] };
  if (!failed) {
    appendLog(ctx.logFile, { event: "stop", session: ctx.session, verdict: "complete" });
    process.stderr.write(`Review complete: the result is pushed on ${review.orderBranch} of the waybill.\n`);
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
    process.exitCode = session(input).review ? 0 : 1;
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
