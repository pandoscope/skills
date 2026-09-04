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
//     LEDGER_SESSION_URL    this conversation's URL — the log's identity
//     DECISION_MEMORY_URL   the decision store, when the session has one
//     LEDGER_RENDER_PATH    the rendered ledger page this session republishes
//     REINSET_ANSWERS       the session answers file the composer writes
//                           (skills#179 §3) — named before it exists, so
//                           absence is ordinary and reads as nothing
//
// The store root comes from the environment, never from cwd. The
// platform's own Stop hook silently no-ops in multi-repo sessions
// because its first act is `git rev-parse` in cwd, which sits above
// every clone and is not a repo. A check that cannot fail is worse than
// no check: its silence reads as success.

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { LedgerError } from "./core.mjs";
import { digestOf, readLog, stretchOf } from "./diligence.mjs";
import { append, push } from "./ledger.mjs";
import { CHECKS } from "./checks/index.mjs";
import {
  complianceRecord,
  cycleOf,
  deliveredThisTurn,
  flushDiligence,
  logCompliance,
  writeCompliance,
} from "./compliance.mjs";
import { context } from "./context.mjs";
import { preflight } from "./preflight.mjs";
import { localFile } from "./paths.mjs";

// The surface the tests and the ledger CLI import from the entry point,
// re-exported so the split stays an internal boundary.
export { FIXTURE_PATH } from "./checks/stores.mjs";
export { readTurnSummary, resolveSummaryFile } from "./context.mjs";
export { preflight };

// BEFORE the turn is told to push, or the reminder itself publishes it.
// At most this many blocks in one turn. Bounded because several checks
// are not agent-actionable — a network fault under `pushed`, a
// concurrent writer under `artifact-fresh`, a crash — and an unbounded
// loop over those traps the session, which is the fear the crash path
// already names. Bounded also because the checks that accept unverified
// claims (waivers, `nothing-to-persist`) make a false claim the cheapest
// exit from a loop: pressure past this point buys lies, not bookkeeping.
const MAX_BLOCKS = 3;

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
  // What a passing check still has to say — printed when the turn ends
  // without a block, so a surfaced finding reaches the transcript
  // without ever costing a round-trip.
  const notices = verdicts.map((verdict) => verdict.notice).filter(Boolean);

  // Green seals, and nothing else does. An unsealed tail then carries
  // exactly one meaning — the last turn did not finish its bookkeeping
  // — which is the predicate the renderer and the store's CI both read,
  // with no recency heuristic anywhere in it.
  if (!failed) {
    // The digest is computed, never typed: the sealing execution's own
    // record is built first, the stretch window is read off the same
    // log `cycleOf` counts from, and the seal carries the projection.
    // The window is everything since the previous seal in this
    // session's log — not a parameter, so not choosable flatteringly.
    const file = localFile("reminder-compliance.jsonl");
    const record = complianceRecord(file, ctx, reported, "sealed", null);
    const { window, baseline } = stretchOf([...readLog(file), record], ctx.session);
    append(
      ctx.root,
      ctx.session,
      { ev: "sealed", diligence: digestOf(window, baseline) },
      ctx.transcript,
      ctx.sessionUrl,
      // Identity from LEDGER_SESSION_URL is explicit here exactly as
      // --session-url is at the CLI (skills#62): a second conversation
      // the environment named must be able to seal its own log.
      ctx.namedItself,
    );
    flushDiligence(ctx.root, ctx.session, window);
    // The seal protocol's third phase (skills#46): the checks gated the
    // seal — the render among them — and the seal gates this push, so
    // what reaches the remote is a turn whose bookkeeping is complete.
    // The recorder's own push carries the union-merge protection, and
    // this is the only ride the seal line and the flushed diligence
    // records get: the CLI pushes per append, but nothing else pushes
    // what the hook itself wrote. A store that is not a git clone (or a
    // push the network refuses) is left for the next seal's push to
    // sweep — the turn sealed, and blocking it again over transport
    // would double-seal on the re-fire; the SessionStart clone report
    // and the store's CI tail guard are the observers for that gap.
    try {
      push(ctx.root, ctx.session, "sealed");
    } catch {
      // Local seal stands; the next push carries it.
    }
    writeCompliance(file, record);
    if (notices.length) process.stderr.write(`${notices.join("\n")}\n`);
    return 0;
  }

  // The baseline arm. HEARTBEAT_OBSERVE runs every check and logs every
  // verdict without ever surfacing a reason — the arm the Hawthorne
  // question needs, since a hook that always blocks has no run where
  // the reminder was withheld. The one thing it must not do is seal:
  // green seals and nothing else does, in every mode, or the store
  // starts lying about which turns finished. DECISION:SCOPE — observe
  // mode is a measurement arm, not a soft deployment; a deployment that
  // wants no blocking should not install the hook.
  if (process.env.HEARTBEAT_OBSERVE) {
    logCompliance(ctx, reported, "observed", failed.check);
    return 0;
  }

  // The loop guard, read before blocking rather than before checking.
  // `stop_hook_active` is true when this hook already blocked the turn
  // once, and repeating a reason the model just acted on is how a Stop
  // hook traps a session.
  //
  // But a re-fire commonly fails a DIFFERENT check: remediating one
  // reveals the next. Measured over ten turns of one session, eight
  // re-fires fired on a check the block had never named — the model had
  // acted on what it was told and hit a new wall, silently, because the
  // release wrote nothing. That is not the loop the guard protects
  // against, so a reason never yet delivered this turn is worth one more
  // block, up to MAX_BLOCKS.
  //
  // Everything else releases the turn unsealed — the honest record of a
  // turn that did not finish — and says so on stderr. A released turn
  // the model KNOWS is unsealed is a different thing from one it reads
  // as success. Every verdict is still logged either way: this pass is
  // the only place where whether the model complied with the reason it
  // was given can be observed at all.
  if (ctx.guarded) {
    const file = localFile("reminder-compliance.jsonl");
    const delivered = deliveredThisTurn(file, ctx);
    const unheard = delivered.size > 0 && !delivered.has(failed.check);
    if (unheard && cycleOf(file, ctx) <= MAX_BLOCKS) {
      logCompliance(ctx, reported, "blocked", failed.check);
      process.stderr.write(`${failed.reason}\n`);
      return 2;
    }
    logCompliance(ctx, reported, "unsealed", failed.check);
    process.stderr.write(
      `The turn is released UNSEALED — ${failed.check} is still failing: ` +
        `${failed.detail}. Not blocking again; the next turn begins with ` +
        `this outstanding, and the store's tail shows it.\n`,
    );
    return 0;
  }

  logCompliance(ctx, reported, "blocked", failed.check);
  process.stderr.write(`${failed.reason}\n`);
  return 2;
}

