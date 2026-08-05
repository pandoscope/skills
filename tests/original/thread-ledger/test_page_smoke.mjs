// Smoke-render the ledger page in a real browser.
//
// The unit suite validates data and structure, and three defects
// shipped through it green in one afternoon — a NUL byte that killed
// the whole stylesheet, an overflow that clipped every popup, a fitter
// that was defined and never called. One shape: the page was
// structurally perfect and visually broken. Assertions over HTML
// strings cannot see that, so this file loads the page headless and
// asserts COMPUTED state — what a viewer sees, not what the file says.
//
// The page is rendered through `ledger.mjs render`, the shipped entry
// path, not through imported functions. The fourth instance of the
// green-suite class (#54) was a CLI grammar change no test exercised
// because every test called the functions directly.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const SKILL = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../original/thread-ledger",
);

// ------------------------------------------------------------ browser

/**
 * A Chromium to render with. Fails loudly when none exists: a smoke
 * check that silently skips is a check whose absence and success look
 * identical, which is the class this file exists to catch.
 */
function findChrome() {
  const candidates = [process.env.CHROME_BIN].filter(Boolean);
  const pw = "/opt/pw-browsers";
  if (fs.existsSync(pw)) {
    for (const dir of fs.readdirSync(pw)) {
      candidates.push(path.join(pw, dir, "chrome-linux", "chrome"));
    }
  }
  for (const name of ["google-chrome", "chromium-browser", "chromium"]) {
    try {
      candidates.push(execFileSync("which", [name], { encoding: "utf8" }).trim());
    } catch {
      // Not on PATH; keep looking.
    }
  }
  const found = candidates.find((c) => c && fs.existsSync(c));
  if (!found) {
    throw new Error(
      "no Chromium found (CHROME_BIN, /opt/pw-browsers, google-chrome, " +
        "chromium). The smoke check cannot run without a browser, and " +
        "skipping it would hide exactly the failures it exists to catch.",
    );
  }
  return found;
}

// ------------------------------------------------------------ fixture

// Every state the page can show: open with progress, ticketless with a
// long title, all three blocking kinds, parked, forked, stale,
// completed, dropped. 8 open rows and 2 closed ones.
const AT = (n) => `2026-01-01T00:${String(n).padStart(2, "0")}:00+00:00`;
const anchor = { session: "session_smoke", msg: 3, url: "https://x.test/code/session_smoke" };
const FIXTURE = [
  { ev: "opened", thread: "t1", title: "plain ticketed thread", ticket: "o/r#1", urgency: "high" },
  { ev: "progress", thread: "t1", pct: 40, note: "moving along" },
  {
    ev: "opened",
    thread: "t2",
    title:
      "a ticketless thread whose title is far too long to fit on one line " +
      "and therefore must be truncated in the middle by the fitter",
    conversation_only: true,
  },
  { ev: "opened", thread: "t3", title: "blocked internal", ticket: "o/r#3" },
  { ev: "blocked", thread: "t3", on: "internal", what: "waiting on the build" },
  { ev: "opened", thread: "t4", title: "blocked external", ticket: "o/r#4" },
  { ev: "blocked", thread: "t4", on: "external", what: "waits on x/y#9" },
  { ev: "opened", thread: "t5", title: "blocked on the principal", ticket: "o/r#5" },
  { ev: "blocked", thread: "t5", on: "principal", what: "needs a ruling" },
  { ev: "opened", thread: "t6", title: "parked thread", ticket: "o/r#6" },
  { ev: "parked", thread: "t6", trigger: "the measurement lands" },
  { ev: "opened", thread: "t7", title: "forked child", ticket: "o/r#7", parent: "t1" },
  { ev: "opened", thread: "t8", title: "stale ticket", ticket: "o/r#8" },
  { ev: "stale", thread: "t8", what: "the scope grew" },
  { ev: "opened", thread: "t9", title: "finished thread", ticket: "o/r#9" },
  { ev: "completed", thread: "t9", note: "done and shipped" },
  { ev: "opened", thread: "t10", title: "abandoned thread", ticket: "o/r#10" },
  { ev: "dropped", thread: "t10", note: "superseded" },
  // The seal sequence the stretches section folds: one digest-less
  // legacy seal, one reminded stretch, one clean one.
  { ev: "sealed" },
  {
    ev: "sealed",
    diligence: {
      turns: 1,
      executions: { sealed: 1, blocked: 2, unsealed: 0, observed: 0 },
      checks: { "ledger-event": { fired: 2, cleared: 1, ignored: 1 } },
      tokens: { input: 50, output: 4200, cacheRead: 90000, cacheCreation: 100 },
      models: ["claude-smoke-1"],
    },
  },
  {
    ev: "sealed",
    diligence: {
      turns: 1,
      executions: { sealed: 1, blocked: 0, unsealed: 0, observed: 0 },
      checks: {},
      tokens: { input: 10, output: 900, cacheRead: 40000, cacheCreation: 0 },
      models: ["claude-smoke-1"],
    },
  },
].map((event, index) => ({ ...event, at: AT(index), anchor }));
const OPEN_ROWS = 8;
const CLOSED_ROWS = 2;
// One head and one option per session, plus the overview of each.
const HEADS = 2;
const OPTIONS = 2;
// A collapsed legacy line, a reminded stretch, a clean one — rendered
// twice: once in the session's block, once in the overview's.
const STRETCH_ROWS = 6;

