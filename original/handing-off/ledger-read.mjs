// Reads the thread ledger's state for ledger.sh (skills#267).
//
// Usage: node ledger-read.mjs view <state.json> <session-url>
//          prints the session's open threads, one line each,
//          "- <slug>: <state> — <title> (<ticket>)"
//        node ledger-read.mjs rows <state.json>
//          prints one row per thread, its fields separated by the unit
//          separator (\x1f), which keeps empty fields apart where a tab
//          would let `read` merge them:
//          <slug> <state> <title> <ticket> <"yes" when conversation_only>
//          <the trigger of its last parked event>
// <state.json> is the output of `ledger.mjs state`. A file that does
// not parse reads as no threads.

import fs from "node:fs";

const [mode, file, url] = process.argv.slice(2);
let threads = [];
try {
  threads = JSON.parse(fs.readFileSync(file, "utf8"));
} catch {
  threads = [];
}
if (!Array.isArray(threads)) threads = [];

// The opening fields: a reopened event needs the title and the ticket,
// or conversation_only, again.
const opening = (t) => [...(t.events || [])].reverse().find((e) => e && e.title) || {};

// The session id of a URL as the ledger derives it: sessionFromUrl in
// thread-ledger/core/schema.mjs, mirrored here.
function sessionOf(text) {
  const segments = String(text).replace(/^[a-zA-Z][\w+.-]*:\/\//, "").split(/[?#]/)[0]
    .split("/").slice(1).filter(Boolean);
  return (segments[segments.length - 1] || "").replace(/[^A-Za-z0-9._-]/g, "-");
}

if (mode === "view") {
  const session = sessionOf(url);
  for (const t of threads) {
    const events = Array.isArray(t.events) ? t.events : [];
    if (["completed", "dropped"].includes(t.state)) continue;
    if (!events.some((e) => e && e.anchor && e.anchor.session === session)) continue;
    const first = events.find((e) => e && e.title) || {};
    const ticket = first.ticket ? ` (${first.ticket})` : "";
    console.log(`- ${t.thread}: ${t.state}${first.title ? ` — ${first.title}` : ""}${ticket}`);
  }
} else if (mode === "rows") {
  for (const t of threads) {
    if (!t || !t.thread) continue;
    const o = opening(t);
    const parked = [...(t.events || [])].reverse().find((e) => e && e.ev === "parked") || {};
    console.log([t.thread, t.state, o.title || "", o.ticket || "",
      o.conversation_only ? "yes" : "", parked.trigger || ""].join("\x1f"));
  }
} else {
  console.error("usage: ledger-read.mjs view <state.json> <session-url> | rows <state.json>");
  process.exit(2);
}
