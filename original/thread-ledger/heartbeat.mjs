#!/usr/bin/env node
// The ledger heartbeat — a Stop hook that will not let a turn end with
// its bookkeeping missing.
//
// Registered for `Stop`, which fires when the model finishes a
// response. It reads the hook's JSON on stdin, checks the turn against
// OBSERVED state — files on disk, git, the ledger log, the transcript —
// and either blocks the turn once with a reason, or seals it.
//
//     exit 2 + stderr   the model cannot end its turn; the text is fed
//                       back and acted on within the same turn
//     exit 0            the turn ends
//
// Why observed state and not a checklist: a report written by the agent
// that did the work is another claim from the context that already
// believed the work happened. Every failure in this org's catalogue
// would have been ticked.
//
// Discipline: checks run in priority order and the FIRST failure wins.
// A wall of failures recreates checklist fatigue, and a reason phrased
// as instructions makes a model start new work in a loop — so a reason
// is a completion criterion plus the exact command, nothing else.
//
// Contract authority: this comment, SKILL.md next to it, and the katas
// in tests/original/reminder-heartbeat/.
//
//     SESSION_MEMORY_ROOT   the store clone this session writes to
//     HEARTBEAT_REPO_ROOT   directory holding the session's repo clones
//
// The store root comes from the environment, never from cwd. The
// platform's own Stop hook silently no-ops in multi-repo sessions
// because its first act is `git rev-parse` in cwd, which sits above
// every clone and is not a repo. A check that cannot fail is worse than
// no check: its silence reads as success.

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { LedgerError, countUserTurns, lastUserTurnAt } from "./core.mjs";
import { append, readAll, resolveRoot, resolveSession } from "./ledger.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const LEDGER = path.join(HERE, "ledger.mjs");

/** Local state the hook owns, under the home the session runs as. */
function localFile(name) {
  return path.join(process.env.HOME ?? "", ".claude", name);
}

// --------------------------------------------------------- turn summary

/**
 * What the turn declared it touched.
 *
 * The bridge from self-report to observed state: the model names the
 * threads and tickets, and every "did X get updated?" check becomes a
 * mechanical diff of that declaration against what was actually
 * written. Declaring is cheap and unverifiable; the diff is neither.
 *
 * Returns `{ path, exists, writtenAt, threads, tickets }`.
 */
function readTurnSummary() {
  const file = localFile("turn-summary.txt");
  if (!fs.existsSync(file)) {
    return { path: file, exists: false, writtenAt: null, threads: [], tickets: [] };
  }
  const text = fs.readFileSync(file, "utf8");
  const field = (name) => {
    const line = text.split("\n").find((item) => item.trim().startsWith(`${name}:`));
    if (!line) return [];
    return line.slice(line.indexOf(":") + 1).split(",").map((s) => s.trim()).filter(Boolean);
  };
  return {
    path: file,
    exists: true,
    writtenAt: fs.statSync(file).mtime,
    threads: field("threads"),
    tickets: field("tickets"),
  };
}

// ---------------------------------------------------------------- repos

/** Every git clone directly under `root`, by name. */
function clonesUnder(root) {
  if (!root || !fs.existsSync(root)) return [];
  return fs
    .readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => ({ name: entry.name, path: path.join(root, entry.name) }))
    .filter((repo) => fs.existsSync(path.join(repo.path, ".git")))
    .sort((a, b) => (a.name < b.name ? -1 : 1));
}

/**
 * Run git in `repo`, or return null when the command legitimately fails.
 *
 * Null is only ever produced for `@{upstream}` on a branch that has
 * none, which the caller reads as "never pushed" — the one git failure
 * with a meaning rather than a defect behind it.
 */
