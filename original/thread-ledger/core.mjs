// Thread ledger — the event schema, the state machine and the fold.
//
// Pure and browser-safe: no imports, no filesystem, no process. The
// recorder, the Markdown view and the page all compute state by calling
// into this file, so there is exactly one implementation of what a
// thread's state is.

// Event kinds. `opened` and `reopened` start a thread's active span;
// `completed` and `dropped` end it.
export const OPENING = ["opened", "reopened"];
export const TERMINAL = ["completed", "dropped"];
export const EVENTS = [
  ...OPENING,
  "progress",
  "blocked",
  "unblocked",
  "parked",
  "promoted",
  "reprioritized",
  "stale",
  "synced",
  "sealed",
  ...TERMINAL,
];

// `sealed` is written by the turn's own check script once every check
// is green: it records that the turn finished its bookkeeping. That is
// a fact about the LOG, not about any thread, so a seal carries no
// thread at all — which makes an unsealed tail one unambiguous
// predicate ("the last turn did not finish") rather than a recency
// heuristic. It carries an anchor like every other event, so the seal
// sequence doubles as a per-turn table of contents over the transcript.
export const LOG_EVENTS = ["sealed"];

// `promoted` records that a thread acquired a forge ticket. That is
// metadata about the thread's identity, not a step in its work, so it is
// legal wherever the thread is live and leaves the work state untouched.
// Requiring a thread to be unblocked before it could be promoted would
// have forced a false `unblocked` — filing a ticket does not clear a
// blocker.
// `stale` and `synced` join it: they describe whether the FORGE TICKET
// still reflects what the session knows, which is orthogonal to whether
// the thread is blocked.
export const METADATA_EVENTS = ["promoted", "stale", "synced", "reprioritized"];

// Legal successors per current WORK state. A thread's work state is the
// kind of its most recent non-metadata event. Enforced against the fold
// of EVERY session file, so a later session can continue a thread an
// earlier one opened.
export const TRANSITIONS = {
  "": OPENING,
  opened: ["progress", "blocked", "parked", ...TERMINAL],
  reopened: ["progress", "blocked", "parked", ...TERMINAL],
  progress: ["progress", "blocked", "parked", ...TERMINAL],
  blocked: ["unblocked"],
  parked: ["unblocked"],
  unblocked: ["progress", "blocked", "parked", ...TERMINAL],
  completed: ["reopened"],
  dropped: ["reopened"],
};

// Written by the recorder from the environment. Agent-supplied values
// are overwritten rather than rejected: erroring would make every append
// a two-step dance for fields code determines more accurately.
export const RECORDER_OWNED = ["at", "anchor"];

// Who wrote an event, when it was not the session whose log it lands in.
// Absent is the ordinary case and means the session itself, so no
// existing event has to be rewritten to carry a value.
//
// A closed list rather than free text: provenance is only worth
// recording if it can be relied on to mean something, and a typo that
// invents a writer is indistinguishable from a writer nobody knows
// about. `bot` is an Actions workflow — the only writer besides a
// session that the store has.
export const WRITERS = ["bot"];

export const RANK = { high: 0, normal: 1, low: 2 };
export const BLOCKED_ON = ["internal", "external", "principal"];

