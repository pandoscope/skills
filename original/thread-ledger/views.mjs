// Thread ledger — every view of the folded state.
//
// Pure and browser-safe, like `core.mjs`: these functions build strings
// and take no filesystem. The page calls them after folding the events
// it was given; the CLI calls the Markdown one. Neither view computes
// state of its own.

import {
  tierOf,
  RANK,
  TERMINAL,
  TICKET_RE,
  orderClosed,
  orderOpen,
  sessionFromUrl,
  stretchesOf,
} from "./core.mjs";

export const CSS = `
/* Neutrals carry a slight blue bias toward the accent so the ground
   reads as chosen rather than inherited. Semantic hues are separate
   from the accent: amber waits on work, violet waits on the
   principal, green is done. */
:root{
  --bg:#fbfcfd; --panel:#fff; --fg:#131820; --dim:#5d6b7d; --line:#e2e8f0;
  --accent:#2f6fed; --fill:#e8f0fe;
  --ok:#0f8a5f; --wait:#b26a00; --you:#6d4aff; --drop:#94a3b8;
}
@media (prefers-color-scheme:dark){
  :root{
    --bg:#0c1116; --panel:#111820; --fg:#e3eaf2; --dim:#8f9dae; --line:#1f2a36;
    --accent:#6a9bff; --fill:#132540;
    --ok:#3fb87d; --wait:#d9a441; --you:#9d84ff; --drop:#5c6b7c;
  }
}
:root[data-theme=dark]{
  --bg:#0c1116; --panel:#111820; --fg:#e3eaf2; --dim:#8f9dae; --line:#1f2a36;
  --accent:#6a9bff; --fill:#132540;
  --ok:#3fb87d; --wait:#d9a441; --you:#9d84ff; --drop:#5c6b7c;
}
:root[data-theme=light]{
  --bg:#fbfcfd; --panel:#fff; --fg:#131820; --dim:#5d6b7d; --line:#e2e8f0;
  --accent:#2f6fed; --fill:#e8f0fe;
  --ok:#0f8a5f; --wait:#b26a00; --you:#6d4aff; --drop:#94a3b8;
}
*{box-sizing:border-box}
body{background:var(--bg);color:var(--fg);margin:0 auto;padding:2.5rem 1.25rem 4rem;
  max-width:62rem;
  font:15px/1.55 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif}
.mono,.anchor{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;
  font-variant-numeric:tabular-nums}
header{display:flex;flex-direction:column;gap:.75rem;margin-bottom:1.75rem}
h1{font-size:1.3rem;font-weight:650;margin:0;letter-spacing:-.01em;text-wrap:balance}
.summary{display:flex;flex-wrap:wrap;gap:.4rem}
.stat{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.75rem;
  border:1px solid var(--line);background:var(--panel);border-radius:6px;
  padding:.2rem .55rem;color:var(--dim);white-space:nowrap}
.stat b{font-weight:600;color:var(--fg)}
.stat.you{border-color:var(--you);color:var(--you)}
.stat.you b{color:var(--you)}
.threads{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:.25rem}
/* The progress fill is a gradient on the card, not a child: a clipped
   child needs overflow:hidden, and that silently eats every tooltip. */
.thread{display:flex;align-items:center;gap:.5rem;padding:.35rem .55rem;
  border:1px solid var(--line);border-radius:7px;
  background:linear-gradient(to right,var(--fill) 0 var(--pct,0%),
    var(--panel) var(--pct,0%) 100%)}
.thread[style*="--pct:0%"]{background:var(--panel)}
.thread.child{margin-left:1.5rem}
.thread.muted{opacity:.7}
.grow{flex:1;min-width:0}
.ttl{display:block;white-space:nowrap;overflow:hidden;font-weight:600;cursor:help}
.ref,.pick{flex:none;min-width:5.5rem;text-align:center}
.ref{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.78rem;
  font-weight:500;text-decoration:none;padding:.05rem .3rem;border-radius:4px;
  background:color-mix(in srgb,var(--accent) 12%,transparent)}
.ref:hover{text-decoration:underline}
.pick{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.72rem;
  color:var(--dim);background:var(--panel);border:1px dashed var(--line);
  border-radius:4px;padding:.05rem .25rem;cursor:pointer}
.pick:hover{border-color:var(--accent);color:var(--accent)}
/* A ticket whose description has fallen behind the session. Amber,
   not the blocked hues: nothing is waiting, the record is just out of
   date. */
/* A \`summary\` is \`display:list-item\` by default, which parks its text
   in the corner even once the marker is hidden. Flex centring is what
   puts the glyph back in the middle of the circle. */
.info{flex:none;width:1.15rem;height:1.15rem;padding:0;border-radius:999px;
  display:flex;align-items:center;justify-content:center;
  border:1px solid var(--wait);background:var(--panel);color:var(--wait);
  font:600 .68rem/1 ui-monospace,SFMono-Regular,Menlo,monospace;cursor:pointer}
.info:hover{background:var(--wait);color:var(--panel)}
button.stat{font:inherit;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;
  font-size:.75rem;cursor:pointer}
.stat.outdated{border-color:var(--wait);color:var(--wait)}
.stat.outdated b{color:var(--wait)}
.stat.outdated:hover{background:var(--wait);color:var(--panel)}
.stat.outdated:hover b{color:var(--panel)}
.copied{position:fixed;left:50%;bottom:1.5rem;transform:translateX(-50%);z-index:50;
  padding:.5rem .8rem;border-radius:7px;border:1px solid var(--line);
  background:var(--panel);color:var(--fg);font-size:.82rem;
  box-shadow:0 8px 24px rgb(0 0 0 / .2);max-width:min(38rem,90vw)}
.anchor{color:var(--dim);font-size:.71rem;white-space:nowrap;flex:none}
.rel:not(:empty)::before{content:" · "}
/* State reads twice: the card's border carries it at a distance, the
   pill names it up close, and the reason waits behind the pill. */
.thread.s-blocked-internal{border-color:var(--wait)}
.thread.s-blocked-external{border-color:var(--accent)}
.thread.s-blocked-principal{border-color:var(--you);box-shadow:inset 0 0 0 1px var(--you)}
.thread.s-parked{border-style:dashed}
.pill{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.7rem;
  flex:none;border:1px solid var(--line);border-radius:999px;padding:.05rem .5rem;
  color:var(--dim);background:var(--panel);cursor:help}
.s-blocked-internal .pill{color:var(--wait);border-color:currentColor}
.s-blocked-external .pill{color:var(--accent);border-color:currentColor}
.s-blocked-principal .pill{color:var(--you);border-color:currentColor;font-weight:600}
.s-parked .pill{border-style:dashed}
/* Severity tiers (skills#58). The card border carries the tier at a
   distance; blocked-on-principal is deliberately absent — violet owns
   that state, and the quiet default stays quiet. Light red is the
   awkward tier everywhere: here it is the red hue at lower weight. */
:root{--t-red:#d92d20; --t-red-soft:#f97066; --t-orange:#e8590c; --t-yellow:#b78103}
@media (prefers-color-scheme:dark){
  :root{--t-red:#f97066; --t-red-soft:#e0726a; --t-orange:#ff922b; --t-yellow:#e3b341}
}
:root[data-theme=dark]{--t-red:#f97066; --t-red-soft:#e0726a; --t-orange:#ff922b; --t-yellow:#e3b341}
:root[data-theme=light]{--t-red:#d92d20; --t-red-soft:#f97066; --t-orange:#e8590c; --t-yellow:#b78103}
.thread.t-blocking-urgent{border-color:var(--t-red);box-shadow:inset 3px 0 0 var(--t-red)}
.thread.t-blocking-important{border-color:var(--t-red-soft);box-shadow:inset 3px 0 0 var(--t-red-soft)}
.thread.t-urgent{border-color:var(--t-orange);box-shadow:inset 3px 0 0 var(--t-orange)}
.thread.t-important{border-color:var(--t-yellow);box-shadow:inset 3px 0 0 var(--t-yellow)}
.t-blocking-urgent .pill{color:var(--t-red);border-color:currentColor;font-weight:600}
.t-blocking-important .pill{color:var(--t-red-soft);border-color:currentColor}
/* The sessions section: chips pick a session, its stretches unfold
   beneath, and the thread lists below filter to it. Stretch rules stay
   quiet when clean — amber marks a reminded stretch, red a gave-up,
   and everything else is dim monospace a reader scans, not reads. */
.sessions{margin:0 0 1.5rem;display:flex;flex-direction:column;gap:.5rem}
.chips{display:flex;flex-wrap:wrap;gap:.35rem}
.chip{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.72rem;
  border:1px solid var(--line);background:var(--panel);color:var(--dim);
  border-radius:999px;padding:.15rem .6rem;cursor:pointer;max-width:14rem;
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.chip:hover{border-color:var(--accent);color:var(--accent)}
.chip.on{border-color:var(--accent);color:var(--accent);background:var(--fill)}
.sess{border:1px solid var(--line);border-radius:7px;background:var(--panel);
  padding:.35rem .55rem}
.rollup{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.74rem;
  color:var(--dim);display:flex;flex-wrap:wrap;gap:.3rem .8rem}
.rollup b{color:var(--fg);font-weight:600}
.rules>summary{font-size:.72rem;color:var(--dim);cursor:pointer;margin-top:.25rem}
.stretchlist{list-style:none;margin:.35rem 0 0;padding:0;display:flex;
  flex-direction:column;gap:.15rem}
.stretch{display:flex;align-items:center;gap:.6rem;flex-wrap:wrap;
  font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.72rem;
  color:var(--dim);border-top:1px solid var(--line);padding:.2rem 0 0}
.stretch .sthreads{flex:1;min-width:8rem;overflow:hidden;text-overflow:ellipsis;
  white-space:nowrap;color:var(--fg)}
.stretch.st-remind{border-top-color:var(--wait)}
.stretch .remind{color:var(--wait)}
.stretch.st-gaveup{border-top-color:var(--t-red)}
.stretch .gaveup{color:var(--t-red);font-weight:600}
.stretch.tail,.stretch.legacy{border-top-style:dashed;font-style:italic}
.gap{border:1px dashed var(--wait);color:var(--wait);border-radius:4px;
  padding:0 .3rem;cursor:help}
.mult{color:var(--dim)}
.mult.hot{color:var(--fg);font-weight:600}
.older>summary{font-size:.7rem;color:var(--dim);cursor:pointer;padding:.15rem 0}
.stretch .schecks{color:var(--dim)}
.note{color:var(--dim);font-size:.84rem}
hr{border:0;border-top:1px solid var(--line);margin:2.25rem 0 1rem}
.done{gap:0}
.thread.closed{gap:.5rem;background:none;border:0;border-radius:0;padding:.15rem 0}
.thread.closed .ttl{font-weight:400}
.thread.dropped{color:var(--drop)}
.thread.dropped .ttl{text-decoration:line-through}
.mark{color:var(--ok)}
.thread.dropped .mark{color:var(--drop)}
a{color:var(--accent);text-underline-offset:2px}
/* The prompt disclosures. \`details\` opens with no script at all, so
   the text is always reachable; the copy button is the shortcut, not
   the mechanism. */
.pop{position:relative;flex:none}
.pop>summary{list-style:none;cursor:pointer}
.pop>summary::-webkit-details-marker{display:none}
/* Also a summary, and also list-item by default. */
summary.stat.outdated{display:inline-block}
/* The un-scripted placement: right-aligned under the control, and
   never wider than the viewport. Script refines this to a clamped
   fixed position; this is what a reader gets if it does not run. */
.pop-body{position:absolute;right:0;top:calc(100% + .35rem);z-index:40;
  width:min(34rem,80vw);max-width:calc(100vw - 1rem);
  padding:.5rem;border-radius:8px;
  border:1px solid var(--line);background:var(--panel);
  box-shadow:0 10px 30px rgb(0 0 0 / .18)}
.pop-head{display:flex;align-items:center;justify-content:space-between;
  gap:.5rem;font-size:.72rem;color:var(--dim);padding:0 .1rem .35rem}
.pop-acts{display:flex;align-items:center;gap:.3rem;flex:none}
.cp,.x{font:600 .7rem/1 ui-sans-serif,system-ui,sans-serif;cursor:pointer;
  padding:.25rem .5rem;border-radius:5px;border:1px solid var(--accent);
  background:var(--panel);color:var(--accent)}
.x{border-color:var(--line);color:var(--dim);padding:.25rem .4rem}
.cp:hover{background:var(--accent);color:var(--panel)}
.x:hover{border-color:var(--fg);color:var(--fg)}
.pop-text{width:100%;resize:vertical;padding:.45rem .55rem;border-radius:6px;
  border:1px solid var(--line);background:var(--bg);color:var(--fg);
  font:12px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace}
/* The self-report. Deliberately plain and at the end: it is a tool for
   the two of us, not part of the ledger. */
.diag{margin-top:2.5rem;font-size:.75rem;color:var(--dim)}
.diag>summary{cursor:pointer}
.diag .pop-body{position:static;width:auto;margin-top:.4rem}
/* A linked title stays typographically a title: the link is the whole
   row's affordance, not a blue interruption in the middle of it. */
.tlink{color:inherit;text-decoration:none;min-width:0}
.tlink:hover{text-decoration:underline;text-decoration-color:var(--accent)}
a:focus-visible,:focus-visible{outline:2px solid var(--accent);outline-offset:2px;
  border-radius:3px}
`;

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

