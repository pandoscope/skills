// The compliance log — every verdict this hook reaches, pass or fail.
//
// The log is the hook's own evidence: it is what the turn boundary is
// recovered from on a re-fire, what counts the cycles a block has cost,
// and what the diligence digest is a projection of. Header contract:
// `heartbeat.mjs`.

import fs from "node:fs";
import path from "node:path";

import { localFile } from "./paths.mjs";

/** Every compliance record for `session`, oldest first. */
function recordsFor(file, session) {
  if (!fs.existsSync(file)) return [];
  const records = [];
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      const record = JSON.parse(line);
      if (record.session === session) records.push(record);
    } catch {
      // A torn line is not a cycle. Counting one would be worse than
      // missing it: the cost of a real cycle would land on the wrong
      // turn, where nothing could ever contradict it.
    }
  }
  return records;
}

/**
 * Where this turn began — stable across the hook's own re-fires.
 *
 * Every check measures "this turn" from here, so a boundary that moves
 * mid-turn silently rewrites all thirteen of them. It does move. The
 * block feedback this hook writes is delivered to the model as a user
 * turn carrying its own timestamp, so on the guarded fire both
 * `countUserTurns` and `lastUserTurnAt` advance past it, and work the
 * model did BEFORE it was blocked falls outside its own turn.
 *
 * Measured: `ledger-event` passed on a turn's first Stop ("1 threads
 * recorded") and failed twelve seconds later on the re-fire ("no event
 * this turn"), same store, same append — the append simply preceded the
 * feedback that moved the boundary.
 *
 * So the UNGUARDED fire defines the turn: it is the first Stop after the
 * principal spoke. A guarded fire inherits that boundary from the record
 * the opening fire wrote rather than recomputing it from a transcript
 * this hook has since added to.
 */
export function turnBoundary(file, guarded, session, computed) {
  if (!guarded) return computed;
  const prior = recordsFor(file, session);
  const last = prior[prior.length - 1];
  return last?.turnKey ?? computed;
}

/**
 * Which Stop of this turn this is, counted from the log itself.
 *
 * `stop_hook_active` only says "at least one block already happened",
 * so it cannot tell a second cycle from a fifth. The log can, and it is
 * the same file the answer has to be written to. Counted by `turnKey`
 * rather than `msg`: `msg` advances on the re-fire (the feedback is a
 * user turn), so a same-turn record never matched and the counter was
 * pinned at 1 forever — measured across 24 records of one session.
 */
export function cycleOf(file, ctx) {
  // Preflight rounds share the turn's key but are not Stops: counting
  // them would spend the block budget on lint runs the model asked for
  // and shift cycle 1 — the unprompted baseline — off the first Stop.
  return recordsFor(file, ctx.session)
    .filter((record) => record.turnKey === ctx.turnKey && record.outcome !== "preflight")
    .length + 1;
}

/** Checks already delivered as a block reason this turn. */
export function deliveredThisTurn(file, ctx) {
  return new Set(
    recordsFor(file, ctx.session)
      .filter((record) => record.turnKey === ctx.turnKey && record.outcome === "blocked")
      .map((record) => record.fired)
      .filter(Boolean),
  );
}

/**
 * Record every check's verdict, pass or fail.
 *
 * This log is the input for measuring whether reminders change
 * behaviour at all — a reminder that never changes the next turn is a
 * reminder to delete. Logging only failures would measure only the
 * failures and leave the question unanswerable.
 */
export function logCompliance(ctx, verdicts, outcome, fired) {
  const file = localFile("reminder-compliance.jsonl");
  writeCompliance(file, complianceRecord(file, ctx, verdicts, outcome, fired));
}

/** The record `logCompliance` would write, built without writing it. */
export function complianceRecord(file, ctx, verdicts, outcome, fired) {
  return {
    at: new Date().toISOString().replace(/\.\d+Z$/, "+00:00"),
    session: ctx.session,
    msg: ctx.msg,
    // The turn's identity, written so the next fire of the same turn can
    // inherit it instead of recomputing a boundary this hook has moved.
    turnKey: ctx.turnKey,
    // Which Stop of this turn. Cycle 1 is the model's unprompted
    // attempt — it has not been reminded yet — so cycle-1 verdicts are
    // the no-reminder baseline, measured without a second arm to run.
    // Everything above 1 exists only because this hook blocked, and is
    // the reminder's cost in round-trips.
    cycle: cycleOf(file, ctx),
    model: ctx.usage.model,
    tokens: {
      input: ctx.usage.input,
      output: ctx.usage.output,
      cacheRead: ctx.usage.cacheRead,
      cacheCreation: ctx.usage.cacheCreation,
    },
    guarded: ctx.guarded,
    outcome,
    fired,
    verdicts,
  };
}

export function writeCompliance(file, record) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, `${JSON.stringify(record)}\n`, "utf8");
}

/**
 * Append the stretch's raw records to the store.
 *
 * Raw flushes, digest summarises (skills#69): the digest on the seal is
 * a projection of these records, and a projection of retained data —
 * per-check, per-cycle, per-model detail stays recoverable after the
 * container and its compliance log are reclaimed. Each record belongs
 * to exactly one stretch, so flushing per seal writes each line once.
 */
export function flushDiligence(root, session, window) {
  const dir = path.join(root, "diligence");
  fs.mkdirSync(dir, { recursive: true });
  fs.appendFileSync(
    path.join(dir, `${session}.jsonl`),
    window.map((record) => JSON.stringify(record)).join("\n") + "\n",
    "utf8",
  );
}
