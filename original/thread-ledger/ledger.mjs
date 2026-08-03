#!/usr/bin/env node
// Thread ledger — a session's open-work record.
//
// Appends schema-validated events to a per-conversation JSONL file in
// the session-memory store, and renders the folded state as a standalone
// page or as Markdown.
//
// Contract authority: this comment and the SKILL.md next to it.
//
//     ledger append --ev opened --thread <slug> --title "…" \
//         --ticket owner/repo#1 [--deps a,b] [--urgency high]
//     ledger state    # folded state as JSON, for debugging and graphs
//     ledger render --out page.html
//
// The store comes from SESSION_MEMORY_URL. Unset, every command fails:
// there is no fallback path to degrade to, because events written where
// nobody looks are worse than events not written.
//
// Node builtins only. Pushes with plain git; no forge API, no MCP.

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import {
  LedgerError,
  fold,
  mergeLogLines,
  sessionFromUrl,
  stamp,
  validate,
} from "./core.mjs";
import { CSS, esc, renderBody, renderMarkdown } from "./views.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = "/workspace/session-memory";
const TRANSCRIPT_ROOT = path.join(os.homedir(), ".claude", "projects");

// ----------------------------------------------------------------- IO

/**
 * Run git in `root`; throw with full stderr on failure.
 *
 * stderr is captured rather than inherited, so a step this tool expects
 * to fail and recovers from — a push that lost a race — does not print
 * git's alarm to a reader who is about to be told it worked.
 */
