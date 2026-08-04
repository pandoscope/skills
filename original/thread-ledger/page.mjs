// Thread ledger — what runs in the browser.
//
// The page is handed raw events and folds them here, with the same
// `core.mjs` the recorder validates against and the Markdown view reads.
// Nothing about a thread's state is computed twice.
//
// Raw events also mean the page can gain filters and trajectory views
// without a re-render, and can eventually read its events from a server
// instead of carrying them inline.

import { fold } from "./core.mjs";
import { esc, filePrompt, renderBody } from "./views.mjs";

const EDGE = 8;
const LOG = [];

/**
 * Boot: fold, render, wire.
 *
 * Any throw lands in the crash banner rather than a blank page. The
 * banner is in the markup already — this only ever *removes* it, so a
 * script that never runs leaves the failure showing rather than nothing.
 */
export function boot(root = document) {
  const data = readData(root);
  const threads = fold(data.events);
  root.getElementById("view").innerHTML = renderBody(
    threads,
    data.title,
    data.now_msg ?? null,
    data.codes ?? {},
    data.session_url ?? null,
  );
  root.getElementById("crash")?.remove();
  wireSessionFilter(root);
  wire(root);
  fitAll(root);
  paint(root);
  setInterval(() => paint(root), 60000);
  diag(root);
}

/**
 * Hide rows the chosen session never touched.
 *
 * Pure show/hide over data-sessions — the fold, the ordering and the
 * summary stay those of the whole store, so what the filter changes is
 * visibility, never truth. Rows without the attribute (threads whose
 * events carry no anchors) stay visible under every filter: absence of
 * provenance must not read as absence of work.
 */
function wireSessionFilter(root) {
  const control = root.getElementById("session-filter");
  if (!control) return;
  control.addEventListener("change", () => {
    const wanted = control.value;
    for (const row of root.querySelectorAll(".thread")) {
      const from = row.getAttribute("data-sessions");
      row.style.display =
        !wanted || !from || from.split(" ").includes(wanted) ? "" : "none";
    }
  });
}

function readData(root) {
  const node = root.getElementById("ledger-data");
  if (!node) throw new Error("no embedded ledger data");
  return JSON.parse(node.textContent);
}

// ------------------------------------------------------------- times

/**
 * Relative times are computed here, not baked in, so the page stays
 * truthful however long it sits open or unpublished.
 */
