#!/usr/bin/env node
// Diligence and friction — what the heartbeat costs and what it buys.
//
// Reads `~/.claude/reminder-compliance.jsonl` and answers three
// questions the hook records enough state to settle:
//
//   per turn    which checks passed, which failed, how many extra
//               round-trips it took to clear them, what that cost
//   per model   how often each check passes UNPROMPTED
//   per check   what it costs to satisfy, against whether it clears
//
// The counterfactual is free and needs no second arm. At cycle 1 the
// model has not been reminded this turn, so cycle-1 verdicts are what
// it does unprompted; every later cycle is the cost of correcting it.
//
// A pure function over the log, deliberately. The stamping in the hook
// is dumb and cumulative so that changing this file's mind about a
// metric does not invalidate a corpus already recorded.
//
//     node diligence.mjs [--log <path>] [--json]

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import {
  digestOf,
  disputed,
  perCheck,
  perModel,
  stretchOf,
  turnsOf,
  validDisputes,
} from "./core.mjs";

// The pure record analysis (turnsOf, perCheck, the stretch digest)
// lives in core.mjs so the rendered page can project digests in the
// browser; this module re-exports it so its callers keep one import.
export { digestOf, disputed, perCheck, perModel, stretchOf, turnsOf, validDisputes };

/** Records in the compliance log, oldest first. */
export function readLog(file) {
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, "utf8")
    .split("\n")
    .filter((line) => line.trim())
    .flatMap((line) => {
      try {
        return [JSON.parse(line)];
      } catch {
        // A torn line is dropped rather than thrown on. This report is
        // read when something is already suspected; falling over on one
        // bad line would deny the whole history over a partial write.
        return [];
      }
    });
}

/**
 * Disputes from the store's `diligence/disputes.jsonl`, validated.
 *
 * Kept beside the corpus, not in it: a dispute corrects the ACCOUNTING
 * for a filed check defect (skills#66), while the records themselves
 * stay immutable. Invalid lines are dropped and counted, so a typo
 * cannot silently erase real verdicts.
 */
export function readDisputes(file) {
  return validDisputes(readLog(file));
}

function pct(part, whole) {
  return whole ? `${Math.round((part / whole) * 100)}%` : "—";
}

/** The whole report as text. */
export function report(records, disputes = []) {
  const turns = turnsOf(records);
  if (!turns.length) return "No compliance records yet — nothing to measure.\n";
  const lines = [];

  lines.push("Per turn");
  lines.push("  turn  cycles  outcome   fired                 output tokens");
  for (const turn of turns.slice(-20)) {
    const cost = turn.cost === null ? "unknown" : String(turn.cost.output);
    lines.push(
      `  ${String(turn.msg).padStart(4)}  ${String(turn.cycles).padStart(6)}  ` +
        `${(turn.outcome ?? "").padEnd(9)} ${(turn.fired.join(",") || "—").padEnd(21)} ${cost}`,
    );
  }

  lines.push("");
  lines.push("Per check");
  lines.push(
    "  check            unprompted fail   unconfigured   fired   cleared   ignored   disputed",
  );
  for (const row of perCheck(records, turns, disputes)) {
    lines.push(
      `  ${row.check.padEnd(16)} ${pct(row.unpromptedFail, row.turns).padStart(15)}   ` +
        `${pct(row.unconfigured, row.turns).padStart(12)}   ${String(row.fired).padStart(5)}   ` +
        `${pct(row.cleared, row.fired).padStart(7)}   ${String(row.ignored).padStart(7)}   ` +
        `${String(row.disputed).padStart(8)}`,
    );
  }

  if (disputes.length) {
    lines.push("");
    lines.push("Disputes applied — filed check defects, not model conduct");
    for (const item of disputes) {
      lines.push(
        `  ${item.check.padEnd(16)} ${item.ticket.padEnd(24)} ` +
          `${item.from} → ${item.until ?? "open"}`,
      );
    }
  }

  lines.push("");
  lines.push("Per model — cycle 1 only, the unprompted baseline");
  lines.push("  model                  turns   clean first try   extra cycles   output tokens");
  for (const row of perModel(turns)) {
    lines.push(
      `  ${row.model.padEnd(22)} ${String(row.turns).padStart(5)}   ` +
        `${pct(row.clean, row.turns).padStart(14)}   ${String(row.extra).padStart(12)}   ` +
        `${String(row.output).padStart(13)}`,
    );
  }

  // Printed with the numbers, not filed in a ticket nobody reads beside
  // them. A measurement whose limits live somewhere else gets quoted
  // without them.
  lines.push("");
  lines.push("What these numbers cannot see");
  lines.push("  - Cost is attributed by time, not intent: tokens between two Stops");
  lines.push("    include whatever else the turn did. Treat it as an upper bound.");
  lines.push("  - 'Cleared' means the check passed next cycle — compliance, not value.");
  lines.push("  - A turn with one cycle has no second stamp, so its cost is unknown,");
  lines.push("    never zero — and a counter reset by compaction is unknown too.");
  lines.push("  - Cycle 1 is unprompted THIS TURN, not unmonitored: the model has been");
  lines.push("    blocked on earlier turns and knows the hook exists. The clean baseline");
  lines.push("    needs sessions run under HEARTBEAT_OBSERVE, where nothing is surfaced.");
  lines.push("  - A disputed count is a failure inside a filed check-defect window,");
  lines.push("    excluded from both sides of the rates. It may still contain real");
  lines.push("    non-compliance the defect happened to overlap; the tickets above say");
  lines.push("    what the defect was, and the raw records keep every verdict.");
  return `${lines.join("\n")}\n`;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const argv = process.argv.slice(2);
  const at = argv.indexOf("--log");
  const file =
    at >= 0 && argv[at + 1]
      ? argv[at + 1]
      : path.join(process.env.HOME ?? "", ".claude", "reminder-compliance.jsonl");
  const records = readLog(file);
  // Disputes live in the store beside the diligence corpus; the
  // heartbeat's own env names the store, so a session that has one
  // gets its accounting corrected without remembering a flag.
  const dat = argv.indexOf("--disputes");
  const disputesFile =
    dat >= 0 && argv[dat + 1]
      ? argv[dat + 1]
      : process.env.SESSION_MEMORY_ROOT
        ? path.join(process.env.SESSION_MEMORY_ROOT, "diligence", "disputes.jsonl")
        : null;
  const { disputes, invalid } =
    disputesFile && fs.existsSync(disputesFile)
      ? readDisputes(disputesFile)
      : { disputes: [], invalid: 0 };
  if (invalid) {
    process.stderr.write(
      `diligence: ${invalid} invalid dispute line${invalid === 1 ? "" : "s"} in ` +
        `${disputesFile} ignored — a dispute needs check, ticket, reason and from.\n`,
    );
  }
  if (argv.includes("--json")) {
    const turns = turnsOf(records);
    process.stdout.write(
      `${JSON.stringify(
        { turns, checks: perCheck(records, turns, disputes), models: perModel(turns), disputes },
        null,
        2,
      )}\n`,
    );
  } else {
    process.stdout.write(report(records, disputes));
  }
}