/** Turn owner/repo#N into a GitHub link. Best effort, no network. */
export function linkify(text) {
  return esc(text).replace(
    TICKET_RE,
    (match) => `<a href="https://github.com/${match.replace("#", "/issues/")}">${match}</a>`,
  );
}

// ------------------------------------------------------------ prompts

/**
 * The instruction that brings one ticket back in line.
 *
 * Generated rather than hand-written into the page so the copy button
 * and the always-present text box say the same thing. Two copies of a
 * prompt drift, and the one nobody reads is the one that is wrong.
 */
export function singlePrompt(thread) {
  return [
    `Update ${thread.ticket} to match what the session now knows: ${thread.stale}`,
    "Keep the ticket's structure and do not restate the history of the edit.",
    `Then: ledger append --ev synced --thread ${thread.thread}`,
  ].join("\n");
}

/**
 * The instruction that brings named tickets back in line.
 *
 * Names each ticket and what it is missing, because "update the
 * outdated tickets" sends the agent re-deriving what this ledger
 * already knows.
 */
export function stalePrompt(threads) {
  const lines = [
    "Update these ticket descriptions to match what the session now knows.",
    "For each: read the ticket, fold in the change below, keep the existing",
    "structure, and do not restate the history of the edit.",
    "",
  ];
  for (const thread of threads) lines.push(`- ${thread.ticket} — ${thread.stale}`);
  const slugs = threads.map((thread) => thread.thread).join(" ");
  lines.push(
    "",
    "Then mark each one synced so the ledger stops flagging it:",
    `  for t in ${slugs}; do ledger append --ev synced --thread $t; done`,
  );
  return lines.join("\n");
}

