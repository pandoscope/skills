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
  TERMINAL,
  WRITERS,
  countUserTurns,
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

export function tail(url) {
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

/**
 * The store's forge config, shared with the response-hygiene check.
 *
 * `config/shortcodes.json`: a flat shortcode → repo map (GitHub
 * assumed) or `{forge, patterns, repos}` naming the org's own base and
 * URL patterns. Views take it as data — a missing or unreadable file
 * degrades to the GitHub defaults, exactly like an absent map.
 */
export function readForge(root) {
  const file = path.join(root, "config", "shortcodes.json");
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return {};
  }
}

function ledgerDir(root) {
  return path.join(root, "ledger");
}

/**
 * Human names for sessions, from `ledger/<session>.name` sidecars.
 *
 * A session's id identifies it; a name is what a reader recognises it
 * by. The sidecar is written by whoever wants the name — principal or
 * session — and absence simply renders the id.
 */
export function readNames(root) {
  const dir = ledgerDir(root);
  if (!fs.existsSync(dir)) return {};
  const names = {};
  for (const file of fs.readdirSync(dir).filter((name) => name.endsWith(".name"))) {
    const text = fs.readFileSync(path.join(dir, file), "utf8").trim();
    if (text) names[path.basename(file, ".name")] = text;
  }
  return names;
}

/**
 * Every raw diligence record in the store, oldest file order.
 *
 * These are the per-Stop records the heartbeat flushes beside each
 * seal. The page embeds them so digest-less seals can project their
 * digest at render time; a torn line is skipped, not thrown on.
 */
