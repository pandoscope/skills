// The page's body — one row per thread, open above closed.
//
// Header contract: `../views.mjs`.

import { orderClosed, orderOpen } from "../core.mjs";
import {
  anchorHtml,
  esc,
  linkTickets,
  pills,
  sessionLink,
  sessionsAttr,
  stateClass,
  ticketPicker,
  ticketPrefix,
  ticketUrlOf,
  tierClass,
  titleHtml,
} from "./html.mjs";
import { stalePill, summary } from "./summary.mjs";
import { stretchesSection } from "./stretches.mjs";

export function openRow(thread, nowMsg, codes, sessionUrl, turl) {
  const muted = thread.blocked || thread.parked ? " muted" : "";
  const depth = thread.depth ? " child" : "";
  const pct = thread.pct ?? 0;
  const title = thread.title ?? thread.thread;
  const note = thread.note ?? "";
  const detail = note ? `${title}\n\n${pct}% — ${note}` : `${title}\n\n${pct}%`;
  const ref = thread.ticket
    ? ticketPrefix(thread.ticket, codes, turl)
    : ticketPicker(thread, codes);
  return (
    `<li class="thread${muted}${depth} ${stateClass(thread)}${tierClass(thread)}"` +
    ` style="--pct:${pct}%"${sessionsAttr(thread)}` +
    ` aria-label="${pct} percent done">${ref}` +
    titleHtml(title, detail, thread.url ?? sessionUrl) +
    pills(thread) +
    stalePill(thread) +
    anchorHtml(thread, nowMsg) +
    `</li>`
  );
}


export function closedRow(thread, nowMsg, codes, sessionUrl, turl) {
  const dropped = thread.state === "dropped";
  const mark = dropped ? "☐" : "☑";
  const note = thread.note ?? "";
  const label = dropped ? "dropped" : "done";
  const title = thread.title ?? thread.thread;
  return (
    `<li class="thread closed ${label}"${sessionsAttr(thread)}>` +
    `<span class="mark">${mark}</span>` +
    `<span class="title">${ticketPrefix(thread.ticket, codes, turl)}` +
    `${sessionLink(title, thread.url ?? sessionUrl)}</span>` +
    anchorHtml(thread, nowMsg) +
    (note ? `<span class="note">${linkTickets(note, turl)}</span>` : "") +
    `</li>`
  );
}


/**
 * The page's body, built from folded state.
 *
 * Called in the browser, on data the page was handed or fetched. The
 * same function could run anywhere; nothing in it touches a document.
 * `events` carries the raw log for the parts folding drops — the seal
 * sequence the stretches section reads.
 */
export function renderBody(threads, title, nowMsg = null, codes = {}, sessionUrl = null, events = [], diligence = [], names = {}, forge = {}) {
  const open = orderOpen(threads);
  const closed = orderClosed(threads);
  const turl = ticketUrlOf(forge);
  return (
    `<header><h1>${esc(title)}</h1>${summary(open, closed)}` +
    `</header>` +
    stretchesSection(events, sessionUrl, diligence, names) +
    `<main><ol class="threads">` +
    open.map((thread) => openRow(thread, nowMsg, codes, sessionUrl, turl)).join("") +
    `</ol><hr><ol class="threads done">` +
    closed.map((thread) => closedRow(thread, nowMsg, codes, sessionUrl, turl)).join("") +
    `</ol></main>`
  );
}