// `owner/repo#123`, anywhere in a line of prose.
export const TICKET_RE = /\b([\w.-]+\/[\w.-]+#\d+)\b/g;

/** Rejected append. Carries the reason a human needs to fix it. */
export class LedgerError extends Error {}

// ------------------------------------------------- transcript positions

/**
 * True for a message the principal actually typed.
 *
 * Tool results are recorded with `type: "user"` too and outnumber real
 * turns roughly six to one, so counting the type alone yields an index
 * that points nowhere in the conversation.
 */
export function isUserTurn(record) {
  if (record?.type !== "user") return false;
  const content = record.message?.content;
  if (typeof content === "string") return Boolean(content.trim());
  if (Array.isArray(content)) {
    return content.some((block) => block && typeof block === "object" && block.type === "text");
  }
  return false;
}

/**
 * The stamp of the newest user turn in `text` — where this turn began.
 *
 * Null when the transcript holds no user turn, so a caller distinguishes
 * "the turn started at T" from "there is no turn to bound".
 */
export function lastUserTurnAt(text) {
  let at = null;
  for (const line of String(text).split("\n")) {
    if (!line.trim()) continue;
    try {
      const record = JSON.parse(line);
      if (isUserTurn(record) && record.timestamp) at = record.timestamp;
    } catch {
      // A partial trailing line is not a turn.
    }
  }
  return at;
}

/**
 * User turns in `text`, the JSONL a transcript path holds.
 *
 * Takes the text rather than a path so this stays pure: the anchor
 * index, the heartbeat's turn boundary and the transcript renderer all
 * count the same way, and a second implementation would make one
 * reader's message 12 another reader's message 30.
 */
export function countUserTurns(text) {
  let count = 0;
  for (const line of String(text).split("\n")) {
    if (!line.trim()) continue;
    try {
      if (isUserTurn(JSON.parse(line))) count += 1;
    } catch {
      // A partial trailing line is not a turn.
    }
  }
  return count;
}

/**
 * What the transcript cost, and which model spent it.
 *
 * Cumulative across every assistant message, because each one is a
 * separate API call and each call is billed on its own — summing them
 * is the total, not a double count of one context.
 *
 * Deliberately raw. The interesting numbers are differences between two
 * points in time, but computing a difference at write time would
 * silently attribute one stretch of work to another the moment a
 * measurement point is missed; a monotone counter cannot. It also means
 * a change of mind about the metric does not invalidate what has
 * already been recorded.
 *
 * `model` is the newest one seen: a session can change model mid-run,
 * and what matters for a turn's verdict is who took that turn.
 */
export function transcriptUsage(text) {
  const total = { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 };
  let model = null;
  for (const line of String(text).split("\n")) {
    if (!line.trim()) continue;
    let record;
    try {
      record = JSON.parse(line);
    } catch {
      // A partial trailing line has no usage to count.
      continue;
    }
    if (record?.type !== "assistant") continue;
    const message = record.message ?? {};
    if (message.model) model = message.model;
    const usage = message.usage;
    if (!usage) continue;
    total.input += usage.input_tokens ?? 0;
    total.output += usage.output_tokens ?? 0;
    total.cacheRead += usage.cache_read_input_tokens ?? 0;
    total.cacheCreation += usage.cache_creation_input_tokens ?? 0;
  }
  return { model, ...total };
}

/**
 * Latest work-state event kind per thread.
 *
 * Metadata events are skipped: promoting a thread tells you nothing
 * about whether it is blocked, and letting one overwrite the work state
 * would lose a blocker the moment its ticket was filed.
 */
export function currentStates(events) {
  const states = {};
  for (const event of events) {
    if (METADATA_EVENTS.includes(event.ev)) continue;
    if (LOG_EVENTS.includes(event.ev)) continue;
    states[event.thread] = event.ev;
  }
  return states;
}

/** The thread's ticket, from its opening or a later promotion. */
export function ticketOf(events, thread) {
  let ticket = null;
  for (const event of events) {
    if (event.thread !== thread) continue;
    if (OPENING.includes(event.ev)) ticket = event.ticket ?? null;
    else if (event.ev === "promoted") ticket = event.ticket ?? null;
  }
  return ticket;
}

/** Whether the thread's ticket is currently known to be behind. */
export function isStale(events, thread) {
  let stale = false;
  for (const event of events) {
    if (event.thread !== thread) continue;
    if (event.ev === "stale") stale = true;
    else if (event.ev === "synced") stale = false;
  }
  return stale;
}

/**
 * Throw LedgerError unless `event` may follow `history`.
 *
 * Checks the event kind, the state machine, per-kind required fields,
 * the ticket XOR conversation-only guard, and parent existence.
 */
export function validate(event, history) {
  const kind = event.ev;
  if (event.by !== undefined && !WRITERS.includes(event.by)) {
    throw new LedgerError(
      `by must be one of ${WRITERS.join(", ")}, got ${JSON.stringify(event.by)}`,
    );
  }
  if (!EVENTS.includes(kind)) {
    throw new LedgerError(
      `unknown event kind ${JSON.stringify(kind)}; expected one of ${EVENTS.join(", ")}`,
    );
  }
  if (LOG_EVENTS.includes(kind)) {
    if (event.thread) {
      throw new LedgerError(
        `${kind} is not about a thread — it records that a turn's log is ` +
          `complete, and naming ${JSON.stringify(event.thread)} would make the ` +
          "mark look like that thread's state",
      );
    }
    if (event.diligence !== undefined) validateDiligence(event.diligence);
    return;
  }
  if (event.diligence !== undefined) {
    throw new LedgerError(
      `diligence describes the stretch a seal closes, not a thread — it is ` +
        `only legal on ${LOG_EVENTS.join(", ")}, not on ${kind}`,
    );
  }

  const thread = event.thread;
  if (!thread) throw new LedgerError("event is missing 'thread'");

  // Where the thread's WORK lives, beside the ticket that tracks it —
  // the field a git-only reconciler needs (skills#70): whether a branch
  // is an ancestor of the default branch is answerable without
  // credentials, but only if the log says which branch to ask about.
  if (event.branch !== undefined && (typeof event.branch !== "string" || !event.branch.trim())) {
    throw new LedgerError("branch must be a non-empty string naming the work's branch");
  }
  if (event.pr !== undefined && !/^[\w.-]+\/[\w.-]+#\d+$/.test(String(event.pr))) {
    throw new LedgerError(`pr must look like owner/repo#123, got ${JSON.stringify(event.pr)}`);
  }

  const state = currentStates(history)[thread] ?? "";
  if (METADATA_EVENTS.includes(kind)) {
    if (!state) {
      throw new LedgerError(`${kind} before ${JSON.stringify(thread)} was ever opened`);
    }
    if (TERMINAL.includes(state)) {
      throw new LedgerError(`${kind}: ${JSON.stringify(thread)} is ${state}`);
    }
    validateMetadata(kind, event, history, thread);
    return;
  }

  const allowed = TRANSITIONS[state];
  if (!allowed.includes(kind)) {
    const current = state || "no prior event";
    throw new LedgerError(
      `illegal transition for ${JSON.stringify(thread)}: ${current} -> ${kind}. ` +
        `Legal from here: ${allowed.join(", ")}`,
    );
  }

  if (OPENING.includes(kind)) validateOpening(event, history);
  if (kind === "progress" && !Number.isInteger(event.pct)) {
    throw new LedgerError("progress needs an integer 'pct'");
  }
  if (kind === "blocked") {
    if (!BLOCKED_ON.includes(event.on)) {
      throw new LedgerError("blocked needs 'on': internal | external | principal");
    }
    if (!event.what) {
      throw new LedgerError("blocked needs 'what' — one line naming the blocker");
    }
  }
  if (kind === "parked" && !event.trigger) {
    throw new LedgerError(
      "parked needs a named 'trigger': a revisit condition without an " +
        "observer is a revisit that never happens",
    );
  }
}

// The digest's execution outcomes, one per way a heartbeat run can end.
export const OUTCOMES = ["sealed", "blocked", "unsealed", "observed"];

function counter(value) {
  return Number.isInteger(value) && value >= 0;
}

/**
 * Throw LedgerError unless `digest` is a well-formed diligence payload.
 *
 * The payload is computed by the heartbeat from its compliance log,
 * never typed — but the store outlives any one writer, so the shape is
 * enforced where events enter it, exactly like every other field.
 *
 * Shape: `turns` (positive integer), `executions` (a count per outcome
 * in OUTCOMES, no others), `checks` (per check name: fired/cleared/
 * ignored counters), `tokens` (the four-component sum, or null when a
 * counter reset inside the window — a gap, never zero), `models`
 * (strings), and optionally `reset: true` naming that gap.
 */
export function validateDiligence(digest) {
  if (typeof digest !== "object" || digest === null || Array.isArray(digest)) {
    throw new LedgerError(`diligence must be an object, got ${JSON.stringify(digest)}`);
  }
  if (!Number.isInteger(digest.turns) || digest.turns < 1) {
    throw new LedgerError(`diligence.turns must be a positive integer, got ${JSON.stringify(digest.turns)}`);
  }
  const executions = digest.executions;
  if (typeof executions !== "object" || executions === null) {
    throw new LedgerError("diligence.executions must map each outcome to a count");
  }
  for (const [outcome, count] of Object.entries(executions)) {
    if (!OUTCOMES.includes(outcome) || !counter(count)) {
      throw new LedgerError(
        `diligence.executions counts ${OUTCOMES.join(", ")}; got ` +
          `${JSON.stringify(outcome)}: ${JSON.stringify(count)}`,
      );
    }
  }
  const checks = digest.checks;
  if (typeof checks !== "object" || checks === null) {
    throw new LedgerError("diligence.checks must map each check to its counters");
  }
  for (const [name, row] of Object.entries(checks)) {
    const shaped =
      typeof row === "object" &&
      row !== null &&
      ["fired", "cleared", "ignored"].every((key) => counter(row[key]));
    if (!shaped) {
      throw new LedgerError(
        `diligence.checks[${JSON.stringify(name)}] needs integer fired, ` +
          `cleared and ignored, got ${JSON.stringify(row)}`,
      );
    }
  }
  const tokens = digest.tokens;
  if (tokens !== null) {
    const shaped =
      typeof tokens === "object" &&
      tokens !== null &&
      ["input", "output", "cacheRead", "cacheCreation"].every((key) => counter(tokens[key]));
    if (!shaped) {
      throw new LedgerError(
        "diligence.tokens must carry integer input, output, cacheRead and " +
          `cacheCreation, or be null for a reset gap; got ${JSON.stringify(tokens)}`,
      );
    }
  }
  if (!Array.isArray(digest.models) || digest.models.some((model) => typeof model !== "string")) {
    throw new LedgerError(`diligence.models must be strings, got ${JSON.stringify(digest.models)}`);
  }
  if (digest.reset !== undefined && digest.reset !== true) {
    throw new LedgerError(
      `diligence.reset is either absent or true, got ${JSON.stringify(digest.reset)}`,
    );
  }
}

/** Rules for events that describe a thread rather than move it. */
function validateMetadata(kind, event, history, thread) {
  if (kind === "reprioritized") {
    // Standing, not a move — same family as promoted. It exists because
    // deps, urgency and importance otherwise fold only on opening
    // events, and a ledger that owns those fields must be able to amend
    // them without forcing a false state change into the log.
    const fields = ["deps", "urgency", "importance"].filter((f) => event[f] !== undefined);
    if (!fields.length) {
      throw new LedgerError(
        "reprioritized needs at least one of 'deps', 'urgency', 'importance'",
      );
    }
    for (const field of ["urgency", "importance"]) {
      if (event[field] !== undefined && !(event[field] in RANK)) {
        throw new LedgerError(
          `${field} must be one of ${Object.keys(RANK).join(", ")}, got ${JSON.stringify(event[field])}`,
        );
      }
    }
    return;
  }
  if (kind === "promoted") {
    if (!event.ticket) {
      throw new LedgerError("promoted needs the 'ticket' it was promoted to");
    }
    if (ticketOf(history, thread)) {
      throw new LedgerError(
        `${JSON.stringify(thread)} already references a ticket; promotion is ` +
          "one-way, from conversation-only to a ticket",
      );
    }
  }
  if (kind === "stale") {
    if (!ticketOf(history, thread)) {
      throw new LedgerError(
        `${JSON.stringify(thread)} has no ticket to be out of date — file one ` +
          "first (promoted), or the staleness has nowhere to point",
      );
    }
    if (!event.what) {
      throw new LedgerError(
        "stale needs 'what' — the prompt it generates is only as useful as " +
          "the sentence naming what the ticket is missing",
      );
    }
    if (isStale(history, thread)) {
      throw new LedgerError(`${JSON.stringify(thread)} is already marked stale`);
    }
  }
  if (kind === "synced" && !isStale(history, thread)) {
    throw new LedgerError(`${JSON.stringify(thread)} is not marked stale; nothing to sync`);
  }
}

function validateOpening(event, history) {
  if (!event.title) throw new LedgerError(`${event.ev} needs a 'title'`);
  const hasTicket = Boolean(event.ticket);
  const conversationOnly = Boolean(event.conversation_only);
  if (hasTicket === conversationOnly) {
    throw new LedgerError(
      "every thread references a forge ticket OR is tagged conversation_only " +
        "— exactly one, never both, never neither. The board is where work lives.",
    );
  }
  const parent = event.parent;
  if (parent && !history.some((item) => item.thread === parent)) {
    throw new LedgerError(`parent thread ${JSON.stringify(parent)} does not exist`);
  }
  for (const field of ["urgency", "importance"]) {
    const value = event[field] ?? "normal";
    if (!(value in RANK)) {
      throw new LedgerError(
        `${field} must be one of ${Object.keys(RANK).join(", ")}, got ${JSON.stringify(value)}`,
      );
    }
  }
}

/** Overwrite recorder-owned fields with values code determines. */
export function stamp(event, session, msg, url, now) {
  const stamped = {};
  for (const [key, value] of Object.entries(event)) {
    if (!RECORDER_OWNED.includes(key)) stamped[key] = value;
  }
  // Seconds precision, UTC, `+00:00` rather than `Z` — the existing
  // corpus is written that way and the stamp is what orders files
  // against each other.
  stamped.at = (now ?? new Date()).toISOString().replace(/\.\d+Z$/, "+00:00");
  stamped.anchor = { session };
  // A position in a conversation, when there is one to have a position
  // in. Recording it as null would be a claim that the conversation has
  // no messages rather than that there is no conversation.
  if (msg !== null && msg !== undefined) stamped.anchor.msg = msg;
  if (url) stamped.anchor.url = url;
  return stamped;
}

/**
 * The log's identity, derived from the conversation's URL.
 *
 * The URL is the only stable name a conversation has. The transcript
 * filename is local to a machine, and the id a session is *called*
 * drifted between two runs of this tool — which produced a second valid
 * log that folded in beside the first and looked perfectly healthy.
 *
 * Deriving identity from the URL removes that failure rather than
 * guarding against it: the same conversation cannot resolve to two
 * names, whatever the transcript is called.
 */
export function sessionFromUrl(url) {
  // Parsed by hand rather than with URL(), so this stays usable on a
  // bare path and identical in node and the browser.
  const withoutScheme = String(url).replace(/^[a-zA-Z][\w+.-]*:\/\//, "");
  const path = withoutScheme.split(/[?#]/)[0];
  const segments = path.split("/").slice(1).filter(Boolean);
  if (segments.length === 0) {
    throw new LedgerError(`no session id in URL ${JSON.stringify(url)}`);
  }
  return segments[segments.length - 1].replace(/[^A-Za-z0-9._-]/g, "-");
}

/**
 * Collapse the event log into one state record per thread.
 *
 * Each record carries the thread's opening fields, its latest progress,
 * its blocking state, and `order` — the index of its first opening
 * event, which is the ordering tiebreak.
 */
export function fold(events) {
  const threads = new Map();
  events.forEach((event, index) => {
    const name = event.thread;
    const kind = event.ev;
    if (LOG_EVENTS.includes(kind)) return;
    if (!threads.has(name)) {
      threads.set(name, {
        thread: name,
        order: index,
        pct: 0,
        events: [],
        sessions: [],
        blocked: null,
        parked: null,
        stale: null,
        note: "",
      });
    }
    const thread = threads.get(name);
    thread.events.push(event);
    // Which conversations built this row — read off the anchors the
    // events already carry, so the page can filter by session without
    // the log recording anything new.
    const from = event.anchor?.session;
    if (from && !thread.sessions.includes(from)) thread.sessions.push(from);
    if (!METADATA_EVENTS.includes(kind)) thread.state = kind;
    thread.anchor = event.anchor ?? null;
    thread.at = event.at ?? null;
    // The conversation a thread was last touched in, carried on the
    // event rather than assumed for the store. A thread can be picked up
    // in a later session and the link has to follow it there; one URL
    // for the whole ledger would send every row to whichever session
    // happened to render.
    const url = event.anchor?.url;
    if (url) thread.url = url;
    // Where the work lives, carried forward like the URL: latest wins,
    // because work moves to follow-up branches and PRs mid-thread.
    if (event.branch) thread.branch = event.branch;
    if (event.pr) thread.pr = event.pr;

    if (OPENING.includes(kind)) {
      thread.title = event.title ?? thread.title ?? name;
      thread.ticket = event.ticket ?? null;
      thread.conversation_only = Boolean(event.conversation_only);
      thread.parent = event.parent ?? null;
      thread.deps = event.deps ?? [];
      thread.urgency = event.urgency ?? "normal";
      thread.importance = event.importance ?? "normal";
      thread.blocked = null;
      thread.parked = null;
    } else if (kind === "progress") {
      thread.pct = event.pct;
      thread.note = event.note ?? "";
    } else if (kind === "blocked") {
      thread.blocked = { on: event.on, what: event.what };
    } else if (kind === "parked") {
      thread.parked = event.trigger;
    } else if (kind === "unblocked") {
      thread.blocked = null;
      thread.parked = null;
      thread.note = event.note ?? thread.note;
    } else if (kind === "promoted") {
      thread.ticket = event.ticket;
      thread.conversation_only = false;
    } else if (kind === "reprioritized") {
      if (event.deps !== undefined) thread.deps = event.deps;
      if (event.urgency !== undefined) thread.urgency = event.urgency;
      if (event.importance !== undefined) thread.importance = event.importance;
    } else if (kind === "stale") {
      thread.stale = event.what;
    } else if (kind === "synced") {
      thread.stale = null;
    } else if (TERMINAL.includes(kind)) {
      thread.note = event.note ?? thread.note;
      thread.closed_order = index;
      if (kind === "completed") thread.pct = 100;
    }
  });
  return [...threads.values()];
}

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

/**
 * The severity tier a thread renders as, or null for the quiet default.
 *
 * The ruled palette (skills#58): blocked work outranks live work at the
 * same priority, urgency outranks importance, and blocked-on-principal
 * takes NO tier — the page already gives it violet, the one state where
 * the reader is the bottleneck, and a severity colour on top would bury
 * exactly that signal. Everything else stays uncoloured, because a
 * colour on everything is a colour on nothing.
 */
export function tierOf(thread) {
  if (thread.blocked?.on === "principal") return null;
  const urgent = thread.urgency === "high";
  const important = thread.importance === "high";
  const blocking = Boolean(thread.blocked);
  if (blocking && urgent) return "blocking-urgent";
  if (blocking && important) return "blocking-important";
  if (urgent) return "urgent";
  if (important) return "important";
  return null;
}

/**
 * Order open threads: dependency clusters, then priority, then age.
 *
 * Priority propagates along dependency edges — a cluster is ranked by
 * its actionable head, so a thread waiting on an urgent blocker sits
 * high, directly beneath it, while one waiting on a low-priority blocker
 * sits low with it. Only intra-ledger edges order anything; ticket
 * references are links, not gates, so rendering never needs the network.
 */
export function orderOpen(threads) {
  const open = threads.filter((item) => !TERMINAL.includes(item.state));
  const byName = new Map(open.map((item) => [item.thread, item]));

  const sortKey = (thread) => [
    RANK[thread.urgency ?? "normal"],
    RANK[thread.importance ?? "normal"],
    thread.order,
  ];
  const compare = (a, b) => {
    const [ka, kb] = [sortKey(a), sortKey(b)];
    for (let i = 0; i < ka.length; i += 1) {
      if (ka[i] !== kb[i]) return ka[i] - kb[i];
    }
    return 0;
  };

  /** Walk internal deps to the thread that must move first. */
  const headOf = (thread, seen) => {
    for (const name of thread.deps ?? []) {
      if (byName.has(name) && !seen.has(name)) {
        return headOf(byName.get(name), new Set([...seen, name]));
      }
    }
    return thread;
  };

  const clusters = new Map();
  for (const thread of open) {
    const head = headOf(thread, new Set([thread.thread]));
    if (!clusters.has(head.thread)) clusters.set(head.thread, []);
    clusters.get(head.thread).push(thread);
  }

  const ordered = [];
  const heads = [...clusters.keys()].sort((a, b) => compare(byName.get(a), byName.get(b)));
  for (const headName of heads) {
    const members = clusters.get(headName);
    members.sort((a, b) => {
      const [ha, hb] = [a.thread === headName ? 0 : 1, b.thread === headName ? 0 : 1];
      return ha !== hb ? ha - hb : compare(a, b);
    });
    for (const member of members) {
      member.depth = member.thread === headName ? 0 : 1;
      ordered.push(member);
    }
  }
  return ordered;
}

/** Closed threads in completion order, oldest first. */
export function orderClosed(threads) {
  return threads
    .filter((item) => TERMINAL.includes(item.state))
    .sort((a, b) => (a.closed_order ?? a.order) - (b.closed_order ?? b.order));
}

/**
 * Reconcile two versions of one append-only log.
 *
 * A store with several live sessions gets concurrent appends,
 * so a push loses the race routinely. The merge is mechanical,
 * so the tool should do it.
 *
 * Both sides are kept: an append-only log has no losing side, and an
 * event dropped here is an event nobody knows was written. Identical
 * lines collapse, because a retried push writes the same bytes twice.
 * Order is by stamp, with the original order preserved for equal stamps
 * — line order within a file is load-bearing, and second-precision
 * stamps tie often.
 */
export function mergeLogLines(ours, theirs) {
  const seen = new Set();
  const keep = [];
  for (const line of [...ours, ...theirs]) {
    const text = line.trim();
    if (!text || seen.has(text)) continue;
    seen.add(text);
    keep.push(text);
  }
  return keep
    .map((text, index) => ({ text, index, at: parseAt(text) }))
    .sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : a.index - b.index))
    .map((item) => item.text);
}

/** An event's stamp, or "" for a line that predates stamping. */
function parseAt(text) {
  try {
    return JSON.parse(text).at ?? "";
  } catch {
    // Not our JSON to repair; sorts first and stays visible.
    return "";
  }
}