export function filePrompt(thread, repo) {
  return (
    `File a ticket in ${repo} for the ledger thread "${thread.thread}": ` +
    `"${thread.title}". Use the session's context for the body. Then promote ` +
    `the thread: ledger append --ev promoted --thread ${thread.thread} ` +
    `--ticket ${repo}#<number>`
  );
}

// ----------------------------------------------------------- markdown

// GitHub renders Markdown on the repo page and sanitizes the HTML in
// it: `<details>`, tables and links survive; `<style>`, `<script>`,
// `class` and `style` do not. So this view carries no CSS and no script.
const BLOCKS = "▁▂▃▄▅▆▇█";

/**
 * A progress bar out of block glyphs.
 *
 * Plain text, so it survives sanitizing, renders in any font, and needs
 * no image host — which a private repo could not use anyway.
 */
export function bar(pct, width = 10) {
  const value = Math.max(0, Math.min(100, pct));
  const filled = Math.floor((value * width) / 100);
  const remainder = Math.floor((((value * width) % 100) * BLOCKS.length) / 100);
  let out = "█".repeat(filled);
  if (filled < width && remainder) out += BLOCKS[remainder - 1];
  // Pad with a light shade rather than blanks: an empty bar should read
  // as nothing done, not as a missing bar.
  return out + "░".repeat(width - [...out].length);
}

