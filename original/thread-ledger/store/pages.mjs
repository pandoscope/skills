// The published page — a shell, the raw events, and the fold itself.
//
// The page cannot fetch anything, so the browser gets the same source
// files the recorder runs, textually inlined. One copy on disk, one
// copy in the page, no second implementation. Header contract:
// `../ledger.mjs`.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { CSS, esc } from "../views.mjs";

// The skill directory, one level up: the sources bundled below sit
// beside `ledger.mjs`, not beside this file.
const SKILL = path.dirname(path.dirname(fileURLToPath(import.meta.url)));


// -------------------------------------------------------------- pages

/**
 * Inline the modules into one classic script.
 *
 * The published page cannot fetch anything — a strict CSP blocks every
 * external host — so the browser gets the same source files, textually.
 * One copy on disk, one copy in the page, no second implementation.
 */
function bundle() {
  // `core.mjs` is a barrel: stripping its module syntax would leave
  // nothing, so its parts are named here, in dependency order.
  const sources = [
    "core/schema.mjs",
    "core/transcript.mjs",
    "core/forge.mjs",
    "core/state.mjs",
    "core/validate.mjs",
    "core/measures.mjs",
    "core/workflow.mjs",
    "views/css.mjs",
    "views/html.mjs",
    "views/prompts.mjs",
    "views/summary.mjs",
    "views/markdown.mjs",
    "views/stretches.mjs",
    "views/rows.mjs",
    "page.mjs",
  ].map((name) =>
    fs
      .readFileSync(path.join(SKILL, name), "utf8")
      .replace(/^import[\s\S]*?;\n/gm, "")
      .replace(/^export \{[^}]*\};?\n/gm, "")
      .replace(/^export /gm, ""),
  );
  return `${sources.join("\n")}\nboot();\n`;
}


/**
 * The published page: a shell, the raw events, and the code that folds
 * them.
 *
 * No rendered rows. The page computes its own state from the events, so
 * the file carries each fact once and filters or graphs added later work
 * on the data rather than on markup.
 */
export function renderPage(events, title, nowMsg, codes, sessionUrl, diligence = [], names = {}, forge = {}, staleNote = null) {
  // `</` inside the payload would close the script element early and let
  // a thread title inject markup. The escape is invisible to JSON.parse,
  // so the embedded data stays byte-faithful.
  const payload = JSON.stringify({
    events,
    codes: codes ?? {},
    title,
    now_msg: nowMsg ?? null,
    session_url: sessionUrl ?? null,
    diligence,
    names,
    forge: forge ?? {},
  }).replace(/<\//g, "<\\/");

  // The crash banner is the DEFAULT content, removed on a successful
  // boot. A script that fails to parse never reaches its own error
  // handler, so the only reliable failure report is one that was already
  // in the markup.
  const crash =
    `<div id="crash"><h1>${esc(title)} — render failed</h1>` +
    `<p>The page could not build itself from its events. Nothing here is ` +
    `stale data: it is no data.</p>` +
    `<div class="pop-body"><div class="pop-head">paste this to debug` +
    `<span class="pop-acts"><button class="cp" type="button">copy</button></span></div>` +
    `<textarea class="pop-text" id="crash-text" readonly rows="12" spellcheck="false">` +
    `${esc(crashPromptDefault())}</textarea></div></div>`;

  // Static markup on purpose: the banner must survive whatever the
  // page's own script does, because it reports on the data the script
  // is about to fold.
  const stale = staleNote ? `<div id="stale">⚠ ${esc(staleNote)}</div>\n` : "";

  return (
    `<title>${esc(title)}</title>\n<style>${CSS}${CRASH_CSS}${STALE_CSS}</style>\n` +
    `${stale}<div id="view"></div>\n${crash}\n` +
    `<details class="diag"><summary>diagnostics</summary>` +
    `<div class="pop-body"><div class="pop-head">paste this back` +
    `<span class="pop-acts"><button class="cp" type="button">copy</button></span></div>` +
    `<textarea class="pop-text" id="diag" readonly rows="10" spellcheck="false">` +
    `script: DID NOT RUN\nNothing below was measured. The page's script never ` +
    `executed, so every control on this page is inert. That alone is the ` +
    `answer.</textarea></div></details>\n` +
    `<script type="application/json" id="ledger-data">${payload}</script>\n` +
    `<script>${bundle()}</script>\n`
  );
}


function crashPromptDefault() {
  return [
    "The thread-ledger page failed to render. Debug it.",
    "",
    "The page folds raw events in the browser using core.mjs and",
    "views.mjs, both inlined into the published HTML. It renders into",
    "#view; the banner you are reading is removed on a successful boot.",
    "",
    "Error:",
    "  none captured — the script did not run at all.",
    "",
    "The events are in the #ledger-data script block on the page.",
  ].join("\n");
}


const STALE_CSS = `
#stale{max-width:60rem;margin:.75rem auto 0;padding:.5rem .9rem;
  border:1px solid var(--wait);border-radius:8px;color:var(--wait);
  font-size:.85rem}
`;


const CRASH_CSS = `
#crash{max-width:52rem;margin:3rem auto;padding:1.25rem;border-radius:10px;
  border:1px solid var(--wait);background:var(--panel)}
#crash h1{font-size:1.1rem;margin:0 0 .5rem;color:var(--wait)}
#crash p{margin:0 0 .9rem;color:var(--dim);font-size:.9rem}
#crash .pop-body{position:static;width:auto}
`;