// ----------------------------------------------------------------- cli

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
  // Parsed OUTSIDE the try, so the loop guard survives a crash. Reading
  // it inside `run` put it beyond any throw in `context` — a single
  // torn line in a store log then blocked every Stop including the
  // guarded one, which is the trapped session this whole design exists
  // to avoid, reached through its own crash handler.
  let input = {};
  try {
    input = raw.trim() ? JSON.parse(raw) : {};
  } catch {
    // Unparsable stdin is itself a crash, handled below with no guard
    // available — one block, and the platform's next Stop carries
    // readable JSON or the same fault repeats visibly.
  }

  // `exitCode` rather than `exit()` throughout, for the reason in
  // ledger.mjs's wrapper: stderr is asynchronous on a pipe, and the
  // block reason IS the mechanism here — a reason cut off mid-sentence
  // would be a reminder the model cannot act on.
  // A reader that closes early is the end of reading, not a fault —
  // same rule as ledger.mjs, on the channel this hook writes to.
  process.stderr.on("error", (err) => {
    if (err?.code === "EPIPE") process.exit(process.exitCode ?? 0);
    throw err;
  });
  // Preflight is a tool call, not a Stop: a crash reports and exits 1
  // — it must never block a turn it was asked to advise on.
  if (process.argv.includes("--preflight")) {
    const argAfter = (flag) => {
      const at = process.argv.indexOf(flag);
      return at > -1 ? process.argv[at + 1] : null;
    };
    try {
      process.exitCode = preflight(input, {
        draft: argAfter("--draft"),
        fix: process.argv.includes("--fix"),
      });
    } catch (err) {
      const detail = err instanceof LedgerError ? err.message : (err.stack ?? String(err));
      process.stderr.write(`preflight could not check the draft:\n${detail}\n`);
      process.exitCode = 1;
    }
  } else {
    try {
      process.exitCode = run(input);
    } catch (err) {
      const detail = err instanceof LedgerError ? err.message : (err.stack ?? String(err));
      // The crash reaches the compliance log with no verdicts, because
      // none were reached. An empty verdict list is the honest shape of
      // "nothing was checked" — and a crash that logged nothing would be
      // invisible to the one record built to observe this mechanism.
      try {
        logCompliance(
          {
            session: null,
            msg: null,
            usage: { model: null, input: 0, output: 0, cacheRead: 0, cacheCreation: 0 },
            guarded: input.stop_hook_active === true,
          },
          [],
          "crashed",
          "heartbeat-crashed",
        );
      } catch {
        // The log lives under HOME; if that is unwritable too, the stderr
        // below is the only channel left and it still gets used.
      }
      // A crashed heartbeat must never end the turn quietly: exiting 0
      // would make a broken check indistinguishable from a passing one,
      // and exit 1 is silently non-blocking. But it blocks ONCE — the
      // guard applies to a crash exactly as it applies to a reason,
      // because a fault the model cannot fix must not trap the session.
      // On the guarded fire the reason is withheld like any other: it was
      // already delivered in full, and stderr at exit 0 reaches only the
      // diagnostics log anyway.
      if (input.stop_hook_active === true) {
        process.exitCode = 0;
      } else {
        process.stderr.write(
          "The ledger heartbeat could not check this turn, so nothing verified " +
            `its bookkeeping:\n\n${detail}\n`,
        );
        process.exitCode = 2;
      }
    }
  }
}
