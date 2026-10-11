// Measures computed from the compliance log, which holds one record per Stop attempt:
// turns, their token cost, counts per check, and stretches between seals.
// A seal is the store event written when a turn ends with every check passing,
// and the digest it carries is computed here from the records, never written by the model.
// The functions do no I/O, so the rendered page runs the same code in the browser.

import { counter, stamp } from "./schema.mjs";
import { validateDiligence } from "./validate.mjs";

// ------------------------------------------------- compliance records

/**
 * Group records into turns.
 *
 * A turn runs from one principal message to the agent's last Stop attempt,
 * and each attempt, called a cycle, writes one record.
 * Records group by session and `turnKey`, the turn's start time.
 * `msg` cannot key a turn: it advances when the heartbeat's block feedback arrives,
 * so it would split one turn into one group per cycle.
 * Records written before `turnKey` existed fall back to `msg`.
 */
function groupTurns(records) {
  const byTurn = new Map();
  for (const record of records) {
    const key = `${record.session}\u0000${record.turnKey ?? record.msg}`;
    if (!byTurn.has(key)) byTurn.set(key, []);
    byTurn.get(key).push(record);
  }
  return [...byTurn.values()].map((cycles) => [...cycles].sort((a, b) => (a.cycle ?? 1) - (b.cycle ?? 1)));
}


/** Summarise each turn: its cycles, their token cost, and the verdicts before and after the reminders. */
export function turnsOf(records) {
  return groupTurns(records).map((ordered) => {
    const first = ordered[0];
    const last = ordered[ordered.length - 1];
    return {
      session: first.session,
      msg: first.msg,
      at: first.at ?? null,
      model: last.model ?? first.model ?? null,
      cycles: ordered.length,
      // Every cycle after the first exists because the heartbeat blocked,
      // so `extra` is the reminders' cost in round trips.
      extra: ordered.length - 1,
      // All tokens between the first and last Stop count, including work unrelated to the reminder,
      // so `cost` is an upper bound.
      cost: costBetween(first, last),
      unprompted: verdictMap(first),
      final: verdictMap(last),
      fired: ordered.map((cycle) => cycle.fired).filter(Boolean),
      outcome: last.outcome,
    };
  });
}


/** Tokens spent between a turn's first and last record, or null for a turn of one record. */
function costBetween(first, last) {
  const zero = { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 };
  if (first === last) return null;
  const a = first.tokens ?? zero;
  const b = last.tokens ?? zero;
  const cost = {
    input: (b.input ?? 0) - (a.input ?? 0),
    output: (b.output ?? 0) - (a.output ?? 0),
    cacheRead: (b.cacheRead ?? 0) - (a.cacheRead ?? 0),
    cacheCreation: (b.cacheCreation ?? 0) - (a.cacheCreation ?? 0),
  };
  // Compaction rewrites the transcript, so the running token counters can drop within a turn.
  // A negative cost would lower every sum it enters, so the turn reports no cost instead.
  if (Object.values(cost).some((value) => value < 0)) return null;
  return cost;
}


/** A record's verdicts, keyed by check name. */
function verdictMap(record) {
  const map = {};
  for (const verdict of record.verdicts ?? []) map[verdict.check] = verdict.verdict;
  return map;
}


/**
 * Per check: how often it fails before any reminder, and whether its reminder works.
 *
 * `cleared` counts a check that passes at the Stop after its reminder.
 * That shows the agent complied, not that the work it then did was worth doing.
 * `unconfigured` counts a check that had nothing to look at,
 * and stays apart from passes and failures so it moves no rate.
 */