export function readDiligence(root) {
  const dir = path.join(root, "diligence");
  if (!fs.existsSync(dir)) return [];
  const records = [];
  for (const name of fs.readdirSync(dir).filter((file) => file.endsWith(".jsonl")).sort()) {
    for (const line of fs.readFileSync(path.join(dir, name), "utf8").split("\n")) {
      if (!line.trim()) continue;
      try {
        records.push(JSON.parse(line));
      } catch {
        // A torn record must not deny the rest of the corpus a render.
      }
    }
  }
  return records;
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
 * Every event across every session file, in global order.
 *
 * Events interleave by their own stamp. Conversations overlap — one
 * starts, a second starts and ends, the first writes again — so ordering
 * whole files puts every later event of the earlier-starting file ahead
 * of every event of the other, and the fold takes an older event as the
 * newer one. Nothing looks wrong: both files are valid, the state is
 * merely built in an order that never happened.
 *
 * Two ties break it, in order: line position within a file, because a
 * second of wall clock holds several appends and only the file knows
 * which came first; then the filename, so two files stamped alike order
 * the same way on every machine.
 *
 * An event with no stamp sorts after every stamped one. Unstamped means
 * pre-contract, which is older than anything the recorder has written —
 * but it cannot be placed, and last is the position that claims least.
 */
export function readAll(root) {
  const events = [];
  for (const file of logFiles(root)) {
    const name = path.basename(file);
    const lines = fs.readFileSync(file, "utf8").split("\n");
    lines.forEach((line, index) => {
      if (!line.trim()) return;
      try {
        events.push({ event: JSON.parse(line), name, line: index });
      } catch (err) {
        throw new LedgerError(`${file}:${index + 1} is not valid JSON: ${err.message}`);
      }
    });
  }
  const key = (entry) => [entry.event.at ?? "~", entry.name, entry.line];
  events.sort((a, b) => {
    const [ka, kb] = [key(a), key(b)];
    for (let i = 0; i < ka.length; i += 1) {
      if (ka[i] < kb[i]) return -1;
      if (ka[i] > kb[i]) return 1;
    }
    return 0;
  });
  return events.map((entry) => entry.event);
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
  const existing = logFiles(root)
    .map((file) => path.basename(file, ".jsonl"))
    // A writer's log is not a conversation's, so it neither counts as
    // the conversation already logging nor is something to append to.
    .filter((name) => !WRITERS.includes(name));
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
 * The conversation a rendered view links back to, or null.
 *
 * Null is a correct answer here, unlike for a write. A store holding
 * several conversations has no single one to link to, and every thread
 * already carries its own URL on its anchors — which is the link the
 * rows actually use. A store-wide link is a convenience for the
 * one-conversation case, so its absence degrades the header and nothing
 * else.
 */
export function storeUrl(root, explicit) {
  if (explicit) return explicit.trim();
  const dir = ledgerDir(root);
  if (!fs.existsSync(dir)) return null;
  const known = fs.readdirSync(dir).filter((name) => name.endsWith(".url"));
  if (known.length !== 1) return null;
  return fs.readFileSync(path.join(dir, known[0]), "utf8").trim() || null;
}

/**
 * Decide which conversation this invocation is writing.
 *
 * The URL is the identity when one is known, and the log's filename is
 * derived from it. Everything else is a fallback that says so.
 */
export function resolveSession(root, givenUrl, givenId, transcript, { write = false } = {}) {
  const dir = ledgerDir(root);
  if (givenUrl) {
    const url = givenUrl.trim();
    const session = sessionFromUrl(url);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${session}.url`), `${url}\n`, "utf8");
    return [session, url];
  }

  // A WRITE proves its identity or refuses (skills#51). The fallbacks
  // below exist for reads — CI rendering a store it cannot know the
  // session of — but an append that guesses publishes the guess: the
  // append, the identity choice and the push are one action, so by the
  // time a warning prints, the store has already recorded events under
  // an identity that exists nowhere. Measured twice: once adopting the
  // store's recorded URL from a different conversation, once falling
  // back to the transcript filename. DECISION:IFACE — the refusal is
  // scoped to writes, not to resolution: the sealing hook keeps the
  // recorded-URL fallback because its only alternative identity is a
  // platform-local id that matches no log, and a single-conversation
  // store makes that fallback exact, while the CLI append always has a
  // caller who can say who they are.
  if (write) {
    if (givenId) return [givenId, urlFor(root, givenId)];
    throw new LedgerError(
      "refusing to append without an explicit identity: pass --session-url " +
        "(or set LEDGER_SESSION_URL), or --session when the log is named " +
        "outright. Guessing has been measured to misfile events — adopting " +
        "the store's recorded URL or the transcript filename — and the " +
        "append pushes immediately, so the wrong identity is published " +
        "before any warning can be acted on. Nothing was written.",
    );
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
 * User turns so far in `transcript` — the anchor's message index.
 *
 * Null when no transcript is available, so the anchor records an honest
 * gap rather than a fabricated number. The counting itself is
 * `countUserTurns` in core.mjs: the heartbeat and the transcript
 * renderer address the same positions, and two counters that disagree
 * would make an anchor point at a different message per reader.
 */
export function countUserMessages(transcript) {
  if (!transcript || !fs.existsSync(transcript)) return null;
  return countUserTurns(fs.readFileSync(transcript, "utf8"));
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
 * Refuse the write when the store clone is not on its default branch
 * (skills#76).
 *
 * The push is `HEAD:main` by design — one branch, no PR gate, every
 * append lands immediately — but that shape was assumed, never
 * verified. Measured: a clone left on a feature branch ran a routine
 * append and the push published the branch's unreviewed commit to
 * main. An append is a one-line write; that made it a code deploy.
 * DECISION:IFACE — the guard lives here in the library, not in the
 * CLI, so every writer (CLI, sealing hook, bot) refuses before
 * anything is written; and it applies only when the store is its own
 * repository, because a bare log directory has no push to protect and
 * `git -C` would otherwise judge whatever repo happens to enclose it.
 */
/**
 * Fast-forward the store before a render reads it (skills#52).
 *
 * The published page is a snapshot of the fold, and a snapshot taken
 * from a checkout the remote has already moved past is wrong in the
 * one way nobody checks: it renders cleanly. This was prose in
 * SKILL.md — "pull immediately before rendering" — and prose is a rule
 * the writer re-derives every turn. Here it is the tool's own step,
 * which is where a rule stops being remembered and starts being true.
 *
 * Reports, never gates: offline, diverged, or no repository at all,
 * the page still renders from what is on disk and the reason goes to
 * stderr. A ledger that refuses to render when the network is down
 * would be a worse tool than one that renders a slightly old page and
 * says so.
 */
export function pullForRender(root) {
  let top;
  try {
    top = git(root, "rev-parse", "--show-toplevel").trim();
  } catch {
    return; // a bare log directory has no remote to be behind
  }
  // Same guard as the push side: `git -C` would otherwise pull whatever
  // repository happens to enclose a plain log directory.
  if (fs.realpathSync(top) !== fs.realpathSync(root)) return;
  try {
    git(root, "pull", "--ff-only", "-q");
  } catch (err) {
    const reason = String(err.message ?? err).split("\n").find((line) => line.trim()) ?? "";
    process.stderr.write(
      `ledger: could not fast-forward ${root} before rendering — the page ` +
        `is built from this checkout as it stands (${reason.trim()})\n`,
    );
  }
}

function requireDefaultBranch(root) {
  let top;
  try {
    top = git(root, "rev-parse", "--show-toplevel").trim();
  } catch {
    return; // not a repository — there is no push for the guard to gate
  }
  if (fs.realpathSync(top) !== fs.realpathSync(root)) return;
  // What the push targets: the remote's default branch when the clone
  // recorded one, else the `main` that pushWithRebase is written against.
  let target = "main";
  try {
    const ref = git(root, "symbolic-ref", "-q", "refs/remotes/origin/HEAD").trim();
    if (ref) target = ref.replace("refs/remotes/origin/", "");
  } catch {
    // No origin/HEAD recorded; the hardcoded push target stands.
  }
  let head = null;
  try {
    head = git(root, "symbolic-ref", "--short", "-q", "HEAD").trim() || null;
  } catch {
    // Detached HEAD: no branch name at all.
  }
  if (head === target) return;
  throw new LedgerError(
    `the store clone is on ${head ? JSON.stringify(head) : "a detached HEAD"}, ` +
      `not its default branch ${JSON.stringify(target)}. The store is worked on ` +
      `its default branch: an append pushes HEAD there, so whatever this branch ` +
      `carries would be published to ${JSON.stringify(target)} unreviewed. ` +
      `Nothing was written. Reconcile the clone (git checkout ${target}) and ` +
      `re-run the append.`,
  );
}

/**
 * Validate, stamp, append one event. Returns the stamped event; throws
 * without writing when validation fails.
 */
export function append(root, session, event, transcript, sessionUrl) {
  requireDefaultBranch(root);
  // The one-log guard asks whether a conversation is splitting its log
  // in two. A writer that is not a conversation has no such log to
  // split, and its own is expected to sit beside the sessions'.
  if (!event.by) checkSessionFile(root, session);
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
export function push(root, session, summary, event = null) {
  git(root, "add", `ledger/${session}.jsonl`);
  for (const sidecar of ["url", "name"]) {
    if (fs.existsSync(path.join(ledgerDir(root), `${session}.${sidecar}`))) {
      git(root, "add", `ledger/${session}.${sidecar}`);
    }
  }
  // The heartbeat's raw stretch records. It writes them beside the seal
  // but never pushes, so this push is their only ride to the remote.
  if (fs.existsSync(path.join(root, "diligence", `${session}.jsonl`))) {
    git(root, "add", `diligence/${session}.jsonl`);
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
  pushWithRebase(root, session, event);
}

/**
 * Refuse the push when the merge invalidated the event (skills#78).
 *
 * Append validated against the LOCAL fold, which was honest about
 * everything the clone had — but a concurrent writer lands in its own
 * file, the rebase merges cleanly, and the union can hold a transition
 * nobody validated (measured: a bot's `completed`, then a stale
 * session's `progress` 86 seconds later, silently overriding the
 * close). The rebase is the only point where both lines are visible,
 * so this is where the event is checked against the MERGED history —
 * and withdrawn if the union forbids it, because pushing it would
 * publish a fold no writer ever approved.
 */
function refuseIfMergeInvalidated(root, session, event) {
  if (!event) return null;
  const line = JSON.stringify(event);
  const history = [];
  let seen = false;
  for (const item of readAll(root)) {
    // The event's own line is excluded once — it is the candidate, not
    // the history it is judged against.
    if (!seen && JSON.stringify(item) === line) {
      seen = true;
      continue;
    }
    history.push(item);
  }
  try {
    validate(event, history);
    return null;
  } catch (err) {
    if (!(err instanceof LedgerError)) throw err;
    // Withdraw the EVENT, not the commit: the same commit carries
    // whatever the heartbeat wrote since the last push — seal lines,
    // diligence records — and that is observed state the store must
    // keep. The event's line is removed, the commit amended, and the
    // loop pushes the rest.
    const file = path.join(ledgerDir(root), `${session}.jsonl`);
    const kept = fs
      .readFileSync(file, "utf8")
      .split("\n")
      .filter((text) => text.trim());
    const at = kept.lastIndexOf(line);
    if (at >= 0) kept.splice(at, 1);
    fs.writeFileSync(file, kept.join("\n") + (kept.length ? "\n" : ""), "utf8");
    git(root, "add", `ledger/${session}.jsonl`);
    git(
      root,
      "-c",
      "user.email=noreply@anthropic.com",
      "-c",
      "user.name=thread-ledger",
      "commit",
      "-q",
      "--amend",
      "--no-edit",
      // The commit may have carried nothing BUT the event; what remains
      // is empty, and it is dropped just below rather than published as
      // a commit that records nothing.
      "--allow-empty",
    );
    try {
      git(root, "diff", "--quiet", "HEAD^", "HEAD");
      git(root, "reset", "-q", "--hard", "HEAD^");
    } catch {
      // Non-empty: the seals and records the commit carried stay in it.
    }
    return new LedgerError(
      `the push was refused and the event WITHDRAWN — it is not recorded. ` +
        `While this clone was stale, another writer changed the thread, and ` +
        `against the merged history the event is illegal: ${err.message}\n\n` +
        `Everything else the commit carried was pushed. Re-read the fold ` +
        `(ledger state) and append an event that is legal from it.`,
    );
  }
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
function pushWithRebase(root, session, event = null, attempts = 3) {
  let withdrawal = null;
  for (let attempt = 1; ; attempt += 1) {
    try {
      git(root, "push", "-q", "origin", "HEAD:main");
      // The push carried everything that survived; a withdrawal is
      // reported only now, so the refusal never strands the seal lines
      // and diligence records that shared the commit.
      if (withdrawal) throw withdrawal;
      return;
    } catch (err) {
      if (err === withdrawal) throw err;
      if (attempt >= attempts) {
        throw new LedgerError(
          `${err.message}\n\nThe event IS written and committed locally; only ` +
            `the push failed. Reconcile by hand and push, or the rest of the ` +
            `org will not see it.`,
        );
      }
      git(root, "fetch", "-q", "origin", "main");
      rebaseOntoRemote(root, session);
      // A lost race means the clone was stale — the one condition under
      // which the local validation may have approved an event the whole
      // history forbids. Checked once; after a withdrawal the event is
      // gone from the file and there is nothing left to judge.
      if (!withdrawal) {
        withdrawal = refuseIfMergeInvalidated(root, session, event);
      }
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

// --------------------------------------------------------- reconcile

/** Run git in `dir`, or null when the command legitimately fails. */
function gitOrNull(dir, ...args) {
  try {
    return git(dir, ...args).trim();
  } catch {
    return null;
  }
}

/** The clone under `reposDir` whose origin names `ownerRepo`, or null. */
function cloneFor(reposDir, ownerRepo) {
  if (!reposDir || !fs.existsSync(reposDir)) return null;
  for (const entry of fs.readdirSync(reposDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const dir = path.join(reposDir, entry.name);
    if (!fs.existsSync(path.join(dir, ".git"))) continue;
    const origin = gitOrNull(dir, "remote", "get-url", "origin");
    if (origin && tail(origin) === ownerRepo.toLowerCase()) return dir;
  }
  return null;
}

/**
 * Live threads whose recorded branch is already merged (skills#70).
 *
 * The SessionStart twin of check-clones.sh: merged-into-default is a
 * pure git question — `merge-base --is-ancestor` — so it needs no
 * credentials and runs where the API cannot. It REPORTS and never
 * gates: an unknown ref, a missing clone, a thread that recorded no
 * branch are all silence, because a reporter that can fail becomes a
 * gate the moment someone waits on it. Exit is always 0; deciding what
 * event to append stays with the reader.
 */
export function mergedReport(root, reposDir) {
  const lines = [];
  for (const thread of fold(readAll(root))) {
    if (TERMINAL.includes(thread.state)) continue;
    if (!thread.branch || !thread.ticket) continue;
    const clone = cloneFor(reposDir, thread.ticket.split("#")[0]);
    if (!clone) continue;
    if (gitOrNull(clone, "rev-parse", "--verify", "--quiet", `origin/${thread.branch}`) === null) {
      continue; // The ref is gone (deleted on merge, or never pushed): unknowable, so silent.
    }
    const head = gitOrNull(clone, "symbolic-ref", "-q", "refs/remotes/origin/HEAD");
    const target = head ? head.replace("refs/remotes/origin/", "") : "main";
    try {
      git(clone, "merge-base", "--is-ancestor", `origin/${thread.branch}`, `origin/${target}`);
    } catch {
      continue; // Not merged (or not comparable) — nothing to report.
    }
    lines.push(
      `ledger: thread ${thread.thread} is ${thread.state} at ${thread.pct}%, but its ` +
        `branch ${thread.branch} is merged into ${target} — if the work is done, ` +
        `append completed; if follow-up remains, say so in a progress note.`,
    );
  }
  return lines.length ? `${lines.join("\n")}\n` : "";
}

/** Parse `owner/repo#n` into its two halves. */
function ticketParts(ref) {
  const match = /^([\w.-]+\/[\w.-]+)#(\d+)$/.exec(String(ref));
  return match ? { repo: match[1], number: match[2] } : null;
}

function ghJson(args) {
  try {
    return JSON.parse(
      execFileSync("gh", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }),
    );
  } catch {
    return null;
  }
}

/**
 * Compare live threads against forge state, both directions
 * (skills#70): a live thread whose ticket is closed, and a completed
 * thread whose PR never merged. On demand, because it is API-priced:
 * latency belongs where someone asked the question, not on every Stop.
 * Prints divergences and never writes — reconciliation reports, a
 * human or the model decides what event to append.
 */
export function reconcile(root) {
  try {
    execFileSync("gh", ["--version"], { stdio: ["ignore", "ignore", "ignore"] });
  } catch {
    throw new LedgerError(
      "reconcile asks the forge, which needs the gh CLI — run it where gh is " +
        "installed and authenticated (not in a managed session whose tooling " +
        "replaces it).",
    );
  }
  const lines = [];
  for (const thread of fold(readAll(root))) {
    const live = !TERMINAL.includes(thread.state);
    const ticket = ticketParts(thread.ticket);
    if (live && ticket) {
      const data = ghJson(["issue", "view", ticket.number, "--repo", ticket.repo, "--json", "state"]);
      if (!data) {
        lines.push(`? ${thread.thread}: could not read ticket ${thread.ticket}`);
      } else if (data.state === "CLOSED") {
        lines.push(
          `! ${thread.thread} is ${thread.state}, but its ticket ${thread.ticket} is closed`,
        );
      }
    }
    const pr = ticketParts(thread.pr);
    if (!live && thread.state === "completed" && pr) {
      const data = ghJson(["pr", "view", pr.number, "--repo", pr.repo, "--json", "state"]);
      if (!data) {
        lines.push(`? ${thread.thread}: could not read PR ${thread.pr}`);
      } else if (data.state !== "MERGED") {
        lines.push(
          `! ${thread.thread} is completed, but its PR ${thread.pr} is ${data.state.toLowerCase()} — completed work that never merged`,
        );
      }
    }
  }
  if (!lines.length) return "reconciled: no divergence between the ledger and the forge.\n";
  return `${lines.join("\n")}\n`;
}

// -------------------------------------------------------------- guard

/**
 * The store guard: judge what a push did to the append-only corpus.
 *
 * Two rules, both from measured incidents (skills#79, skills#78):
 *
 * - No push removes a line from `ledger/*.jsonl` or `diligence/*.jsonl`.
 *   The log is append-only and the raw records are retained data; a
 *   deletion is a deletion however it arose — hand edit, bad rebase,
 *   `checkout --theirs` in a conflict, force push.
 * - Every event ADDED in the range must be legal from the history that
 *   precedes it in the folded order. Two writers' files merge cleanly
 *   in git, so the union can hold a transition nobody validated; this
 *   is where the union is finally judged. Only added lines are judged —
 *   history from before the guard is not this push's fault, and the
 *   deletion rule itself forbids the rewrite that would clean it.
 *
 * @param root the store checkout, at the range's end state
 * @param range a git revision range, e.g. `«before»..«after»`
 * @returns {{ok: boolean, report: string}} — `report` names every
 *   violation, or summarises what was checked
 * @throws LedgerError when git cannot resolve the range
 */
export function guardRange(root, range) {
  const diff = git(
    root,
    "diff",
    "--unified=0",
    range,
    "--",
    "ledger/*.jsonl",
    "diligence/*.jsonl",
  );
  const removed = [];
  const added = [];
  let file = null;
  for (const line of diff.split("\n")) {
    if (line.startsWith("--- a/")) {
      file = line.slice(6);
      continue;
    }
    if (line.startsWith("+++ b/")) {
      if (line !== "+++ /dev/null") file = line.slice(6);
      continue;
    }
    if (line.startsWith("---") || line.startsWith("+++")) continue;
    if (line.startsWith("-") && line.slice(1).trim()) {
      removed.push({ file, text: line.slice(1) });
    } else if (line.startsWith("+") && line.slice(1).trim()) {
      added.push({ file, text: line.slice(1) });
    }
  }

  const violations = removed.map(
    (item) => `removed from ${item.file}: ${item.text.slice(0, 120)}`,
  );

  // Judge each added event against the history preceding it in the
  // folded order of the checkout — the same order every reader uses.
  const events = readAll(root);
  const lines = events.map((event) => JSON.stringify(event));
  const consumed = new Set();
  for (const item of added) {
    if (!item.file.startsWith("ledger/")) continue;
    let event;
    try {
      event = JSON.parse(item.text);
    } catch {
      violations.push(`unparsable line added to ${item.file}: ${item.text.slice(0, 120)}`);
      continue;
    }
    if (!event?.ev) continue;
    let at = -1;
    for (let index = 0; index < lines.length; index += 1) {
      if (!consumed.has(index) && lines[index] === item.text.trim()) {
        at = index;
        break;
      }
    }
    if (at < 0) continue; // Rewritten again later in the range; the final state carries it or the removal rule already fired.
    consumed.add(at);
    try {
      validate(event, events.slice(0, at));
    } catch (err) {
      if (!(err instanceof LedgerError)) throw err;
      violations.push(`illegal event added to ${item.file}: ${err.message}`);
    }
  }

  if (violations.length) {
    return { ok: false, report: violations.join("\n") + "\n" };
  }
  return {
    ok: true,
    report: `guard: clean — ${added.length} added, 0 removed across ${range}\n`,
  };
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
export function renderPage(events, title, nowMsg, codes, sessionUrl, diligence = [], names = {}, forge = {}) {
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
  "what", "trigger", "out", "format", "by", "range", "branch", "pr", "repos",
];
const BOOLS = ["conversation-only", "no-push", "no-pull"];

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
  copyIf("branch");
  copyIf("pr");
  copyIf("by");
  if (opts["conversation-only"]) event.conversation_only = true;
  if (opts.deps) event.deps = opts.deps.split(",").map((s) => s.trim()).filter(Boolean);
  if (opts.pct !== undefined) event.pct = Number.parseInt(opts.pct, 10);
  return event;
}

const USAGE = `ledger — a session's open-work record

  ledger append --ev <kind> --thread <slug> [--title …] [--ticket owner/repo#1]
                [--conversation-only] [--deps a,b] [--urgency high]
                [--pct 40] [--note …] [--on internal] [--what …] [--trigger …]
                [--by bot] [--no-push]
                [--branch <name>] [--pr owner/repo#2]
  ledger state
  ledger render [--out <file>] [--format html|md] [--title …] [--session-url …]
                [--no-pull]   # render pulls the store first; this skips it
                (--out defaults to LEDGER_RENDER_PATH)
  ledger guard --range <before>..<after>   # append-only + fold guard, for store CI
  ledger merged-report --repos <dir>       # live threads whose branch merged; reports, never gates
  ledger reconcile                         # ledger vs forge divergences, needs gh

Global: --root <dir> --session <name> --session-url <url> --transcript <file>
Store: SESSION_MEMORY_URL (required; unset fails)
Identity: append requires --session-url (or LEDGER_SESSION_URL) or --session;
          reads may fall back to the store's recorded URL`;

export function main(argv) {
  const [cmd, opts] = parseArgs(argv);
  if (!cmd || cmd === "help") {
    process.stdout.write(`${USAGE}\n`);
    return 0;
  }

  const root = resolveRoot(opts.root);
  // A writer that is not a conversation has no transcript. Looking for
  // one anyway finds the most recently modified session's, and stamps
  // that session's message count onto the workflow's events.
  const transcript = opts.by ? null : findTranscript(opts.transcript);

  // Identity is resolved for WRITES only. A write has to know which
  // conversation it belongs to; a read folds every log in the store and
  // never asks. Resolving it up front for all three commands is what
  // stopped the store rendering the moment it held a second
  // conversation — the requirement was real, it was just in the wrong
  // place.
  if (cmd === "append") {
    // A writer that is not a conversation names itself and skips session
    // resolution, which exists to answer "which conversation is this".
    // Routed through it, the workflow would inherit a session's name and
    // URL and its events would read as that session's own work.
    const [session, sessionUrl] = opts.by
      ? [opts.by, null]
      : resolveSession(
          root,
          opts["session-url"] || process.env.LEDGER_SESSION_URL || null,
          opts.session,
          transcript,
          { write: true },
        );
    const stamped = append(root, session, eventFrom(opts), transcript, sessionUrl);
    // Printed before the push, because the write already happened: a
    // push that fails must not make a recorded event look unrecorded.
    process.stdout.write(`${JSON.stringify(stamped)}\n`);
    if (!opts["no-push"]) push(root, session, `${stamped.ev} ${stamped.thread}`, stamped);
    return 0;
  }

  if (cmd === "guard") {
    if (!opts.range) throw new LedgerError("guard needs --range <before>..<after>");
    const { ok, report } = guardRange(root, opts.range);
    process.stdout.write(report);
    return ok ? 0 : 1;
  }

  if (cmd === "merged-report") {
    if (!opts.repos) throw new LedgerError("merged-report needs --repos <dir of clones>");
    process.stdout.write(mergedReport(root, opts.repos));
    return 0;
  }

  if (cmd === "reconcile") {
    process.stdout.write(reconcile(root));
    return 0;
  }

  // Before reading, not after: the fold a render publishes must come
  // from the store as the remote has it (skills#52). `--no-pull` is for
  // deliberate offline renders and for tests that pin the events.
  if (cmd === "render" && !opts["no-pull"]) pullForRender(root);

  const events = readAll(root);
  if (cmd === "state") {
    process.stdout.write(`${JSON.stringify(fold(events), null, 2)}\n`);
    return 0;
  }

  if (cmd !== "render") throw new LedgerError(`unknown command ${JSON.stringify(cmd)}`);
  // The artifact-fresh check reads LEDGER_RENDER_PATH; a writer that
  // must be handed the same path by the model re-introduces the copy
  // that drifts (skills#115 — a session rendered ledger-page.html for
  // a check watching ledger.html). Explicit --out still wins: tests
  // and store CI render to paths of their own choosing.
  const out = opts.out ?? process.env.LEDGER_RENDER_PATH;
  if (!out) {
    throw new LedgerError("render needs --out (or LEDGER_RENDER_PATH set)");
  }

  const folded = fold(events);
  const sessionUrl = storeUrl(root, opts["session-url"]);
  const nowMsg = countUserMessages(transcript);
  const codes = readCodes(root);
  const forge = readForge(root);
  const title = opts.title ?? "Thread ledger";
  let page;
  if (opts.format === "md") {
    const generated = new Date().toISOString().slice(0, 16).replace("T", " ") + " UTC";
    page = renderMarkdown(folded, title, nowMsg, codes, generated, sessionUrl, forge);
  } else {
    page = renderPage(events, title, nowMsg, codes, sessionUrl, readDiligence(root), readNames(root), forge);
  }
  fs.writeFileSync(out, page, "utf8");
  process.stdout.write(`wrote ${out}\n`);
  return 0;
}

// Only the body of `renderBody` is shared with the page; node never
// builds rows itself.
export { renderBody };

// `exitCode` rather than `exit()`: stdout is ASYNCHRONOUS on a pipe, and
// `process.exit()` discards whatever is still buffered — so `state`,
// whose whole purpose is to be read by another program, lost everything
// past the first 64 KiB the moment it was piped anywhere. To a file or a
// terminal the write is synchronous, which is why every interactive use
// looked fine. Setting the code and falling off the end lets node drain
// first, and keeps the status a caller branches on.
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  // A consumer that stops reading early — head, a pager quit half-way —
  // closes the pipe, and node surfaces that as an EPIPE error on
  // stdout. That is how reading ends, not a fault: every other CLI
  // exits quietly there. `process.exit()` is legitimate in this one
  // place, because the reader is gone and there is nothing left to
  // drain for. Anything that is not EPIPE still fails loudly — and the
  // handler is registered only on the CLI path, so importing this
  // module never rewires the host process's stdout.
  process.stdout.on("error", (err) => {
    if (err?.code === "EPIPE") process.exit(0);
    throw err;
  });
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (err) {
    if (err instanceof LedgerError) {
      process.stderr.write(`ledger: ${err.message}\n`);
      process.exitCode = 1;
    } else {
      throw err;
    }
  }
}
