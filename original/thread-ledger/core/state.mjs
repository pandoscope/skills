// The fold — a thread's state computed from its own events.
//
// One implementation, called by the recorder, the Markdown view and the
// page alike, so nothing can disagree about what a thread's state is.
// The orderings live here too: they are how the fold's output is read.

import {
  LOG_EVENTS,
  METADATA_EVENTS,
  OPENING,
  RANK,
  TERMINAL,
  stamp,
} from "./schema.mjs";

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
