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
  "stale",
  "synced",
  ...TERMINAL,
];

// `promoted` records that a thread acquired a forge ticket. That is
// metadata about the thread's identity, not a step in its work, so it is
// legal wherever the thread is live and leaves the work state untouched.
// Requiring a thread to be unblocked before it could be promoted would
// have forced a false `unblocked` — filing a ticket does not clear a
// blocker.
// `stale` and `synced` join it: they describe whether the FORGE TICKET
// still reflects what the session knows, which is orthogonal to whether
// the thread is blocked.
export const METADATA_EVENTS = ["promoted", "stale", "synced"];

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

export const RANK = { high: 0, normal: 1, low: 2 };
export const BLOCKED_ON = ["internal", "external", "principal"];

// `owner/repo#123`, anywhere in a line of prose.
export const TICKET_RE = /\b([\w.-]+\/[\w.-]+#\d+)\b/g;

/** Rejected append. Carries the reason a human needs to fix it. */
export class LedgerError extends Error {}

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
  if (!EVENTS.includes(kind)) {
    throw new LedgerError(
      `unknown event kind ${JSON.stringify(kind)}; expected one of ${EVENTS.join(", ")}`,
    );
  }
  const thread = event.thread;
  if (!thread) throw new LedgerError("event is missing 'thread'");

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

/** Rules for events that describe a thread rather than move it. */
function validateMetadata(kind, event, history, thread) {
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
  stamped.anchor = { session, msg };
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
    if (!threads.has(name)) {
      threads.set(name, {
        thread: name,
        order: index,
        pct: 0,
        events: [],
        blocked: null,
        parked: null,
        stale: null,
        note: "",
      });
    }
    const thread = threads.get(name);
    thread.events.push(event);
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