export function rel(iso, now = Date.now()) {
  const mins = Math.round((now - new Date(iso)) / 60000);
  if (!Number.isFinite(mins)) return "";
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs} h ago`;
  return `${Math.round(hrs / 24)} d ago`;
}

function paint(root) {
  for (const el of root.querySelectorAll(".anchor")) {
    const at = el.dataset.at;
    if (at) el.querySelector(".rel").textContent = rel(at);
  }
}

// --------------------------------------------------------- truncation

/**
 * Middle truncation, by binary search on the rendered width. The tail of
 * a title carries as much as its head — "…recorder, exporter" says more
 * than a cut that keeps only the opening words.
 */
function fit(el) {
  const full = el.dataset.full || "";
  el.textContent = full;
  if (el.scrollWidth <= el.clientWidth) return;
  let lo = 0;
  let hi = full.length;
  const set = (n) => {
    const head = Math.ceil(n / 2);
    const tail = n - head;
    el.textContent = full.slice(0, head) + "…" + (tail ? full.slice(full.length - tail) : "");
  };
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    set(mid);
    if (el.scrollWidth <= el.clientWidth) lo = mid;
    else hi = mid - 1;
  }
  set(lo);
}

function fitAll(root) {
  for (const el of root.querySelectorAll(".ttl")) fit(el);
}

// ---------------------------------------------------------- clipboard

// Measured in the published frame: the async clipboard is blocked by
// permissions policy (NotAllowedError) while execCommand succeeds. So
// the first refusal is remembered and the async path is skipped from
// then on — retrying it every click only logs the same rejection and
// puts a console error under each copy.
let asyncBlocked = false;

function legacyCopy(text) {
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.setAttribute("readonly", "");
  ta.style.cssText = "position:fixed;top:0;left:0;opacity:0";
  document.body.append(ta);
  ta.select();
  ta.setSelectionRange(0, text.length);
  let done = false;
  try {
    done = document.execCommand("copy");
  } catch {
    done = false;
  }
  ta.remove();
  return done;
}

function say(text) {
  const box = document.createElement("div");
  box.className = "copied";
  box.textContent = text;
  box.setAttribute("role", "status");
  document.body.append(box);
  setTimeout(() => box.remove(), 4000);
}

/**
 * Copy, logging every branch.
 *
 * A click that reports success while the clipboard is untouched is the
 * failure being hunted, so "async resolved" is recorded as what it is —
 * a promise resolving, not a verified paste.
 */
async function copy(text, ok) {
  if (!asyncBlocked) {
    try {
      await navigator.clipboard.writeText(text);
      LOG.push("  async: resolved");
      diag();
      say(ok);
      return;
    } catch (err) {
      asyncBlocked = err?.name === "NotAllowedError";
      LOG.push(`  async: threw ${err?.name} ${err?.message}`);
    }
  }
  if (legacyCopy(text)) {
    LOG.push("  execCommand: returned true");
    diag();
    say(ok);
    return;
  }
  LOG.push("  execCommand: returned false");
  diag();
  say("Copy was blocked — select the text in the box instead.");
}

// ----------------------------------------------------------- popovers

/**
 * Keep an open box inside the window.
 *
 * Absolute placement anchors it to its row, which puts it off the right
 * edge in a narrow window and off the bottom for a row near the fold — a
 * panel whose copy button is outside the viewport is a control that
 * cannot be reached. Fixed coordinates computed from the summary and
 * clamped are immune to both, and to any clipping ancestor.
 */
function place(pop) {
  const body = pop.querySelector(".pop-body");
  const sum = pop.querySelector("summary");
  if (!body || !sum) return;
  body.style.position = "fixed";
  body.style.right = "auto";
  body.style.left = "0px";
  body.style.top = "0px";
  const want = Math.min(body.offsetWidth, innerWidth - 2 * EDGE);
  body.style.width = `${want}px`;
  const anchor = sum.getBoundingClientRect();
  const left = Math.min(anchor.right - want, innerWidth - EDGE - want);
  body.style.left = `${Math.max(EDGE, left)}px`;
  const high = body.offsetHeight;
  let top = anchor.bottom + 6;
  if (top + high > innerHeight - EDGE) top = anchor.top - 6 - high;
  body.style.top = `${Math.max(EDGE, top)}px`;
}

function placeOpen(root) {
  for (const pop of root.querySelectorAll("details.pop[open]")) place(pop);
}

function wire(root) {
  for (const pop of root.querySelectorAll("details.pop")) {
    pop.addEventListener("toggle", () => {
      if (pop.open) place(pop);
    });
  }
  addEventListener("scroll", () => placeOpen(root), { passive: true });
  addEventListener("resize", () => {
    clearTimeout(window._f);
    window._f = setTimeout(() => {
      fitAll(root);
      placeOpen(root);
    }, 80);
  });

  // One handler for every copy button, and the text it copies is the
  // text the box shows — the button cannot copy something different from
  // what the reader can select by hand.
  for (const b of root.querySelectorAll(".cp")) {
    b.addEventListener("click", (e) => {
      e.preventDefault();
      const box = e.currentTarget.closest(".pop-body").querySelector(".pop-text");
      if (!box) {
        LOG.push("  no text box found for this button");
        diag();
        return;
      }
      if (box.id === "diag") box.value = diagText(root);
      const pop = e.currentTarget.closest("details");
      copy(box.value, "Copied — paste it into the session.").then(() => {
        // Copying is the reason the box was opened, so it closes itself.
        if (pop) pop.open = false;
      });
    });
  }
  for (const b of root.querySelectorAll(".x")) {
    b.addEventListener("click", (e) => {
      e.preventDefault();
      e.currentTarget.closest("details").open = false;
    });
  }
  // The other two ways out: click anywhere else, or press Escape. A
  // disclosure with no marker gives no hint that its summary toggles.
  addEventListener("click", (e) => {
    for (const pop of root.querySelectorAll("details.pop[open]")) {
      if (!pop.contains(e.target)) pop.open = false;
    }
  });
  addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    for (const pop of root.querySelectorAll("details[open].pop,details[open].diag")) {
      pop.open = false;
    }
  });

  // Choosing a repo copies an instruction; it writes nothing. The page
  // is a view, and a control that looked like it filed a ticket while
  // the store stayed unchanged would be a lie told in one click.
  for (const sel of root.querySelectorAll(".pick")) {
    sel.addEventListener("change", async (e) => {
      const repo = e.target.value;
      if (!repo) return;
      const thread = { thread: e.target.dataset.thread, title: e.target.dataset.title };
      await copy(filePrompt(thread, repo), "Prompt copied — paste it into the session.");
      e.target.value = "";
    });
  }
}

/**
 * Write text into a textarea so it survives being saved or dumped.
 *
 * Setting `.value` alone changes what the reader sees but leaves the
 * markup carrying the old text, so a saved page reports "the script did
 * not run" about a script that ran and threw.
 */
function setBox(el, text) {
  if (!el) return;
  el.value = text;
  el.textContent = text;
}

// -------------------------------------------------------- diagnostics

/**
 * Everything here is a measurement of THIS environment: the page is
 * published into a frame that cannot be reproduced locally, so the page
 * has to report on itself.
 */
export function diagText(root = document) {
  return [
    "script: RAN",
    `url: ${location.href}`,
    `secureContext: ${window.isSecureContext}`,
    `navigator.clipboard: ${navigator.clipboard ? "present" : "ABSENT"}`,
    `execCommand: ${document.execCommand ? "present" : "ABSENT"}`,
    `sandboxed frame: ${window.top !== window.self}`,
    `threads rendered: ${root.querySelectorAll(".thread").length}`,
    "",
    "attempts:",
    ...(LOG.length ? LOG : ["  (none yet — click a copy button, then copy this)"]),
  ].join("\n");
}

function diag(root = document) {
  setBox(root.getElementById?.("diag") ?? document.getElementById("diag"), diagText(root));
}

/**
 * The crash banner's contents.
 *
 * Written into the page as the DEFAULT state and removed on a
 * successful boot, because a script that fails to parse never reaches
 * its own error handler — the only reliable failure report is the one
 * that was already there.
 */
export function crashPrompt(detail) {
  return [
    "The thread-ledger page failed to render. Debug it.",
    "",
    "The page folds raw events in the browser using core.mjs and",
    "views.mjs, both inlined into the published HTML. It renders into",
    "#view; the banner you are reading is removed on a successful boot.",
    "",
    "Error:",
    detail || "  none captured — the script did not run at all.",
    "",
    "The events are in the #ledger-data script block on the page.",
  ].join("\n");
}

if (typeof window !== "undefined") {
  addEventListener("error", (e) => {
    LOG.push(`  ERROR ${e.message || e.type} @ ${e.filename || "?"}:${e.lineno || "?"}`);
    setBox(
      document.getElementById("crash-text"),
      crashPrompt(`  ${e.message} @ line ${e.lineno}`),
    );
    setBox(document.getElementById("diag"), diagText());
  });
}

export { esc };
