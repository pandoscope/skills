// The gate every append passes through.
//
// A rejected append carries the reason a human needs to fix it, so
// validation states what is wrong with the event rather than that
// something is. Pure and browser-safe.

import {
  BLOCKED_ON,
  EVENTS,
  LOG_EVENTS,
  LedgerError,
  METADATA_EVENTS,
  OPENING,
  RANK,
  TERMINAL,
  TRANSITIONS,
  WRITERS,
  counter,
  requireTicketShape,
} from "./schema.mjs";

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
  if (event.pr !== undefined) requireTicketShape("pr", event.pr);

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
    requireTicketShape("ticket", event.ticket);
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
  // Shape as well as presence (skills#114): a shortcode or a stray
  // space validated here and surfaced weeks later in the close-loop
  // run, filed under a token-permissions heading whose remedy could
  // not fix it. The write is where the typo is one keystroke from its
  // author.
  if (hasTicket) requireTicketShape("ticket", event.ticket);
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