function mdLinks(text) {
  return String(text).replace(
    TICKET_RE,
    (match) => `[${match}](https://github.com/${match.replace("#", "/issues/")})`,
  );
}

function mdRef(thread, codes) {
  const ticket = thread.ticket;
  if (!ticket) return "`NO TICKET`";
  const cut = ticket.lastIndexOf("#");
  const [repo, number] = [ticket.slice(0, cut), ticket.slice(cut + 1)];
  const label = codes[repo] ?? repo;
  return `[\`${label}#${number}\`](https://github.com/${repo}/issues/${number})`;
}

/** The waiting-on cell: what holds the thread, and why. */
function mdState(thread) {
  if (thread.blocked) {
    const label = {
      principal: "**blocked · you**",
      internal: "blocked",
      external: "external",
    }[thread.blocked.on];
    return `${label} — ${mdLinks(thread.blocked.what)}`;
  }
  if (thread.parked) return `parked — trigger: ${mdLinks(thread.parked)}`;
  return "";
}

function counts(open, closed) {
  const onYou = open.filter((item) => item.blocked?.on === "principal").length;
  const waiting = open.filter((item) => item.blocked && item.blocked.on !== "principal").length;
  const parked = open.filter((item) => item.parked).length;
  return { onYou, waiting, parked, active: open.length - onYou - waiting - parked, done: closed.length };
}

