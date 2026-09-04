// The store's CI guard — append-only, and every event still valid.
//
// Run over a push range rather than over a working tree: what the guard
// has to establish is that no commit in the range rewrote history the
// store had already published. Header contract: `../ledger.mjs`.

import { LedgerError, validate } from "../core.mjs";
import { git, readAll } from "./io.mjs";

// -------------------------------------------------------------- guard

/**
 * The store guard: judge what a push did to the append-only corpus.
 *
 * Two rules, both from measured incidents (skills#79, skills#78):
 *
 * - No push removes a line from `ledger/*.jsonl` or `diligence/*.jsonl`.
 *   The log is append-only and the raw records are retained data; a
 *   deletion is a deletion however it arose — hand edit, bad rebase,
 *   `checkout --theirs` in a conflict, force push.
 * - Every event ADDED in the range must be legal from the history that
 *   precedes it in the folded order. Two writers' files merge cleanly
 *   in git, so the union can hold a transition nobody validated; this
 *   is where the union is finally judged. Only added lines are judged —
 *   history from before the guard is not this push's fault, and the
 *   deletion rule itself forbids the rewrite that would clean it.
 *
 * @param root the store checkout, at the range's end state
 * @param range a git revision range, e.g. `«before»..«after»`
 * @returns {{ok: boolean, report: string}} — `report` names every
 *   violation, or summarises what was checked
 * @throws LedgerError when git cannot resolve the range
 */
export function guardRange(root, range) {
  const diff = git(
    root,
    "diff",
    "--unified=0",
    range,
    "--",
    "ledger/*.jsonl",
    "diligence/*.jsonl",
  );
  const removed = [];
  const added = [];
  let file = null;
  for (const line of diff.split("\n")) {
    if (line.startsWith("--- a/")) {
      file = line.slice(6);
      continue;
    }
    if (line.startsWith("+++ b/")) {
      if (line !== "+++ /dev/null") file = line.slice(6);
      continue;
    }
    if (line.startsWith("---") || line.startsWith("+++")) continue;
    if (line.startsWith("-") && line.slice(1).trim()) {
      removed.push({ file, text: line.slice(1) });
    } else if (line.startsWith("+") && line.slice(1).trim()) {
      added.push({ file, text: line.slice(1) });
    }
  }

  const violations = removed.map(
    (item) => `removed from ${item.file}: ${item.text.slice(0, 120)}`,
  );

  // Judge each added event against the history preceding it in the
  // folded order of the checkout — the same order every reader uses.
  const events = readAll(root);
  const lines = events.map((event) => JSON.stringify(event));
  const consumed = new Set();
  for (const item of added) {
    if (!item.file.startsWith("ledger/")) continue;
    let event;
    try {
      event = JSON.parse(item.text);
    } catch {
      violations.push(`unparsable line added to ${item.file}: ${item.text.slice(0, 120)}`);
      continue;
    }
    if (!event?.ev) continue;
    let at = -1;
    for (let index = 0; index < lines.length; index += 1) {
      if (!consumed.has(index) && lines[index] === item.text.trim()) {
        at = index;
        break;
      }
    }
    if (at < 0) continue; // Rewritten again later in the range; the final state carries it or the removal rule already fired.
    consumed.add(at);
    try {
      validate(event, events.slice(0, at));
    } catch (err) {
      if (!(err instanceof LedgerError)) throw err;
      violations.push(`illegal event added to ${item.file}: ${err.message}`);
    }
  }

  if (violations.length) {
    return { ok: false, report: violations.join("\n") + "\n" };
  }
  return {
    ok: true,
    report: `guard: clean — ${added.length} added, 0 removed across ${range}\n`,
  };
}
