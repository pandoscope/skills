// What the compliance log measures — turns, costs, checks, stretches.
//
// The digest on a seal is a projection of these, computed from the
// records rather than typed, so a flattering summary would have to be a
// flattering log first. Pure and browser-safe.

import { counter, stamp } from "./schema.mjs";
import { validateDiligence } from "./validate.mjs";

// ------------------------------------------------- compliance records
// Pure analysis of the heartbeat's per-Stop records. It lives here,
// beside the event schema, so the rendered page can run the SAME
// projection in the browser that the hook runs at seal time.

/**
 * Group records into turns.
 *
 * A turn is one message from the principal, identified by session and
 * `msg` together — `msg` alone collides across conversations sharing a
 * log directory.
 */
export function turnsOf(records) {
  const byTurn = new Map();
  for (const record of records) {
    const key = `${record.session}\u0000${record.msg}`;
    if (!byTurn.has(key)) byTurn.set(key, []);
    byTurn.get(key).push(record);
  }
  return [...byTurn.values()].map((cycles) => {
    const ordered = [...cycles].sort((a, b) => (a.cycle ?? 1) - (b.cycle ?? 1));
    const first = ordered[0];
    const last = ordered[ordered.length - 1];
    return {
      session: first.session,
      msg: first.msg,
      at: first.at ?? null,
      model: last.model ?? first.model ?? null,
      cycles: ordered.length,
      // The reminder's price in round-trips. Cycles above the first
      // exist only because this hook blocked.
      extra: ordered.length - 1,
      // Attributable by TIME, not by intent: whatever else the model
      // did between the two Stops is counted here too. An upper bound,
      // and reported as one.
      cost: costBetween(first, last),
      unprompted: verdictMap(first),
      final: verdictMap(last),
      fired: ordered.map((cycle) => cycle.fired).filter(Boolean),
      outcome: last.outcome,
    };
  });
}


/** Tokens generated between two stamps of the same turn. */
function costBetween(first, last) {
  const zero = { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 };
  if (first === last) return null; // No second stamp: nothing to difference.
  const a = first.tokens ?? zero;
  const b = last.tokens ?? zero;
  const cost = {
    input: (b.input ?? 0) - (a.input ?? 0),
    output: (b.output ?? 0) - (a.output ?? 0),
    cacheRead: (b.cacheRead ?? 0) - (a.cacheRead ?? 0),
    cacheCreation: (b.cacheCreation ?? 0) - (a.cacheCreation ?? 0),
  };
  // Compaction rewrites the transcript, so the cumulative counters can
  // move backwards between two stamps of one turn. That is a reset
  // observed mid-turn, not a discount — reporting it as data would
  // quietly subtract from every aggregate it lands in.
  if (Object.values(cost).some((value) => value < 0)) return null;
  return cost;
}


function verdictMap(record) {
  const map = {};
  for (const verdict of record.verdicts ?? []) map[verdict.check] = verdict.verdict;
  return map;
}


/**
 * Per check: how often it fails unprompted, and whether firing helps.
 *
 * `cleared` is the benefit side and it is a PROXY — it says the check
 * passed on the next cycle, which is compliance, not value. Whether the
 * event that got written was worth writing is not observable here and
 * is not claimed.
 *
 * `unconfigured` counts separately from both. A check that never looked
 * at anything must not dilute a pass rate; that is the whole reason the
 * hook records the third value.
 */
export function perCheck(records, turns, disputes = []) {
  const checks = new Map();
  const of = (name) => {
    if (!checks.has(name)) {
      checks.set(name, {
        check: name,
        turns: 0,
        unpromptedFail: 0,
        // A shadowed check's would-be failure (skills#192): what the
        // check would have refused had it been armed, billed to no one.
        shadow: 0,
        unconfigured: 0,
        fired: 0,
        cleared: 0,
        ignored: 0,
        disputed: 0,
      });
    }
    return checks.get(name);
  };
  for (const turn of turns) {
    for (const [name, verdict] of Object.entries(turn.unprompted)) {
      const row = of(name);
      // A failure inside a disputed window may be the CHECK's defect
      // rather than the model's conduct, so it is counted apart and
      // billed to neither side — including its turn, so the rate's
      // denominator is not quietly diluted. Passes stay: the disputed
      // classes are false POSITIVES, and a defective check's pass says
      // nothing was flagged, wrongly or otherwise.
      if (verdict === "fail" && disputed(name, turn.at, disputes)) {
        row.disputed += 1;
        continue;
      }
      row.turns += 1;
      if (verdict === "fail") row.unpromptedFail += 1;
      if (verdict === "shadow") row.shadow += 1;
      if (verdict === "unconfigured") row.unconfigured += 1;
    }
  }
  // Clearing is measured cycle to cycle within a turn, not turn to
  // turn: a check that fails again on the next TURN failed about
  // different work.
  const byTurn = new Map();
  for (const record of records) {
    const key = `${record.session}\u0000${record.msg}`;
    if (!byTurn.has(key)) byTurn.set(key, []);
    byTurn.get(key).push(record);
  }
  for (const cycles of byTurn.values()) {
    const ordered = [...cycles].sort((a, b) => (a.cycle ?? 1) - (b.cycle ?? 1));
    for (let index = 0; index < ordered.length; index += 1) {
      const fired = ordered[index].fired;
      if (!fired) continue;
      const row = of(fired);
      if (disputed(fired, ordered[index].at, disputes)) {
        row.disputed += 1;
        continue;
      }
      row.fired += 1;
      // The complement of cleared is split, because it mixes two very
      // different things. IGNORED means the reminder was delivered and
      // the same check still failed at the next Stop — the model
      // passing over known work, which is the propensity signal this
      // measure exists for. No next stamp at all means the turn simply
      // ended; nothing was ignored, and counting it as such would
      // manufacture negligence out of an interruption.
      const next = ordered[index + 1];
      if (!next) continue;
      if (verdictMap(next)[fired] === "pass") row.cleared += 1;
      else if (verdictMap(next)[fired] === "fail") row.ignored += 1;
    }
  }
  return [...checks.values()].sort((a, b) => b.fired - a.fired || (a.check < b.check ? -1 : 1));
}