/** A throwaway store the CLI renders from. */
function buildStore() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ledger-smoke-"));
  fs.mkdirSync(path.join(root, "ledger"));
  fs.writeFileSync(
    path.join(root, "ledger", "session_smoke.jsonl"),
    FIXTURE.map((event) => JSON.stringify(event)).join("\n") + "\n",
  );
  fs.writeFileSync(
    path.join(root, "ledger", "session_smoke.url"),
    "https://x.test/code/session_smoke\n",
  );
  fs.writeFileSync(
    path.join(root, "repo-codes.json"),
    JSON.stringify({ "o/r": "OR", "x/y": "XY" }),
  );
  return root;
}

// -------------------------------------------------------------- probe

// Runs INSIDE the page, after its own script has (or has not) booted,
// and writes what it measured into a DOM node the dump can carry out.
// Every value is a computed property — rects, styles, live text — never
// the markup the unit suite already covers.
const PROBE = `
<script>
(function () {
  function clippedByAncestor(el) {
    var rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return true;
    for (var a = el.parentElement; a; a = a.parentElement) {
      var style = getComputedStyle(a);
      if (style.overflow === "hidden" || style.overflowY === "hidden") {
        var box = a.getBoundingClientRect();
        if (rect.bottom > box.bottom + 1 || rect.top < box.top - 1) return true;
      }
    }
    return false;
  }
  function run() {
    var results = {
      errors: window.__smokeErrors || [],
      crashShown: Boolean(document.getElementById("crash")),
      rows: document.querySelectorAll("main .threads:not(.done) .thread").length,
      closedRows: document.querySelectorAll("main .done .thread").length,
      emptyTitles: Array.prototype.filter.call(
        document.querySelectorAll(".ttl"),
        function (el) { return !el.textContent.trim(); }
      ).length,
      // The NUL-byte defect killed the entire stylesheet; a parsed
      // stylesheet makes the row a flexbox.
      cssApplied:
        document.querySelector(".thread") !== null &&
        getComputedStyle(document.querySelector(".thread")).display === "flex",
      pageOverflow:
        document.documentElement.scrollWidth >
        document.documentElement.clientWidth,
      pickerOptions: document.querySelectorAll(".pick option").length,
      heads: document.querySelectorAll(".sesshead").length,
      sessionOptions: document.querySelectorAll(".opt").length,
      stretchRows: document.querySelectorAll(".stretch").length,
      stretchCss: (function () {
        var row = document.querySelector(".stretch");
        return row !== null && getComputedStyle(row).display === "flex";
      })(),
      headShown: (function () {
        var head = document.querySelector(".sesshead.on");
        return head !== null && getComputedStyle(head).display === "flex";
      })(),
      pillsClipped: Array.prototype.filter.call(
        document.querySelectorAll(".pill"),
        clippedByAncestor
      ).length,
      popupsHidden: 0,
    };
    // The overflow defect clipped every opened popup: open each one and
    // measure whether a viewer could actually see it.
    var pops = document.querySelectorAll("details.pop");
    Array.prototype.forEach.call(pops, function (pop) { pop.open = true; });
    // Timers, not requestAnimationFrame: headless Chromium never paints,
    // so rAF callbacks starve and the probe would hang forever. Every
    // measurement below forces synchronous layout, which needs no frame.
    setTimeout(function () {
      {
        Array.prototype.forEach.call(pops, function (pop) {
          var body = pop.querySelector(".pop-body");
          if (!body) return;
          var rect = body.getBoundingClientRect();
          if (rect.height < 10 || clippedByAncestor(body)) results.popupsHidden += 1;
        });
        var out = document.createElement("div");
        out.id = "smoke-results";
        out.textContent = JSON.stringify(results);
        document.body.appendChild(out);
        document.title = "SMOKE-DONE";
      }
    }, 100);
  }
  setTimeout(run, 50);
})();
</script>`;

// Captures errors from the page's own script, installed before it runs.
const ERROR_TAP =
  '<script>window.__smokeErrors=[];addEventListener("error",function(e){' +
  "window.__smokeErrors.push(String(e.message||e.type))});</script>\n";