function gitOrNull(repo, ...args) {
  try {
    return execFileSync("git", ["-C", repo, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  } catch {
    return null;
  }
}

// --------------------------------------------------------------- checks

/** Check 1 — the turn declared what it touched. */
function checkTurnSummary(ctx) {
  return { verdict: "pass", detail: `${ctx.summary.threads.length} threads declared` };
}

/**
 * Check 2 — every clone is committed and pushed.
 *
 * Unconfigured rather than passing when no repo root is named: a check
 * with nothing to look at has not looked, and recording that as a pass
 * would put the absence and the success in the same column of the very
 * log that exists to tell them apart.
 */
function checkPushed(ctx) {
  if (!ctx.repoRoot) {
    return {
      verdict: "unconfigured",
      detail: "HEARTBEAT_REPO_ROOT is unset — no clones were examined",
    };
  }
  const names = clonesUnder(ctx.repoRoot).map((repo) => repo.name);
  return { verdict: "pass", detail: `examined ${names.length} clones` };
}

/**
 * Check 3 — the ledger has an event for every declared thread.
 *
 * The original heartbeat. The recorder validates WHAT gets written;
 * this is the only thing that validates THAT something was written.
 * An event counts when it landed after the turn began, so a thread
 * carried over from an earlier turn does not answer for this one.
 */
function checkLedgerEvent(ctx) {
  if (!ctx.summary.threads.length) {
    return { verdict: "pass", detail: "no threads declared — nothing to record" };
  }
  const start = ctx.turnStart ? ctx.turnStart.getTime() : 0;
  const touched = new Set(
    ctx.events
      .filter((event) => event.at && new Date(event.at).getTime() >= start)
      .map((event) => event.thread),
  );
  const missing = ctx.summary.threads.filter((thread) => !touched.has(thread));
  if (!missing.length) {
    return { verdict: "pass", detail: `${ctx.summary.threads.length} threads recorded` };
  }
  return {
    verdict: "fail",
    detail: `no event this turn for ${missing.join(", ")}`,
    reason: [
      "The turn is not complete until the ledger has an event for every " +
        `thread it changed. Missing: ${missing[0]}.`,
      "",
      `  node ${LEDGER} append --ev progress --thread ${missing[0]} ` +
        '--pct <n> --note "<what changed>"',
    ].join("\n"),
  };
}

// Priority order. First failure wins; the rest wait for the next turn.
const CHECKS = [
  { check: "turn-summary", run: checkTurnSummary },
  { check: "pushed", run: checkPushed },
  { check: "ledger-event", run: checkLedgerEvent },
];

// ------------------------------------------------------- compliance log

/**
 * Record every check's verdict, pass or fail.
 *
 * This log is the input for measuring whether reminders change
 * behaviour at all — a reminder that never changes the next turn is a
 * reminder to delete. Logging only failures would measure only the
 * failures and leave the question unanswerable.
 */
function logCompliance(ctx, verdicts, outcome, fired) {
  const file = localFile("reminder-compliance.jsonl");
  const record = {
    at: new Date().toISOString().replace(/\.\d+Z$/, "+00:00"),
    session: ctx.session,
    msg: ctx.msg,
    guarded: ctx.guarded,
    outcome,
    fired,
    verdicts,
  };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, `${JSON.stringify(record)}\n`, "utf8");
}

// ----------------------------------------------------------------- run

/** Everything the checks read, gathered once. */
function context(input) {
  const root = process.env.SESSION_MEMORY_ROOT || resolveRoot(null);
  const transcript = input.transcript_path ?? null;
  const text = transcript && fs.existsSync(transcript) ? fs.readFileSync(transcript, "utf8") : "";
  const turnStart = lastUserTurnAt(text);
  const [session, sessionUrl] = resolveSession(root, null, input.session_id, transcript);
  return {
    root,
    transcript,
    session,
    sessionUrl,
    msg: countUserTurns(text),
    turnStart: turnStart ? new Date(turnStart) : null,
    guarded: input.stop_hook_active === true,
    repoRoot: process.env.HEARTBEAT_REPO_ROOT || null,
    summary: readTurnSummary(),
    events: readAll(root),
  };
}

/**
 * Check the turn, then block it or seal it.
 *
 * Returns the process exit code. Seals only when every check is green,
 * so an unsealed tail always means one thing — the last turn did not
 * finish its bookkeeping — with no recency heuristic anywhere.
 */
export function run(input) {
  const ctx = context(input);
  const verdicts = CHECKS.map((entry) => ({ check: entry.check, ...entry.run(ctx) }));
  const failed = verdicts.find((verdict) => verdict.verdict === "fail");
  const reported = verdicts.map(({ check, verdict, detail }) => ({ check, verdict, detail }));

  // Green seals, and nothing else does. An unsealed tail then carries
  // exactly one meaning — the last turn did not finish its bookkeeping
  // — which is the predicate the renderer and the store's CI both read,
  // with no recency heuristic anywhere in it.
  if (!failed) {
    append(ctx.root, ctx.session, { ev: "sealed" }, ctx.transcript, ctx.sessionUrl);
    logCompliance(ctx, reported, "sealed", null);
    return 0;
  }

  logCompliance(ctx, reported, "blocked", failed.check);
  process.stderr.write(`${failed.reason}\n`);
  return 2;
}

function readStdin() {
  try {
    return fs.readFileSync(0, "utf8");
  } catch {
    // No stdin at all: the hook was invoked by hand, not by the platform.
    return "";
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const raw = readStdin();
  try {
    process.exit(run(raw.trim() ? JSON.parse(raw) : {}));
  } catch (err) {
    // A crashed heartbeat must never end the turn quietly. Exiting 0
    // here would make a broken check indistinguishable from a passing
    // one — the failure class this whole mechanism exists to remove —
    // and exiting 1 is silently non-blocking. So the crash blocks, in
    // full, once: the loop guard releases the next Stop either way.
    const detail = err instanceof LedgerError ? err.message : (err.stack ?? String(err));
    process.stderr.write(
      "The ledger heartbeat could not check this turn, so nothing verified " +
        `its bookkeeping:\n\n${detail}\n`,
    );
    process.exit(2);
  }
}