function git(root, ...args) {
  try {
    return execFileSync("git", ["-C", root, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (err) {
    throw new LedgerError(`git ${args.join(" ")} failed in ${root}:\n${err.stderr ?? err.message}`);
  }
}

function tail(url) {
  const trimmed = String(url).replace(/\/+$/, "").replace(/\.git$/, "");
  const parts = trimmed.replace(/:/g, "/").split("/").filter(Boolean);
  return parts.slice(-2).join("/").toLowerCase();
}

/**
 * Fail when the clone is not the store the environment names.
 *
 * Managed environments rewrite remotes through local proxies, so compare
 * the trailing owner/repo pair rather than the whole URL.
 */
function verifyOrigin(root, url) {
  const origin = git(root, "remote", "get-url", "origin").trim();
  if (tail(origin) !== tail(url)) {
    throw new LedgerError(
      `${root} has origin ${JSON.stringify(tail(origin))}, but SESSION_MEMORY_URL ` +
        `names ${JSON.stringify(tail(url))} — refusing to write to the wrong store`,
    );
  }
}

/**
 * Locate the session-memory clone.
 *
 * `--root` names a clone outright. Otherwise SESSION_MEMORY_URL must be
 * set: an unset store variable fails here rather than degrading to a
 * conventional path. A warning is not enough — a fallback that happens
 * to work is indistinguishable from a configured store until it writes
 * somewhere unexpected, and by then events have been recorded where
 * nobody will look for them.
 */
export function resolveRoot(explicit) {
  if (explicit) return explicit;
  const url = process.env.SESSION_MEMORY_URL ?? "";
  if (!url) {
    throw new LedgerError(
      "SESSION_MEMORY_URL is unset, so there is no store to write to. Set it " +
        "in this environment (shell profile locally, the environment's " +
        "configuration for cloud sessions, a repository secret in CI), or pass " +
        "--root to name a clone explicitly.",
    );
  }
  if (fs.existsSync(DEFAULT_ROOT)) {
    verifyOrigin(DEFAULT_ROOT, url);
    return DEFAULT_ROOT;
  }
  git(process.cwd(), "clone", url, DEFAULT_ROOT);
  return DEFAULT_ROOT;
}

/**
 * Repo short codes from the store, for ticket prefixes.
 *
 * Store-owned rather than tool-owned: the skill ships no org's repo
 * names. Missing file or missing entry both degrade to the repo's own
 * name, which reads as long rather than wrong.
 */
export function readCodes(root) {
  const file = path.join(root, "repo-codes.json");
  if (!fs.existsSync(file)) return {};
  const data = JSON.parse(fs.readFileSync(file, "utf8"));
  return Object.fromEntries(Object.entries(data).filter(([key]) => !key.startsWith("_")));
}

function ledgerDir(root) {
  return path.join(root, "ledger");
}

function logFiles(root) {
  const dir = ledgerDir(root);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((name) => name.endsWith(".jsonl"))
    .map((name) => path.join(dir, name));
}

/**
 * The file's earliest stamp, for ordering files against each other.
 *
 * A file whose first line carries no stamp sorts by name alone, after
 * every stamped file — unstamped means pre-contract, which is older than
 * anything the recorder has written.
 */
function firstStamp(file) {
  try {
    for (const line of fs.readFileSync(file, "utf8").split("\n")) {
      if (line.trim()) return [JSON.parse(line).at ?? "~", path.basename(file)];
    }
  } catch {
    // Unreadable or malformed: sorts last, by name.
  }
  return ["~", path.basename(file)];
}

/**
 * Every event across every session file, in global order.
 *
 * Files are ordered by their first event's stamp, not by their name.
 * Name order is not time order, and when it disagrees the folded state
 * silently takes an older event as the newer one — which is how a
 * session that had split its log across two files came out showing stale
 * progress with nothing reporting a problem. Within a file, line order
 * is absolute and load-bearing.
 */
export function readAll(root) {
  const files = logFiles(root).sort((a, b) => {
    const [sa, sb] = [firstStamp(a), firstStamp(b)];
    return sa[0] < sb[0] ? -1 : sa[0] > sb[0] ? 1 : sa[1] < sb[1] ? -1 : sa[1] > sb[1] ? 1 : 0;
  });
  const events = [];
  for (const file of files) {
    const lines = fs.readFileSync(file, "utf8").split("\n");
    lines.forEach((line, index) => {
      if (!line.trim()) return;
      try {
        events.push(JSON.parse(line));
      } catch (err) {
        throw new LedgerError(`${file}:${index + 1} is not valid JSON: ${err.message}`);
      }
    });
  }
  return events;
}

// ----------------------------------------------------------- identity

/**
 * Refuse to start a second log for a conversation already logging.
 *
 * Appending under a second name starts a fresh file that folds in beside
 * the first, and nothing looks wrong: both files are valid, the state is
 * merely built from the wrong one.
 */
export function checkSessionFile(root, session) {
  const existing = logFiles(root).map((file) => path.basename(file, ".jsonl"));
  if (existing.length === 1 && existing[0] !== session) {
    throw new LedgerError(
      `this store logs session ${JSON.stringify(existing[0])}, not ` +
        `${JSON.stringify(session)} — appending would start a second log for ` +
        `one conversation. Pass --session ${existing[0]}, or delete the old ` +
        `file if the split is intended.`,
    );
  }
}

function urlFor(root, session) {
  const file = path.join(ledgerDir(root), `${session}.url`);
  if (!fs.existsSync(file)) return null;
  return fs.readFileSync(file, "utf8").trim() || null;
}

/**
 * Decide which conversation this invocation is writing.
 *
 * The URL is the identity when one is known, and the log's filename is
 * derived from it. Everything else is a fallback that says so.
 */
export function resolveSession(root, givenUrl, givenId, transcript) {
  const dir = ledgerDir(root);
  if (givenUrl) {
    const url = givenUrl.trim();
    const session = sessionFromUrl(url);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${session}.url`), `${url}\n`, "utf8");
    return [session, url];
  }

  const known = fs.existsSync(dir)
    ? fs.readdirSync(dir).filter((name) => name.endsWith(".url")).sort()
    : [];
  if (known.length === 1) {
    const url = fs.readFileSync(path.join(dir, known[0]), "utf8").trim();
    if (url) return [sessionFromUrl(url), url];
  }

  if (givenId) return [givenId, urlFor(root, givenId)];
  if (transcript) {
    process.stderr.write(
      "ledger: no session URL known; identifying this conversation by its " +
        "transcript filename, which is local to this machine. Pass " +
        "--session-url once to fix the identity in the store.\n",
    );
    return [path.basename(transcript, ".jsonl"), null];
  }
  throw new LedgerError(
    "cannot tell which conversation this is: no --session-url, no recorded " +
      "URL in the store, no --session, and no transcript.",
  );
}

// --------------------------------------------------------- transcript

/**
 * True for a message the principal actually typed.
 *
 * Tool results are recorded with `type: "user"` too and outnumber real
 * turns roughly six to one, so counting the type alone yields an index
 * that points nowhere in the conversation.
 */
export function isUserTurn(record) {
  if (record?.type !== "user") return false;
  const content = record.message?.content;
  if (typeof content === "string") return Boolean(content.trim());
  if (Array.isArray(content)) {
    return content.some((block) => block && typeof block === "object" && block.type === "text");
  }
  return false;
}

/**
 * User turns so far in `transcript` — the anchor's message index.
 *
 * Null when no transcript is available, so the anchor records an honest
 * gap rather than a fabricated number.
 */
export function countUserMessages(transcript) {
  if (!transcript || !fs.existsSync(transcript)) return null;
  let count = 0;
  for (const line of fs.readFileSync(transcript, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      if (isUserTurn(JSON.parse(line))) count += 1;
    } catch {
      // A partial trailing line is not a turn.
    }
  }
  return count;
}

function findTranscript(explicit) {
  if (explicit) return explicit;
  if (!fs.existsSync(TRANSCRIPT_ROOT)) return null;
  const found = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith(".jsonl")) found.push(full);
    }
  };
  walk(TRANSCRIPT_ROOT);
  if (!found.length) return null;
  return found.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0];
}

// ------------------------------------------------------------- writes

/**
 * Validate, stamp, append one event. Returns the stamped event; throws
 * without writing when validation fails.
 */
export function append(root, session, event, transcript, sessionUrl) {
  checkSessionFile(root, session);
  const history = readAll(root);
  validate(event, history);
  const stamped = stamp(event, session, countUserMessages(transcript), sessionUrl);
  const dir = ledgerDir(root);
  fs.mkdirSync(dir, { recursive: true });
  fs.appendFileSync(
    path.join(dir, `${session}.jsonl`),
    `${JSON.stringify(stamped)}\n`,
    "utf8",
  );
  return stamped;
}

/** Commit the session's files and push straight to the default branch. */
export function push(root, session, summary) {
  git(root, "add", `ledger/${session}.jsonl`);
  if (fs.existsSync(path.join(ledgerDir(root), `${session}.url`))) {
    git(root, "add", `ledger/${session}.url`);
  }
  git(
    root,
    "-c",
    "user.email=noreply@anthropic.com",
    "-c",
    "user.name=thread-ledger",
    "commit",
    "-q",
    "-m",
    `ledger(${session}): ${summary}`,
  );
  pushWithRebase(root, session);
}

/**
 * Push, reconciling with whoever got there first.
 *
 * Several sessions write one store, so losing the race is ordinary
 * rather than exceptional. The log is append-only and both sides are
 * real events, so the merge is always the same: keep everything, in
 * stamp order. Failing here would leave an event written locally and
 * invisible to everyone else.
 */
function pushWithRebase(root, session, attempts = 3) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      git(root, "push", "-q", "origin", "HEAD:main");
      return;
    } catch (err) {
      if (attempt >= attempts) {
        throw new LedgerError(
          `${err.message}\n\nThe event IS written and committed locally; only ` +
            `the push failed. Reconcile by hand and push, or the rest of the ` +
            `org will not see it.`,
        );
      }
      git(root, "fetch", "-q", "origin", "main");
      rebaseOntoRemote(root, session);
    }
  }
}

function rebaseOntoRemote(root, session) {
  const log = `ledger/${session}.jsonl`;
  try {
    git(root, "rebase", "FETCH_HEAD");
    return;
  } catch {
    // The only expected conflict: both sides appended to the log.
  }
  const conflicted = git(root, "diff", "--name-only", "--diff-filter=U").trim();
  if (conflicted && conflicted.split("\n").some((name) => name !== log)) {
    git(root, "rebase", "--abort");
    throw new LedgerError(
      `cannot reconcile automatically — conflict outside the log: ${conflicted}`,
    );
  }
  const file = path.join(root, log);
  const [ours, theirs] = [
    git(root, "show", `:2:${log}`).split("\n"),
    git(root, "show", `:3:${log}`).split("\n"),
  ];
  fs.writeFileSync(file, mergeLogLines(ours, theirs).join("\n") + "\n", "utf8");
  git(root, "add", log);
  git(
    root,
    "-c",
    "core.editor=true",
    "-c",
    "user.email=noreply@anthropic.com",
    "-c",
    "user.name=thread-ledger",
    "rebase",
    "--continue",
  );
}

// -------------------------------------------------------------- pages

/**
 * Inline the modules into one classic script.
 *
 * The published page cannot fetch anything — a strict CSP blocks every
 * external host — so the browser gets the same source files, textually.
 * One copy on disk, one copy in the page, no second implementation.
 */
function bundle() {
  const sources = ["core.mjs", "views.mjs", "page.mjs"].map((name) =>
    fs
      .readFileSync(path.join(HERE, name), "utf8")
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
export function renderPage(events, title, nowMsg, codes, sessionUrl) {
  // `</` inside the payload would close the script element early and let
  // a thread title inject markup. The escape is invisible to JSON.parse,
  // so the embedded data stays byte-faithful.
  const payload = JSON.stringify({
    events,
    codes: codes ?? {},
    title,
    now_msg: nowMsg ?? null,
    session_url: sessionUrl ?? null,
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

  return (
    `<title>${esc(title)}</title>\n<style>${CSS}${CRASH_CSS}</style>\n` +
    `<div id="view"></div>\n${crash}\n` +
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

const CRASH_CSS = `
#crash{max-width:52rem;margin:3rem auto;padding:1.25rem;border-radius:10px;
  border:1px solid var(--wait);background:var(--panel)}
#crash h1{font-size:1.1rem;margin:0 0 .5rem;color:var(--wait)}
#crash p{margin:0 0 .9rem;color:var(--dim);font-size:.9rem}
#crash .pop-body{position:static;width:auto}
`;

// ---------------------------------------------------------------- CLI

const FLAGS = [
  "root", "session", "transcript", "session-url", "ev", "thread", "title",
  "ticket", "parent", "deps", "urgency", "importance", "pct", "note", "on",
  "what", "trigger", "out", "format",
];
const BOOLS = ["conversation-only", "no-push"];

/**
 * Split argv into a command and its options.
 *
 * Options may appear on either side of the command. Callers put the
 * store-wide ones first — `--root . render …` — and pinning the command
 * to argv[0] silently broke every one of them, since a flag's value
 * then parses as a stray argument.
 */
export function parseArgs(argv) {
  let cmd = null;
  const opts = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith("--")) {
      if (cmd !== null) throw new LedgerError(`unexpected argument ${arg}`);
      cmd = arg;
      continue;
    }
    const name = arg.slice(2);
    if (BOOLS.includes(name)) {
      opts[name] = true;
    } else if (FLAGS.includes(name)) {
      i += 1;
      if (i >= argv.length) throw new LedgerError(`--${name} needs a value`);
      opts[name] = argv[i];
    } else if (name === "help") {
      cmd = cmd ?? "help";
    } else {
      throw new LedgerError(`unknown option --${name}`);
    }
  }
  return [cmd, opts];
}

function eventFrom(opts) {
  const event = { ev: opts.ev, thread: opts.thread };
  const copyIf = (key, field = key) => {
    if (opts[key] !== undefined) event[field] = opts[key];
  };
  copyIf("title");
  copyIf("ticket");
  copyIf("parent");
  copyIf("note");
  copyIf("on");
  copyIf("what");
  copyIf("trigger");
  copyIf("urgency");
  copyIf("importance");
  if (opts["conversation-only"]) event.conversation_only = true;
  if (opts.deps) event.deps = opts.deps.split(",").map((s) => s.trim()).filter(Boolean);
  if (opts.pct !== undefined) event.pct = Number.parseInt(opts.pct, 10);
  return event;
}

const USAGE = `ledger — a session's open-work record

  ledger append --ev <kind> --thread <slug> [--title …] [--ticket owner/repo#1]
                [--conversation-only] [--deps a,b] [--urgency high]
                [--pct 40] [--note …] [--on internal] [--what …] [--trigger …]
                [--no-push]
  ledger state
  ledger render --out <file> [--format html|md] [--title …] [--session-url …]

Global: --root <dir> --session <name> --session-url <url> --transcript <file>
Store: SESSION_MEMORY_URL (required; unset fails)`;

export function main(argv) {
  const [cmd, opts] = parseArgs(argv);
  if (!cmd || cmd === "help") {
    process.stdout.write(`${USAGE}\n`);
    return 0;
  }

  const root = resolveRoot(opts.root);
  const transcript = findTranscript(opts.transcript);
  const [session, sessionUrl] = resolveSession(
    root,
    opts["session-url"],
    opts.session,
    transcript,
  );

  if (cmd === "append") {
    const stamped = append(root, session, eventFrom(opts), transcript, sessionUrl);
    // Printed before the push, because the write already happened: a
    // push that fails must not make a recorded event look unrecorded.
    process.stdout.write(`${JSON.stringify(stamped)}\n`);
    if (!opts["no-push"]) push(root, session, `${stamped.ev} ${stamped.thread}`);
    return 0;
  }

  const events = readAll(root);
  if (cmd === "state") {
    process.stdout.write(`${JSON.stringify(fold(events), null, 2)}\n`);
    return 0;
  }

  if (cmd !== "render") throw new LedgerError(`unknown command ${JSON.stringify(cmd)}`);
  if (!opts.out) throw new LedgerError("render needs --out");

  const folded = fold(events);
  const nowMsg = countUserMessages(transcript);
  const codes = readCodes(root);
  const title = opts.title ?? "Thread ledger";
  let page;
  if (opts.format === "md") {
    const generated = new Date().toISOString().slice(0, 16).replace("T", " ") + " UTC";
    page = renderMarkdown(folded, title, nowMsg, codes, generated, sessionUrl);
  } else {
    page = renderPage(events, title, nowMsg, codes, sessionUrl);
  }
  fs.writeFileSync(opts.out, page, "utf8");
  process.stdout.write(`wrote ${opts.out}\n`);
  return 0;
}

// Only the body of `renderBody` is shared with the page; node never
// builds rows itself.
export { renderBody };

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  try {
    process.exit(main(process.argv.slice(2)));
  } catch (err) {
    if (err instanceof LedgerError) {
      process.stderr.write(`ledger: ${err.message}\n`);
      process.exit(1);
    }
    throw err;
  }
}
