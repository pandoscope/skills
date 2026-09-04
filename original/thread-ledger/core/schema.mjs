// The event schema — what a ledger event may be, and who may write it.
//
// Pure and browser-safe: no imports, no filesystem, no process. Every
// other module in `core/` reads its vocabulary from here, so a new
// event kind is added in exactly one place.

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


// The same reference as a FIELD: anchored, one ticket and nothing else.
// Derived from TICKET_RE rather than spelled again, so the canonical
// shape cannot fork between the scanner and the validators (skills#114).
export const TICKET_SHAPE = new RegExp(`^(?:${TICKET_RE.source})$`);


/** The one refusal for a malformed forge reference, shared by every field. */
export function requireTicketShape(field, value) {
  if (!TICKET_SHAPE.test(String(value))) {
    throw new LedgerError(`${field} must look like owner/repo#123, got ${JSON.stringify(value)}`);
  }
}


/** Rejected append. Carries the reason a human needs to fix it. */
export class LedgerError extends Error {}


export function counter(value) {
  return Number.isInteger(value) && value >= 0;
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