export function perCheck(records, turns, disputes = []) {
  const checks = new Map();
  const of = (name) => {
    if (!checks.has(name)) {
      checks.set(name, {
        check: name,
        turns: 0,
        unpromptedFail: 0,
        // A shadowed check runs without blocking (skills#192).
        // `shadow` counts what it would have refused, charged to no one.
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
      // A dispute marks a window in which this check is known to fail wrongly.
      // A failure inside it goes to `disputed` and skips `turns` too,
      // so it enters neither the failures nor the turns they are divided by.
      // A pass still counts, because a dispute covers false failures only.
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
  for (const ordered of groupTurns(records)) {
    for (let index = 0; index < ordered.length; index += 1) {
      const fired = ordered[index].fired;
      if (!fired) continue;
      const row = of(fired);
      if (disputed(fired, ordered[index].at, disputes)) {
        row.disputed += 1;
        continue;
      }
      row.fired += 1;
      // Did the agent act on the reminder?
      // When the heartbeat blocks a Stop, it shows the agent the `fired` check's reminder
      // and the agent keeps working, so `next` is the Stop after the reminder:
      // - `next` passes the `fired` check: the agent fixed it, and `cleared` counts it.
      // - `next` fails it: the agent got the reminder and still did not fix it.
      //   `ignored` counts this, and it is the signal this measure exists for.
      // - No `next`: the heartbeat let the turn end here, so the agent never got the chance.
      //   Counting that as `ignored` would blame the agent for something the heartbeat did.
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
 * Keep the valid disputes and count the invalid ones.
 *
 * A dispute names a check, a time window and the ticket that files the check's false failures (skills#66).
 * Inside the window, the diligence measure stops charging that check's failures to the agent.
 * Disputes live in the store's `diligence/disputes.jsonl`, beside the compliance records and never inside them,
 * because a record is never edited once written.
 * Validation rejects a dispute without a ticket,
 * so no failure is erased without a filed cause.
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


/** Whether a verdict of `check` at time `at` falls inside one of its dispute windows. */
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


/** Per model: how many turns needed no reminder, and what the reminders cost. */
export function perModel(turns) {
  const models = new Map();
  for (const turn of turns) {
    const name = turn.model ?? "(unrecorded)";
    if (!models.has(name)) {
      models.set(name, { model: name, turns: 0, clean: 0, extra: 0, output: 0 });
    }
    const row = models.get(name);
    row.turns += 1;
    // A turn is clean when no check failed at its first Stop, before any reminder.
    // Models are compared on this number.
    if (!Object.values(turn.unprompted).includes("fail")) row.clean += 1;
    row.extra += turn.extra;
    row.output += turn.cost?.output ?? 0;
  }
  return [...models.values()].sort((a, b) => b.turns - a.turns);
}


// ------------------------------------------------------------ stretches

/**
 * The stretch of a session's records that ends at its last record.
 *
 * A stretch runs from the record after the session's previous seal to the sealing record.
 * The code fixes this window (skills#69), so the agent cannot pick a flattering one.
 * The caller makes sure the last record belongs to the heartbeat run that seals.
 *
 * @returns {{window: object[], baseline: object|null}} the stretch's records,
 *   and the previous seal's record, whose token counters the stretch's cost is measured from.
 *   `baseline` is null for a session's first stretch, which is measured from zero.
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
 * Every number counts compliance records the heartbeat already wrote,
 * so no text the model writes reaches the payload (skills#46).
 *
 * @param window the stretch's records, oldest first, ending with the sealing heartbeat run's record
 * @param baseline the previous seal's record, or null for the first stretch
 * @returns a payload `validateDiligence` accepts: `turns`, `executions` per outcome,
 *   counters per fired check, `tokens` spent since the baseline, and the `models` seen.
 *   When a token counter dropped, `tokens` is null and `reset` is true,
 *   because a compaction gap is unknown, not zero.
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


/** The stretch's token cost: the last record's counters minus the baseline's. */
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
  // A counter that dropped means a compaction inside the window, handled as in `costBetween`.
  if (Object.values(cost).some((value) => value < 0)) return null;
  return cost;
}


/**
 * Split each session's ledger events into stretches, one per seal.
 *
 * A stretch here is the same window the heartbeat digests,
 * read from the ledger's own events, so the page needs nothing the store does not publish.
 * An event without an anchor names no session and joins no stretch.
 *
 * @returns one entry per session as `{session, stretches, tail}`,
 *   the session with the newest event first, in the order of the page's chips.
 *   Each stretch carries its `seal` event, `at`, `digest`, `threads` and `spanMs`:
 *   - `digest` is the seal's diligence payload, or null for a seal older than the field;
 *   - `threads` lists the threads its events touched;
 *   - `spanMs` is the time since the previous seal, and null when a timestamp is missing;
 *     a session's first stretch counts from its first event.
 *   `tail` holds the events after the last seal, from a turn whose bookkeeping did not finish,
 *   as `{count, threads}`, or null.
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
 * Fill each stretch that lacks a digest from the store's raw records.
 *
 * Seals written before the digest existed carry none,
 * but where their per-Stop records reached the store, `digestOf` computes the digest at render time.
 * Records join a seal by `msg`, which both carry.
 * Unlike a timestamp, `msg` survives clock skew between a seal and the record written after it.
 * A stretch without records keeps a null digest.
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
        // `projected` tells a reader of the data that the digest was computed at render time,
        // not carried by the seal.
        stretch.projected = true;
      }
    }
    prevMsg = msg;
  }
}