// ------------------------------------------------------------ disputes

/**
 * A dispute names a window in which one CHECK's verdicts are known
 * defective — a filed false-positive class — so the diligence measure
 * stops billing them to the model (skills#66). Written at diagnosis
 * time into the store (`diligence/disputes.jsonl`), BESIDE the corpus
 * it corrects, never into it: compliance records are immutable, and a
 * flag the recorder could reach would be a flag worth reaching for.
 *
 * A dispute requires the ticket that names the defect. A dispute
 * without a filed cause is a self-serving eraser, and validation
 * rejects it.
 */
export function validDisputes(items) {
  const disputes = [];
  let invalid = 0;
  const stamp = (value) => typeof value === "string" && !Number.isNaN(Date.parse(value));
  for (const item of items) {
    const ok =
      item &&
      typeof item.check === "string" &&
      item.check &&
      typeof item.ticket === "string" &&
      /#\d+$/.test(item.ticket) &&
      typeof item.reason === "string" &&
      item.reason &&
      stamp(item.from) &&
      (item.until === null || stamp(item.until));
    if (ok) disputes.push(item);
    else invalid += 1;
  }
  return { disputes, invalid };
}


/** Whether a verdict of `check` stamped `at` falls in a disputed window. */
export function disputed(check, at, disputes) {
  if (!at || !disputes.length) return false;
  const when = Date.parse(at);
  if (Number.isNaN(when)) return false;
  return disputes.some(
    (item) =>
      item.check === check &&
      when >= Date.parse(item.from) &&
      (item.until === null || when <= Date.parse(item.until)),
  );
}


/** Per model: unprompted pass rate, and what correcting it cost. */
export function perModel(turns) {
  const models = new Map();
  for (const turn of turns) {
    const name = turn.model ?? "(unrecorded)";
    if (!models.has(name)) {
      models.set(name, { model: name, turns: 0, clean: 0, extra: 0, output: 0 });
    }
    const row = models.get(name);
    row.turns += 1;
    // Clean = nothing failed before being told. The unprompted
    // diligence number, and the one a model is actually compared on.
    if (!Object.values(turn.unprompted).includes("fail")) row.clean += 1;
    row.extra += turn.extra;
    row.output += turn.cost?.output ?? 0;
  }
  return [...models.values()].sort((a, b) => b.turns - a.turns);
}


// ------------------------------------------------------------ stretches

/**
 * The stretch of a session's log that ends at its final record.
 *
 * A stretch is everything since the previous seal in the SAME session's
 * records — the window skills#69 fixes as non-selectable, because a
 * window the model could choose is a window it could choose
 * flatteringly. The caller guarantees the final record is the sealing
 * execution's own.
 *
 * @returns {{window: object[], baseline: object|null}} the stretch's
 *   records, and the previous seal's record — the token counters the
 *   stretch's cost is differenced against. Null baseline means first
 *   stretch: the difference is taken from zero.
 */
export function stretchOf(records, session) {
  const mine = records.filter((record) => record.session === session);
  let start = 0;
  for (let index = 0; index < mine.length - 1; index += 1) {
    if (mine[index].outcome === "sealed") start = index + 1;
  }
  return { window: mine.slice(start), baseline: start > 0 ? mine[start - 1] : null };
}


/**
 * The diligence digest a seal carries, computed from its stretch.
 *
 * Counted, never composed: every number is a projection of compliance
 * records the hook already wrote, so no model-authored text can reach
 * the payload (skills#46's observed-state principle, applied to the
 * seal itself).
 *
 * @param window records of the stretch, oldest first, ending with the
 *   sealing execution's own record
 * @param baseline the previous seal's record, or null for the first
 *   stretch
 * @returns a payload `validateDiligence` accepts: turns, executions by
 *   outcome, per-fired-check counters, the token difference against the
 *   baseline's cumulative counters (null plus `reset: true` when any
 *   component ran backwards — a compaction gap is a gap, never zero),
 *   and the distinct models seen.
 */