/** Render the fixture through the shipped CLI and instrument the file. */
function renderInstrumented(mutate) {
  const store = buildStore();
  const out = path.join(store, "page.html");
  execFileSync(
    process.execPath,
    [path.join(SKILL, "ledger.mjs"), "render", "--root", store, "--out", out],
    { encoding: "utf8" },
  );
  let html = fs.readFileSync(out, "utf8");
  if (mutate) html = mutate(html);
  fs.writeFileSync(out, ERROR_TAP + html + PROBE);
  return out;
}

/** Load the page headless and return what the probe measured. */
function loadAndMeasure(chrome, file, extraFlags = []) {
  const dom = execFileSync(
    chrome,
    [
      "--headless",
      "--no-sandbox",
      "--disable-gpu",
      "--virtual-time-budget=3000",
      ...extraFlags,
      "--dump-dom",
      `file://${file}`,
    ],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  );
  const match = dom.match(/<div id="smoke-results">([\s\S]*?)<\/div>/);
  assert.ok(match, "the probe never reported — the page hung or died before it");
  const text = match[1].replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
  return JSON.parse(text);
}

/** Control bytes in the shipped file break the publish pipeline. */
function fileHasControlBytes(file) {
  return /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(
    fs.readFileSync(file, "utf8"),
  );
}

function assertHealthy(results) {
  assert.deepEqual(results.errors, [], "the page's script threw");
  assert.equal(results.crashShown, false, "the crash banner survived boot");
  assert.equal(results.rows, OPEN_ROWS, "open rows");
  assert.equal(results.closedRows, CLOSED_ROWS, "closed rows");
  assert.equal(results.emptyTitles, 0, "every title has text");
  assert.equal(results.cssApplied, true, "the stylesheet parsed");
  assert.equal(results.pageOverflow, false, "no horizontal scroll");
  // NO TICKET plus one option per repo in the code map.
  assert.equal(results.pickerOptions, 3, "the picker offers every repo");
  assert.equal(results.heads, HEADS, "one head per session, plus the overview");
  assert.equal(results.sessionOptions, OPTIONS, "the picker offers every session");
  assert.equal(results.stretchRows, STRETCH_ROWS, "the stretch rules render");
  assert.equal(results.stretchCss, true, "the stretch styles parsed");
  assert.equal(results.headShown, true, "the selected head is what a viewer sees");
  assert.equal(results.pillsClipped, 0, "no pill is clipped");
  assert.equal(results.popupsHidden, 0, "every opened popup is visible");
}

// -------------------------------------------------------------- tests

describe("PageSmoke", () => {
  let chrome;
  before(() => {
    chrome = findChrome();
  });

  it("the page a viewer sees is healthy", () => {
    const file = renderInstrumented();
    assert.equal(fileHasControlBytes(file), false, "control bytes in the page");
    assertHealthy(loadAndMeasure(chrome, file));
  });

  it("in dark scheme too", () => {
    assertHealthy(
      loadAndMeasure(chrome, renderInstrumented(), ["--force-dark-mode"]),
    );
  });

  // The acceptance gate, permanent: each defect that shipped past the
  // unit suite is deliberately reintroduced, and the check must turn
  // red. A smoke check that passes on a page it cannot actually see
  // would be the next instance of the class it exists to catch.

  it("catches a control byte in the shipped bytes", () => {
    // The original "\\00b7" escape put a NUL into the CSS. Measured
    // here rather than assumed: the BROWSER repairs it — CSS
    // preprocessing replaces U+0000 with U+FFFD and the sheet survives
    // — so what actually broke that day was the publish pipeline
    // refusing a binary file. The gate therefore checks the bytes a
    // pipeline sees, not the styles a browser computes.
    const file = renderInstrumented((html) =>
      html.replace("<style>", "<style>\u0000"),
    );
    assert.equal(fileHasControlBytes(file), true, "the scan missed the NUL");
    const results = loadAndMeasure(chrome, file);
    assert.equal(results.cssApplied, true, "documented: the browser repairs it");
  });

  it("catches an overflow that clips the popups", () => {
    const file = renderInstrumented((html) =>
      html.replace("</style>", ".thread{overflow:hidden}</style>"),
    );
    const results = loadAndMeasure(chrome, file);
    assert.ok(results.popupsHidden > 0, "the probe missed clipped popups");
  });

  it("catches a page whose script never boots", () => {
    const file = renderInstrumented((html) => html.replace("boot();", ""));
    const results = loadAndMeasure(chrome, file);
    assert.equal(results.crashShown, true, "the probe missed a dead boot");
    assert.equal(results.rows, 0);
  });

  it("catches a boot that throws", () => {
    const file = renderInstrumented((html) =>
      html.replace('id="ledger-data">{', 'id="ledger-data">{broken'),
    );
    const results = loadAndMeasure(chrome, file);
    assert.equal(results.crashShown, true);
    assert.ok(results.errors.length > 0, "the error was not captured");
  });
});