/**
 * The ledger as Markdown, for GitHub to render on the repo page.
 *
 * A second VIEW of the same fold, never a second source: this and the
 * page both call `fold()`, so they cannot disagree about what is open.
 */
export function renderMarkdown(threads, title, nowMsg = null, codes = {}, generated = "", sessionUrl = null) {
  const open = orderOpen(threads);
  const closed = orderClosed(threads);
  const n = counts(open, closed);

  const lines = [
    "<!-- Generated by the thread-ledger skill. Edits here are",
    "     overwritten on the next push; the events in ledger/ are",
    "     the source. -->",
    "",
    `# ${title}`,
    "",
    `**${n.active} active · ${n.onYou} blocked on you · ${n.waiting} waiting · ` +
      `${n.parked} parked · ${n.done} done**`,
    "",
  ];
  if (generated) lines.push(`<sub>generated ${generated}</sub>`, "");

  lines.push("| | Thread | Waiting on |", "| --- | --- | --- |");
  for (const thread of open) {
    const indent = thread.depth ? "↳ " : "";
    // The title carries the link to the conversation the thread was
    // last touched in — per thread, because a ledger outlives any one
    // session and threads get picked up in later ones.
    let titleText = thread.title ?? thread.thread;
    const url = thread.url ?? sessionUrl;
    if (url) titleText = `[${titleText}](${url})`;
    let cell = `${indent}${mdRef(thread, codes)} ${titleText}`;
    if (thread.note) {
      cell += `<details><summary>note</summary>${mdLinks(thread.note)}</details>`;
    }
    lines.push(`| \`${bar(thread.pct ?? 0)}\` | ${cell} | ${mdState(thread)} |`);
  }

  if (closed.length) {
    lines.push("", "---", "", "### Done", "");
    for (const thread of closed) {
      const mark = thread.state === "completed" ? "x" : " ";
      let text = thread.title ?? thread.thread;
      if (thread.state === "dropped") text = `~~${text}~~`;
      const url = thread.url ?? sessionUrl;
      if (url) text = `[${text}](${url})`;
      const suffix = thread.note ? ` — ${thread.note}` : "";
      lines.push(`- [${mark}] ${mdRef(thread, codes)} ${text}${suffix}`);
    }
  }
  return lines.join("\n") + "\n";
}

// --------------------------------------------------------------- page

