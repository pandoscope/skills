// The diligence section — what the reminders cost, per stretch.
//
// A stretch is the span between two seals, and the numbers here are
// projections of the compliance records rather than claims typed beside
// them. Header contract: `../views.mjs`.

import { sessionFromUrl, stretchesOf } from "../core.mjs";
import { esc, plural } from "./html.mjs";
import { summary } from "./summary.mjs";

// ---------------------------------------------------------- stretches

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


/** A stretch list's aggregate numbers, shared by every head. */
function totalsText(stretches) {
  const digests = stretches.map((stretch) => stretch.digest).filter(Boolean);
  const parts = [];
  if (digests.length) {
    parts.push(plural(sum(digests.map((digest) => digest.turns)), "turn"));
    const clean = digests.filter((digest) => !remindersOf(digest) && !gaveUpsOf(digest)).length;
    parts.push(`${Math.round((clean / digests.length) * 100)}% clean`);
    const reminders = sum(digests.map(remindersOf));
    if (reminders) parts.push(plural(reminders, "reminder"));
    const gaveUps = sum(digests.map(gaveUpsOf));
    if (gaveUps) parts.push(`gave up ×${gaveUps}`);
    const totals = digests.map(totalTokens).filter((value) => value !== null);
    if (totals.length) parts.push(`${fmtTokens(sum(totals))} tok`);
    const gaps = digests.length - totals.length;
    if (gaps) parts.push(plural(gaps, "gap"));
  }
  const spans = stretches.map((stretch) => stretch.spanMs).filter((ms) => ms !== null);
  if (spans.length) parts.push(fmtSpan(sum(spans)));
  const legacy = stretches.length - digests.length;
  if (legacy) parts.push(`${plural(legacy, "stretch")} · no digest`);
  return parts.join(" · ");
}


/** The short form of a session id: its distinguishing tail. */
function shortId(session) {
  return session.length <= 14 ? session : `…${session.slice(-6)}`;
}


/** The overview pseudo-session: every stretch, in stamp order. */
function overviewEntry(sessions) {
  const stretches = sessions
    .flatMap((entry) => entry.stretches)
    .sort((a, b) => ((a.at ?? "") < (b.at ?? "") ? -1 : 1));
  return { session: "", stretches, tail: null };
}


/** What an entry is called: its name sidecar, its id tail, or "all". */
function labelOf(entry, names) {
  if (entry.session === "") return "all sessions";
  return names[entry.session] ?? shortId(entry.session);
}


/**
 * One head: identity plus totals, shown only while selected.
 *
 * Every entry's head is in the markup and the script swaps which one
 * shows, so picking a session never recomputes anything — the numbers
 * a head carries were all rendered from the same fold.
 */
function sessionHead(entry, names, on) {
  const named = entry.session !== "" && names[entry.session];
  const id = named ? `<span class="sid">${esc(shortId(entry.session))}</span>` : "";
  const title = entry.session === "" ? "every session" : entry.session;
  return (
    `<span class="sesshead${on ? " on" : ""}" data-session="${esc(entry.session)}"` +
    ` title="${esc(title)}"><b class="sname">${esc(labelOf(entry, names))}</b>${id}` +
    `<span class="stotals">${esc(totalsText(entry.stretches))}</span></span>`
  );
}


/** One dropdown row: name, id, and the entry's totals at a glance. */
function sessionOption(entry, names) {
  const id = entry.session === "" ? "" : `<span class="oid">${esc(entry.session)}</span>`;
  return (
    `<li><button class="opt" data-session="${esc(entry.session)}" type="button">` +
    `<b>${esc(labelOf(entry, names))}</b>${id}` +
    `<span class="ototals">${esc(totalsText(entry.stretches))}</span></button></li>`
  );
}


/**
 * One entry's block: the last seal in the open, the run behind one
 * expand. The tail — a turn whose bookkeeping never finished — stays
 * beside the last seal, never folded: it is the row that most needs a
 * reader.
 */
function sessionBlock(entry) {
  const digested = entry.stretches.filter((stretch) => stretch.digest);
  const medians = {
    count: digested.length,
    tokens: median(
      digested.map((stretch) => totalTokens(stretch.digest)).filter((value) => value !== null),
    ),
    span: median(entry.stretches.map((stretch) => stretch.spanMs).filter((ms) => ms !== null)),
  };
  let rows = stretchItems(entry, medians);
  let tailRow = "";
  if (entry.tail) {
    tailRow = rows[rows.length - 1];
    rows = rows.slice(0, -1);
  }
  const visible = rows.slice(-1);
  const folded = rows.slice(0, -1);
  const expand = folded.length
    ? `<details class="allseals"><summary>all ${entry.stretches.length} stretches</summary>` +
      `<ol class="stretchlist">${folded.join("")}</ol></details>`
    : "";
  return (
    `<div class="sess" data-session="${esc(entry.session)}">${expand}` +
    `<ol class="stretchlist">${visible.join("")}${tailRow}</ol></div>`
  );
}


/** The session this render belongs to, for the preselected chip. */
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
export function stretchesSection(events, sessionUrl, diligence, names) {
  const sessions = stretchesOf(events, diligence);
  if (!sessions.some((entry) => entry.stretches.length)) return "";
  const current = currentSession(sessions, sessionUrl);
  const entries = [overviewEntry(sessions), ...sessions];
  const heads = entries
    .map((entry) => sessionHead(entry, names, entry.session === current))
    .join("");
  const options = entries.map((entry) => sessionOption(entry, names)).join("");
  return (
    `<section class="sessions"><details class="picker">` +
    `<summary>${heads}<span class="caret">▾</span></summary>` +
    `<ul class="options">${options}</ul></details>` +
    entries.map((entry) => sessionBlock(entry)).join("") +
    `</section>`
  );
}