export function digestOf(window, baseline) {
  const turns = turnsOf(window);
  const executions = { sealed: 0, blocked: 0, unsealed: 0, observed: 0 };
  for (const record of window) {
    if (record.outcome in executions) executions[record.outcome] += 1;
  }
  const checks = {};
  for (const row of perCheck(window, turns)) {
    if (row.fired > 0) {
      checks[row.check] = { fired: row.fired, cleared: row.cleared, ignored: row.ignored };
    }
  }
  const digest = {
    turns: turns.length,
    executions,
    checks,
    tokens: stretchTokens(window, baseline),
    models: [...new Set(window.map((record) => record.model).filter(Boolean))],
  };
  if (digest.tokens === null) digest.reset = true;
  return digest;
}


/** The stretch's token cost: last cumulative counter minus the baseline's. */
function stretchTokens(window, baseline) {
  const zero = { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 };
  const last = window[window.length - 1]?.tokens ?? zero;
  const base = baseline?.tokens ?? zero;
  const cost = {
    input: (last.input ?? 0) - (base.input ?? 0),
    output: (last.output ?? 0) - (base.output ?? 0),
    cacheRead: (last.cacheRead ?? 0) - (base.cacheRead ?? 0),
    cacheCreation: (last.cacheCreation ?? 0) - (base.cacheCreation ?? 0),
  };
  // A counter that ran backwards is a compaction reset observed inside
  // the window, not a discount — same rule as `costBetween`.
  if (Object.values(cost).some((value) => value < 0)) return null;
  return cost;
}


/**
 * Fold the seal sequence into per-session stretches.
 *
 * A stretch is a session's events since its previous seal, ended by a
 * seal — the same window the heartbeat digests, read here off the
 * ledger's own events so the page needs nothing the store does not
 * already publish. Events without an anchor cannot be attributed to a
 * session and take part in no stretch.
 *
 * @returns one entry per session, newest-last-event first (the chip
 *   order): `{session, stretches, tail}`. Each stretch carries its
 *   `seal` event, `at`, `digest` (the seal's diligence payload, or null
 *   for a seal from before the field existed), `threads` touched in its
 *   span, and `spanMs` — wall-clock from the previous seal (the
 *   session's first event, for the first stretch), or null when a stamp
 *   is missing. `tail` is the span after the last seal — a turn that
 *   did not finish its bookkeeping — as `{count, threads}`, or null.
 */
export function stretchesOf(events, records = []) {
  const bySession = new Map();
  events.forEach((event, index) => {
    const session = event.anchor?.session;
    if (!session) return;
    if (!bySession.has(session)) bySession.set(session, { session, events: [], last: 0 });
    const entry = bySession.get(session);
    entry.events.push(event);
    entry.last = index;
  });

  const threadsIn = (span) => [...new Set(span.map((event) => event.thread).filter(Boolean))];
  const msBetween = (from, to) => {
    if (!from || !to) return null;
    const ms = new Date(to) - new Date(from);
    return Number.isFinite(ms) ? ms : null;
  };

  const sessions = [];
  for (const entry of bySession.values()) {
    const stretches = [];
    let spanStart = entry.events[0]?.at ?? null;
    let span = [];
    for (const event of entry.events) {
      span.push(event);
      if (event.ev !== "sealed") continue;
      stretches.push({
        seal: event,
        at: event.at ?? null,
        digest: event.diligence ?? null,
        threads: threadsIn(span),
        spanMs: msBetween(spanStart, event.at),
      });
      spanStart = event.at ?? spanStart;
      span = [];
    }
    const tail = span.length ? { count: span.length, threads: threadsIn(span) } : null;
    projectDigests(stretches, records.filter((record) => record.session === entry.session));
    sessions.push({ session: entry.session, stretches, tail, last: entry.last });
  }
  return sessions
    .sort((a, b) => b.last - a.last)
    .map(({ last, ...entry }) => entry);
}


/**
 * Fill digest-less stretches from the store's raw records.
 *
 * A seal from before the digest existed carries none — but the digest
 * is a projection of retained data, and when the raw per-Stop records
 * reached the store, the same projection runs here at render time.
 * Joined by the `msg` both sides already carry (the seal's anchor and
 * every record), which survives clock skew between the seal's stamp and
 * the record written just after it. Recordless stretches stay legacy.
 */
function projectDigests(stretches, records) {
  let prevMsg = -Infinity;
  for (const stretch of stretches) {
    const msg = stretch.seal.anchor?.msg;
    if (!Number.isInteger(msg)) continue;
    if (!stretch.digest) {
      const window = records.filter(
        (record) => Number.isInteger(record.msg) && record.msg > prevMsg && record.msg <= msg,
      );
      if (window.length) {
        const before = records.filter((record) => Number.isInteger(record.msg) && record.msg <= prevMsg);
        stretch.digest = digestOf(window, before[before.length - 1] ?? null);
        // Projected, not carried: rendered the same, but a reader of the
        // data can tell a seal-borne digest from a render-time one.
        stretch.projected = true;
      }
    }
    prevMsg = msg;
  }
}