/** The card's state, as a class the border and pill both read. */
function stateClass(thread) {
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
function pill(label, why) {
  return `<span class="pill" title="${esc(why)}">${esc(label)}</span>`;
}

function pills(thread) {
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
function anchorHtml(thread, nowMsg) {
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

function ticketPrefix(ticket, codes) {
  if (!ticket) return "";
  const cut = ticket.lastIndexOf("#");
  if (cut < 0) return "";
  const [repo, number] = [ticket.slice(0, cut), ticket.slice(cut + 1)];
  const label = codes[repo] ?? repo;
  const url = `https://github.com/${repo}/issues/${number}`;
  return `<a class="ref" href="${esc(url)}">${esc(label)}#${esc(number)}</a> `;
}

/**
 * Where the ticket link would be, for a thread that has none.
 *
 * Choosing a repo copies a prompt rather than writing anything: the page
 * is a view, and a control that appeared to file a ticket while the
 * store stayed unchanged would be exactly the kind of mechanism whose
 * success and failure look alike.
 */
function ticketPicker(thread, codes) {
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
function sessionLink(text, url) {
  if (!url) return esc(text);
  return `<a class="tlink" href="${esc(url)}" target="_blank" rel="noreferrer">${esc(text)}</a>`;
}

/**
 * The thread's title, as text in the markup.
 *
 * The middle truncation is an enhancement applied after paint; the text
 * itself is written here, so a row is readable the instant it exists.
 */
function titleHtml(title, detail, url) {
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
function promptPopover(summaryHtml, prompt, label) {
  return (
    `<details class="pop">${summaryHtml}` +
    `<div class="pop-body"><div class="pop-head">${esc(label)}` +
    `<span class="pop-acts"><button class="cp" type="button">copy</button>` +
    `<button class="x" type="button" title="close">×</button></span></div>` +
    `<textarea class="pop-text" readonly rows="7" spellcheck="false">${esc(prompt)}</textarea>` +
    `</div></details>`
  );
}

/** The marker beside the anchor: this ticket is behind. */
function stalePill(thread) {
  if (!thread.stale) return "";
  const summary = `<summary class="info" title="ticket is behind: ${esc(thread.stale)}">i</summary>`;
  return promptPopover(summary, singlePrompt(thread), `update ${thread.ticket}`);
}

function openRow(thread, nowMsg, codes, sessionUrl) {
  const muted = thread.blocked || thread.parked ? " muted" : "";
  const depth = thread.depth ? " child" : "";
  const pct = thread.pct ?? 0;
  const title = thread.title ?? thread.thread;
  const note = thread.note ?? "";
  const detail = note ? `${title}\n\n${pct}% — ${note}` : `${title}\n\n${pct}%`;
  const ref = thread.ticket
    ? ticketPrefix(thread.ticket, codes)
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

/** The severity tier as a class, or nothing — the quiet default. */
function tierClass(thread) {
  const tier = tierOf(thread);
  return tier ? ` t-${tier}` : "";
}

/** Which sessions built this row, for the page's session filter. */
function sessionsAttr(thread) {
  if (!thread.sessions?.length) return "";
  return ` data-sessions="${esc(thread.sessions.join(" "))}"`;
}

function closedRow(thread, nowMsg, codes, sessionUrl) {
  const dropped = thread.state === "dropped";
  const mark = dropped ? "☐" : "☑";
  const note = thread.note ?? "";
  const label = dropped ? "dropped" : "done";
  const title = thread.title ?? thread.thread;
  return (
    `<li class="thread closed ${label}"${sessionsAttr(thread)}>` +
    `<span class="mark">${mark}</span>` +
    `<span class="title">${ticketPrefix(thread.ticket, codes)}` +
    `${sessionLink(title, thread.url ?? sessionUrl)}</span>` +
    anchorHtml(thread, nowMsg) +
    (note ? `<span class="note">${linkify(note)}</span>` : "") +
    `</li>`
  );
}

/**
 * Counts first, detail after — what needs the principal leads.
 *
 * A tool is scanned, not read, so the state that only a human can clear
 * is the one the eye should land on.
 */
function summary(open, closed) {
  const n = counts(open, closed);
  const stats = [
    ["active", n.active, ""],
    ["blocked on you", n.onYou, " you"],
    ["waiting", n.waiting, ""],
    ["parked", n.parked, ""],
    ["done", n.done, ""],
  ];
  let cells = stats
    .filter(([label, count]) => count || label === "active")
    .map(([label, count, extra]) => `<span class="stat${extra}"><b>${count}</b> ${esc(label)}</span>`)
    .join("");
  const outdated = open.filter((item) => item.stale);
  if (outdated.length) {
    const head =
      `<summary class="stat outdated" id="sync-all">` +
      `<b>${outdated.length}</b> tickets outdated</summary>`;
    cells += promptPopover(head, stalePrompt(outdated), `update ${outdated.length} tickets`);
  }
  return `<div class="summary">${cells}</div>`;
}

// ---------------------------------------------------------- stretches

/** How many of a session's newest stretch rows show before folding. */
const RECENT_STRETCHES = 12;

/** A compact count: 950, 12.6k, 3.4M. */
export function fmtTokens(value) {
  if (value < 1000) return String(value);
  if (value < 1e6) return `${(value / 1000).toFixed(1).replace(/\.0$/, "")}k`;
  return `${(value / 1e6).toFixed(1).replace(/\.0$/, "")}M`;
}

/** A compact wall-clock span: 45s, 12m, 1h05. */
export function fmtSpan(ms) {
  const minutes = Math.round(ms / 60000);
  if (minutes < 1) return `${Math.round(ms / 1000)}s`;
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h${String(minutes % 60).padStart(2, "0")}`;
}

const sum = (values) => values.reduce((total, value) => total + value, 0);

/** The digest's headline number — the four components together. */
function totalTokens(digest) {
  const tokens = digest?.tokens;
  if (!tokens) return null;
  return tokens.input + tokens.output + tokens.cacheRead + tokens.cacheCreation;
}

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * The ×-multiplier against the session's own median, or nothing.
 *
 * Same-session median rather than a global yardstick: it controls for
 * model and task mix, and resists the outliers it exists to flag. Under
 * three data points a median is mostly noise, so nothing renders.
 */
function multiplier(value, mid, count) {
  if (mid === null || mid <= 0 || count < 3 || value === null) return "";
  const factor = value / mid;
  const hot = factor >= 1.5 ? " hot" : "";
  return ` <span class="mult${hot}">×${factor.toFixed(1)}</span>`;
}

/** Reminder round-trips in a digest — blocked executions. */
const remindersOf = (digest) => digest?.executions?.blocked ?? 0;
/** Blocks the model saw and still did not finish after. */
const gaveUpsOf = (digest) => digest?.executions?.unsealed ?? 0;

function plural(count, noun) {
  if (count === 1) return `${count} ${noun}`;
  return `${count} ${noun.endsWith("h") ? `${noun}es` : `${noun}s`}`;
}

/** The fired checks, each marked when its reminder was ignored. */
function checksHtml(digest) {
  const parts = Object.entries(digest.checks ?? {}).map(([name, row]) => {
    const ignored = row.ignored ? ` <span class="gaveup">ignored×${row.ignored}</span>` : "";
    return `${esc(name)}${ignored}`;
  });
  if (!parts.length) return "";
  return `<span class="schecks">${parts.join(", ")}</span>`;
}

/** One stretch as a thin rule: when, what, friction, cost. */
function stretchRow(stretch, medians) {
  const digest = stretch.digest;
  const reminders = remindersOf(digest);
  const gaveUps = gaveUpsOf(digest);
  const cls = gaveUps ? " st-gaveup" : reminders ? " st-remind" : "";

  const parts = [];
  const clock = stretch.at ? stretch.at.slice(11, 16) : "";
  const msg = stretch.seal.anchor?.msg;
  const where = `${clock}${msg !== undefined ? ` #${msg}` : ""}`.trim();
  const url = stretch.seal.anchor?.url;
  parts.push(
    url
      ? `<a class="anchor" href="${esc(url)}" target="_blank" rel="noreferrer">${esc(where)}</a>`
      : `<span class="anchor">${esc(where)}</span>`,
  );
  parts.push(`<span class="sthreads">${esc(stretch.threads.join(" · ")) || "—"}</span>`);
  if (digest) {
    parts.push(checksHtml(digest));
    if (reminders) parts.push(`<span class="remind">${plural(reminders, "reminder")}</span>`);
    if (gaveUps) parts.push(`<span class="gaveup">gave up ×${gaveUps}</span>`);
    const tokens = totalTokens(digest);
    if (tokens === null) {
      parts.push(
        `<span class="gap" title="a counter reset (compaction) inside this ` +
          `stretch — its cost is unknown, not zero">gap</span>`,
      );
    } else {
      parts.push(
        `<span>${fmtTokens(tokens)} tok${multiplier(tokens, medians.tokens, medians.count)}</span>`,
      );
    }
  }
  if (stretch.spanMs !== null) {
    parts.push(
      `<span>${fmtSpan(stretch.spanMs)}${multiplier(stretch.spanMs, medians.span, medians.count)}</span>`,
    );
  }
  return `<li class="stretch${cls}">${parts.filter(Boolean).join("")}</li>`;
}

/**
 * The rows of one session's stretch list, oldest first.
 *
 * Digest-less seals predate the field; each run of them collapses to
 * one line rather than a wall of empty rules — they stay countable
 * without burying the stretches that carry data.
 */
function stretchItems(entry, medians) {
  const items = [];
  let legacy = 0;
  const flush = () => {
    if (!legacy) return;
    items.push(
      `<li class="stretch legacy">${plural(legacy, "stretch")} · no digest</li>`,
    );
    legacy = 0;
  };
  for (const stretch of entry.stretches) {
    if (!stretch.digest) {
      legacy += 1;
      continue;
    }
    flush();
    items.push(stretchRow(stretch, medians));
  }
  flush();
  if (entry.tail) {
    items.push(
      `<li class="stretch tail">unsealed tail · ` +
        `${esc(entry.tail.threads.join(" · ")) || plural(entry.tail.count, "event")}</li>`,
    );
  }
  return items;
}

/** A session's aggregate line: how the whole session went, in one scan. */
function rollupHtml(entry) {
  const digests = entry.stretches.map((stretch) => stretch.digest).filter(Boolean);
  const parts = [];
  if (digests.length) {
    const turns = sum(digests.map((digest) => digest.turns));
    parts.push(`<span><b>${plural(turns, "turn")}</b></span>`);
    const clean = digests.filter((digest) => !remindersOf(digest) && !gaveUpsOf(digest)).length;
    parts.push(`<span><b>${Math.round((clean / digests.length) * 100)}%</b> clean</span>`);
    const reminders = sum(digests.map(remindersOf));
    if (reminders) parts.push(`<span class="remind"><b>${reminders}</b> reminders</span>`);
    const gaveUps = sum(digests.map(gaveUpsOf));
    if (gaveUps) parts.push(`<span class="gaveup"><b>${gaveUps}</b> gave up</span>`);
    const totals = digests.map(totalTokens).filter((value) => value !== null);
    if (totals.length) parts.push(`<span><b>${fmtTokens(sum(totals))}</b> tok</span>`);
    const gaps = digests.length - totals.length;
    if (gaps) parts.push(`<span class="gap">${plural(gaps, "gap")}</span>`);
  }
  const spans = entry.stretches.map((stretch) => stretch.spanMs).filter((ms) => ms !== null);
  if (spans.length) parts.push(`<span><b>${fmtSpan(sum(spans))}</b></span>`);
  const legacy = entry.stretches.length - digests.length;
  if (legacy) parts.push(`<span>${plural(legacy, "stretch")} · no digest</span>`);
  return `<div class="rollup">${parts.join("")}</div>`;
}

/** One session's block: rollup always, rules behind a disclosure. */
function sessionBlock(entry, current) {
  const digested = entry.stretches.filter((stretch) => stretch.digest);
  const medians = {
    count: digested.length,
    tokens: median(
      digested.map((stretch) => totalTokens(stretch.digest)).filter((value) => value !== null),
    ),
    span: median(entry.stretches.map((stretch) => stretch.spanMs).filter((ms) => ms !== null)),
  };
  const items = stretchItems(entry, medians);
  const recent = items.slice(-RECENT_STRETCHES);
  const older = items.slice(0, -RECENT_STRETCHES);
  const folded = older.length
    ? `<details class="older"><summary>earlier stretches (${older.length})</summary>` +
      `<ol class="stretchlist">${older.join("")}</ol></details>`
    : "";
  return (
    `<div class="sess" data-session="${esc(entry.session)}">${rollupHtml(entry)}` +
    `<details class="rules"${current ? " open" : ""}>` +
    `<summary>${plural(entry.stretches.length, "stretch")} — ${esc(entry.session)}</summary>` +
    folded +
    `<ol class="stretchlist">${recent.join("")}</ol>` +
    `</details></div>`
  );
}

/** The session this render belongs to, for the pre-selected chip. */
function currentSession(sessions, sessionUrl) {
  if (sessionUrl) {
    try {
      const name = sessionFromUrl(sessionUrl);
      if (sessions.some((entry) => entry.session === name)) return name;
    } catch {
      // A URL that names no session falls through to the newest one.
    }
  }
  return sessions[0]?.session ?? null;
}

/**
 * The sessions section: chips to pick a session, stretches beneath.
 *
 * Replaces the old session dropdown — one selector, both roles: a chip
 * shows its session's stretches AND filters the thread lists below
 * (wired in page.mjs; the markup is inert without the script, and every
 * block stays readable because visibility is the script's only job).
 */
function stretchesSection(events, sessionUrl) {
  const sessions = stretchesOf(events);
  if (!sessions.some((entry) => entry.stretches.length)) return "";
  const current = currentSession(sessions, sessionUrl);
  const chips = [
    `<button class="chip" data-session="" type="button">all</button>`,
    ...sessions.map(
      (entry) =>
        `<button class="chip${entry.session === current ? " on" : ""}" ` +
        `data-session="${esc(entry.session)}" type="button">${esc(entry.session)}</button>`,
    ),
  ];
  return (
    `<section class="sessions"><div class="chips">${chips.join("")}</div>` +
    sessions.map((entry) => sessionBlock(entry, entry.session === current)).join("") +
    `</section>`
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
export function renderBody(threads, title, nowMsg = null, codes = {}, sessionUrl = null, events = []) {
  const open = orderOpen(threads);
  const closed = orderClosed(threads);
  return (
    `<header><h1>${esc(title)}</h1>${summary(open, closed)}` +
    `</header>` +
    stretchesSection(events, sessionUrl) +
    `<main><ol class="threads">` +
    open.map((thread) => openRow(thread, nowMsg, codes, sessionUrl)).join("") +
    `</ol><hr><ol class="threads done">` +
    closed.map((thread) => closedRow(thread, nowMsg, codes, sessionUrl)).join("") +
    `</ol></main>`
  );
}
