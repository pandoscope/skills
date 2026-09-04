// The HTML primitives every view is built from.
//
// Escaping first: a thread title is text the principal typed, and it
// reaches the page inside markup. Header contract: `../views.mjs`.

import { TICKET_RE, forgeOf, tierOf } from "../core.mjs";

const AMP = /&/g;

const LT = /</g;

const GT = />/g;

const QUOT = /"/g;


/** HTML-escape, matching Python's `html.escape(quote=True)`. */
export function esc(text) {
  return String(text ?? "")
    .replace(AMP, "&amp;")
    .replace(LT, "&lt;")
    .replace(GT, "&gt;")
    .replace(QUOT, "&quot;")
    .replace(/'/g, "&#x27;");
}


/**
 * The ticket-URL builder for one render, from the store's forge config.
 *
 * The same `config/shortcodes.json` the hygiene check reads (flat map =
 * GitHub defaults; structured = the org's own base and patterns), passed
 * in by the caller: views build strings and never touch a filesystem.
 */
export function ticketUrlOf(forge) {
  const { url } = forgeOf(forge ?? {});
  return (repo, number) => url("#", repo, number);
}


export function linkTickets(text, turl) {
  return esc(text).replace(TICKET_RE, (match) => {
    const cut = match.lastIndexOf("#");
    return `<a href="${esc(turl(match.slice(0, cut), match.slice(cut + 1)))}">${match}</a>`;
  });
}


/** Turn owner/repo#N into a forge link. Best effort, no network. */
export function linkify(text, forge = {}) {
  return linkTickets(text, ticketUrlOf(forge));
}


// --------------------------------------------------------------- page

/** The card's state, as a class the border and pill both read. */
export function stateClass(thread) {
  if (thread.blocked) return `s-blocked-${thread.blocked.on}`;
  if (thread.parked) return "s-parked";
  return "";
}


/**
 * A state pill whose reason lives in the browser's own tooltip.
 *
 * Native rather than a styled overlay: an absolutely-positioned popup
 * has to fight clipping, stacking and viewport edges, and each of those
 * failures hides the text completely rather than degrading it.
 */
export function pill(label, why) {
  return `<span class="pill" title="${esc(why)}">${esc(label)}</span>`;
}


export function pills(thread) {
  const out = [];
  if (thread.blocked) {
    const label = {
      principal: "blocked · you",
      internal: "blocked",
      external: "external",
    }[thread.blocked.on];
    out.push(pill(label, thread.blocked.what));
  }
  if (thread.parked) out.push(pill("parked", `trigger: ${thread.parked}`));
  if (thread.parent) out.push(pill("forked", `from ${thread.parent}`));
  return out.join("");
}


/**
 * Where in the conversation this thread was last touched.
 *
 * Three coordinates, because each fails alone: the absolute index
 * survives the session, the distance in turns is how a reader scrolls
 * back, and the wall-clock time is how they recognise the moment.
 */
export function anchorHtml(thread, nowMsg) {
  const msg = thread.anchor?.msg;
  const parts = [];
  if (msg !== undefined && msg !== null) {
    parts.push(`#${msg}`);
    if (nowMsg !== null && nowMsg !== undefined && nowMsg >= msg) {
      const distance = nowMsg - msg;
      parts.push(distance === 0 ? "latest" : `${distance} back`);
    }
  }
  const at = thread.at ?? "";
  if (at) parts.push(esc(at.slice(11, 16)));
  return `<span class="anchor" data-at="${esc(at)}">${parts.join(" · ")}<span class="rel"></span></span>`;
}


export function ticketPrefix(ticket, codes, turl) {
  if (!ticket) return "";
  const cut = ticket.lastIndexOf("#");
  if (cut < 0) return "";
  const [repo, number] = [ticket.slice(0, cut), ticket.slice(cut + 1)];
  const label = codes[repo] ?? repo;
  return `<a class="ref" href="${esc(turl(repo, number))}">${esc(label)}#${esc(number)}</a> `;
}


/**
 * Where the ticket link would be, for a thread that has none.
 *
 * Choosing a repo copies a prompt rather than writing anything: the page
 * is a view, and a control that appeared to file a ticket while the
 * store stayed unchanged would be exactly the kind of mechanism whose
 * success and failure look alike.
 */
export function ticketPicker(thread, codes) {
  const options = Object.entries(codes)
    .sort((a, b) => (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0))
    .map(([repo, code]) => `<option value="${esc(repo)}">${esc(code)}</option>`)
    .join("");
  return (
    `<select class="pick" aria-label="File a ticket for this thread"` +
    ` data-thread="${esc(thread.thread)}" data-title="${esc(thread.title ?? thread.thread)}">` +
    `<option value="">NO TICKET</option>${options}</select>`
  );
}


/** Plain text, or the same text linked to the session. */
export function sessionLink(text, url) {
  if (!url) return esc(text);
  return `<a class="tlink" href="${esc(url)}" target="_blank" rel="noreferrer">${esc(text)}</a>`;
}


/**
 * The thread's title, as text in the markup.
 *
 * The middle truncation is an enhancement applied after paint; the text
 * itself is written here, so a row is readable the instant it exists.
 */
export function titleHtml(title, detail, url) {
  const linked = Boolean(url);
  const span =
    `<span class="ttl${linked ? "" : " grow"}" title="${esc(detail)}"` +
    ` data-full="${esc(title)}">${esc(title)}</span>`;
  if (!linked) return span;
  return `<a class="tlink grow" href="${esc(url)}" target="_blank" rel="noreferrer">${span}</a>`;
}


/**
 * A disclosure whose contents are readable without any script.
 *
 * The copy button is the fast path. The text box under it is the one
 * that always works: `details` needs no JS to open and a textarea needs
 * none to be selected.
 */
export function promptPopover(summaryHtml, prompt, label) {
  return (
    `<details class="pop">${summaryHtml}` +
    `<div class="pop-body"><div class="pop-head">${esc(label)}` +
    `<span class="pop-acts"><button class="cp" type="button">copy</button>` +
    `<button class="x" type="button" title="close">×</button></span></div>` +
    `<textarea class="pop-text" readonly rows="7" spellcheck="false">${esc(prompt)}</textarea>` +
    `</div></details>`
  );
}


/** The severity tier as a class, or nothing — the quiet default. */
export function tierClass(thread) {
  const tier = tierOf(thread);
  return tier ? ` t-${tier}` : "";
}


/** Which sessions built this row, for the page's session filter. */
export function sessionsAttr(thread) {
  if (!thread.sessions?.length) return "";
  return ` data-sessions="${esc(thread.sessions.join(" "))}"`;
}


export function counts(open, closed) {
  const onYou = open.filter((item) => item.blocked?.on === "principal").length;
  const waiting = open.filter((item) => item.blocked && item.blocked.on !== "principal").length;
  const parked = open.filter((item) => item.parked).length;
  return { onYou, waiting, parked, active: open.length - onYou - waiting - parked, done: closed.length };
}


export function plural(count, noun) {
  if (count === 1) return `${count} ${noun}`;
  return `${count} ${noun.endsWith("h") ? `${noun}es` : `${noun}s`}`;
}
