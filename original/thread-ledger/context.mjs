// Everything the checks read, gathered once.
//
// The checks never touch git, the filesystem or the environment
// directly: they read `ctx`, so a check is a pure verdict over observed
// state and the observation happens in exactly one place. The helpers
// here are the ones more than one check family needs. Header contract:
// `heartbeat.mjs`.

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

import {
  LedgerError,
  countUserTurns,
  lastAssistantText,
  lastUserTurnAt,
  transcriptUsage,
} from "./core.mjs";
import { readAnswers } from "./answers.mjs";
import { readAll, resolveRoot, resolveSession, tail } from "./ledger.mjs";
import { turnBoundary } from "./compliance.mjs";
import { localFile } from "./paths.mjs";

// --------------------------------------------------------- turn summary

/**
 * What the turn declared it touched.
 *
 * The bridge from self-report to observed state: the model names the
 * threads and tickets, and every "did X get updated?" check becomes a
 * mechanical diff of that declaration against what was actually
 * written. Declaring is cheap and unverifiable; the diff is neither.
 *
 * Returns `{ path, exists, writtenAt, threads, tickets }`.
 */
/**
 * Where the turn summary lives (skills#153, format v2).
 *
 * One env var is the whole agreement between the hook wrapper and the
 * `ledger declare` writer — both resolve through it, so neither can
 * drift to a private path. Unset, or set with nothing written there
 * while a legacy file exists, the read falls back to the v1 location
 * under `~/.claude/` so sessions opened before the move keep sealing;
 * the fallback is flagged so the verdict detail can log the
 * deprecation and diligence can measure when the v1 tail goes quiet.
 */
export function resolveSummaryFile() {
  const v2 = process.env.TURN_SUMMARY_PATH || null;
  const legacy = localFile("turn-summary.txt");
  if (v2 && (fs.existsSync(v2) || !fs.existsSync(legacy))) {
    return { file: v2, legacy: false };
  }
  return { file: legacy, legacy: true };
}

export function readTurnSummary(file = null) {
  let legacy = false;
  if (!file) ({ file, legacy } = resolveSummaryFile());
  if (!fs.existsSync(file)) {
    return {
      path: file,
      exists: false,
      writtenAt: null,
      legacy,
      threads: [],
      tickets: [],
      reviews: null,
      rulings: [],
      waivers: {},
    };
  }
  const text = fs.readFileSync(file, "utf8");
  const field = (name) => {
    const line = text.split("\n").find((item) => item.trim().startsWith(`${name}:`));
    if (!line) return [];
    return line.slice(line.indexOf(":") + 1).split(",").map((s) => s.trim()).filter(Boolean);
  };
  // A single-valued line, raw: the reviews declaration is a state
  // word, not a list, and its grammar belongs to the check that reads
  // it — an unrecognized word is the check's finding, not a parse
  // failure here.
  const single = (name) => {
    const line = text.split("\n").find((item) => item.trim().startsWith(`${name}:`));
    if (!line) return null;
    return line.slice(line.indexOf(":") + 1).trim() || null;
  };
  // Every `no-update:` line is a per-ticket waiver: the first token
  // names the ticket, the rest is the reason — a claim the check logs
  // but never verifies, so declining to update is a visible act.
  const waivers = {};
  for (const line of text.split("\n")) {
    if (!line.trim().startsWith("no-update:")) continue;
    const rest = line.slice(line.indexOf(":") + 1).trim();
    const [ticket, ...why] = rest.split(/\s+/);
    if (ticket) waivers[ticket.toLowerCase()] = why.join(" ") || "(no reason given)";
  }
  return {
    path: file,
    exists: true,
    writtenAt: fs.statSync(file).mtime,
    legacy,
    threads: field("threads"),
    tickets: field("tickets"),
    reviews: single("reviews"),
    rulings: field("rulings"),
    waivers,
  };
}

// ---------------------------------------------------------------- repos

/** Every git clone directly under `root`, by name. */
function clonesUnder(root) {
  if (!root || !fs.existsSync(root)) return [];
  return fs
    .readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => ({ name: entry.name, path: path.join(root, entry.name) }))
    .filter((repo) => fs.existsSync(path.join(repo.path, ".git")))
    .sort((a, b) => (a.name < b.name ? -1 : 1));
}

/**
 * Run git in `repo`, or return null when the command legitimately fails.
 *
 * Null is only ever produced for `@{upstream}` on a branch that has
 * none, which the caller reads as "never pushed" — the one git failure
 * with a meaning rather than a defect behind it.
 */
export function gitOrNull(repo, ...args) {
  try {
    return execFileSync("git", ["-C", repo, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  } catch {
    return null;
  }
}

/**
 * Did this clone gain a commit during the turn?
 *
 * Committer date, not author date: a rebase or an amend rewrites the
 * former and preserves the latter, and what matters here is when the
 * commit came into existence in this clone.
 */
export function committedThisTurn(repo, turnStart) {
  if (!turnStart) return false;
  const since = gitOrNull(repo.path, "log", `--since=${turnStart.toISOString()}`, "--format=%H");
  return Boolean(since);
}

/** The file the recorder writes when a session is open in a checkout. */
export const RECORDER_STATE = ".recorder-session.json";

/**
 * The clone of the store `url` names, or null when none is checked out.
 *
 * Found, not configured. The store's own convention is to clone fresh
 * per recording session rather than reuse an attached checkout, so
 * there is no conventional path to derive — and a derived path that
 * happened to exist would be read whether or not it was the right
 * store. Matching is on the trailing owner/repo pair, because managed
 * environments rewrite remotes through local proxies; that is the same
 * comparison the recorder itself makes before it will write.
 *
 * Discovery scans the session's clones AND the workspace stores
 * directory (#72): ensure-stores.sh clones stores under
 * `${WORKSPACE_ROOT:-/workspace}`, which is not under the repo root,
 * so a store visible only there used to read as "no checkout" — check
 * 4 logging unconfigured while marker turns passed unchecked, in
 * exactly the session shape the install builds toward.
 *
 * Duplicates are permanent, not a mess to clean: the platform
 * resurrects deleted clones from snapshots on any resume, so discovery
 * has to be correct in their presence. The tie-break is the open
 * recorder session — that is where records land this turn, by
 * construction. No open session anywhere → the first match serves,
 * since the check only needs to see records once one is written. More
 * than one open session is a real ambiguity, returned for the check to
 * report rather than guessed at.
 */
export function storeCheckout(url, clones) {
  const wanted = tail(url);
  const workspace = clonesUnder(process.env.WORKSPACE_ROOT || "/workspace");
  const matches = [];
  const seen = new Set();
  for (const repo of [...clones, ...workspace]) {
    let real;
    try {
      real = fs.realpathSync(repo.path);
    } catch {
      continue;
    }
    if (seen.has(real)) continue;
    seen.add(real);
    const origin = gitOrNull(repo.path, "remote", "get-url", "origin");
    if (origin && tail(origin) === wanted) matches.push(repo.path);
  }
  const open = matches.filter((p) => fs.existsSync(path.join(p, RECORDER_STATE)));
  if (open.length > 1) return { store: null, open };
  return { store: open[0] ?? matches[0] ?? null, open };
}

/**
 * Records the decision store gained this turn.
 *
 * DECISION:NOVEL — git, not mtime, unlike every other freshness test
 * in this file.
 *
 * Git rather than mtime, which check 1 uses for the turn summary: a
 * store cloned during the session carries its whole corpus at the
 * clone's timestamp, and mtime would read every historical record as
 * written this turn — the check passing hardest exactly where the
 * session is freshest. Untracked files count, because a record written
 * and not yet committed exists; check 2 chases the commit.
 */
export function recordsThisTurn(root, turnStart) {
  const added = gitOrNull(
    root,
    "log",
    `--since=${turnStart.toISOString()}`,
    "--diff-filter=A",
    "--name-only",
    "--format=",
    "--",
    "decisions",
  );
  const status = gitOrNull(root, "status", "--porcelain", "--untracked-files=all", "--", "decisions");
  const untracked = (status ?? "")
    .split("\n")
    .filter((line) => line.startsWith("?? "))
    .map((line) => line.slice(3));
  return [...(added ?? "").split("\n"), ...untracked]
    .map((name) => name.trim())
    .filter((name) => name.endsWith(".json"));
}

/**
 * Did this memory store gain a write during the turn?
 *
 * Coarse on purpose ("not lost" beats "right cabinet"): a commit since
 * the turn began, or a working-tree change whose file was touched
 * after it. The mtime bound keeps a store that was already dirty
 * before the turn from greening every turn after — the false green
 * would point the wrong way for a check about loss.
 */
export function storeWroteThisTurn(root, turnStart) {
  if (committedThisTurn({ path: root }, turnStart)) return true;
  const status = gitOrNull(root, "status", "--porcelain", "--untracked-files=all");
  if (!status) return false;
  return status
    .split("\n")
    .filter((line) => line.trim())
    .some((line) => {
      const file = path.join(root, line.slice(3).trim());
      try {
        return fs.statSync(file).mtime >= turnStart;
      } catch {
        return false;
      }
    });
}

// ------------------------------------------------------- spawned sessions

/**
 * The composer's answers for this session, or null (skills#179 §3).
 *
 * `REINSET_ANSWERS` is exported by the compose hook before the composer
 * has written anything, so a named-and-absent file is the ordinary
 * state of a first Stop, not a misconfiguration — unlike
 * SESSION_MEMORY_ROOT, whose set-and-missing is a crash. A file that
 * exists and cannot be read is a finding the drift check reports.
 */
export function answersOf(ctx) {
  return ctx.answers?.answers ?? null;
}

/**
 * A probe does one commit and one answers file; the ledger event and
 * the rendered artifact are its orchestrator's (skills#181 item 1).
 * Measured: every fired probe that pushed was held by checks 3 and 5,
 * and one guessed a stray artifact to satisfy the republish sentence.
 * The exemption is read from the RESOLVED role — what the composer
 * measured against the reference — never from a role the turn claims.
 */
export function probeExempt(ctx) {
  return answersOf(ctx)?.resolved?.role === "probe";
}

export const PROBE_EXEMPT = {
  verdict: "unconfigured",
  detail: "resolved.role is probe — the ledger and the artifact are the orchestrator's (skills#181)",
};

/** Origins whose passed list is a spawner's claim (skills#179 §3.3). */
export const SPAWNED_ORIGINS = new Set(["spawner", "webhook", "poll"]);

/**
 * The threads this turn touched, OBSERVED from the ledger (skills#153).
 *
 * Derived, never declared: an event counts when it landed after the
 * turn began, so a thread carried over from an earlier turn does not
 * answer for this one. The writer set includes the NAMED ones — the
 * close-loop's bot completing a thread mid-turn leaves the ledger
 * exactly what the turn produced, and blocking there punishes the
 * mechanism for working (#89). An event from another conversation
 * still does not count, because two sessions on one thread would
 * otherwise excuse each other's bookkeeping; a `by` writer is not a
 * conversation and has no bookkeeping to excuse.
 */
export function observedThreads(ctx) {
  if (!ctx.turnStart) return new Set();
  const start = ctx.turnStart.getTime();
  return new Set(
    ctx.events
      .filter((event) => event.anchor?.session === ctx.session || event.by)
      .filter((event) => event.at && new Date(event.at).getTime() >= start)
      .map((event) => event.thread)
      .filter(Boolean),
  );
}

// --------------------------------------------------------------- context

/** Everything the checks read, gathered once. */
export function context(input) {
  // A store root that is set and wrong is worse than one that is unset:
  // the recorder would create a fresh ledger tree at the phantom path
  // and seal into it, so the real store grows unsealed tails while every
  // turn reports success. Refusing here sends it through the crash path,
  // which blocks once and says so.
  const named = process.env.SESSION_MEMORY_ROOT;
  if (named && !fs.existsSync(named)) {
    throw new LedgerError(
      `SESSION_MEMORY_ROOT names ${named}, which does not exist. Nothing was ` +
        "checked and nothing was recorded — sealing into a store that is not " +
        "there would leave the real one looking unfinished.",
    );
  }
  const root = named || resolveRoot(null);
  const transcript = input.transcript_path ?? null;
  const text = transcript && fs.existsSync(transcript) ? fs.readFileSync(transcript, "utf8") : "";
  // The conversation's URL is the log's identity, and the hook is not
  // told it — `session_id` is a platform-local id that matches no log
  // in the store. With one conversation recorded, guessing lands on the
  // right answer by luck; with two it writes the seal to a log nobody
  // reads. So identity comes from the environment, exactly as the store
  // root does, and falls back to the recorder's own resolution only
  // when the environment stays quiet.
  const [session, sessionUrl] = resolveSession(
    root,
    process.env.LEDGER_SESSION_URL || null,
    input.session_id,
    transcript,
  );
  const guarded = input.stop_hook_active === true;
  // Resolved once, here, so all thirteen checks measure the same turn.
  // Recomputed on the guarded fire it would land after this hook's own
  // block feedback and shorten the turn to nothing.
  const turnKey = turnBoundary(
    localFile("reminder-compliance.jsonl"),
    guarded,
    session,
    lastUserTurnAt(text),
  );
  return {
    root,
    transcript,
    session,
    sessionUrl,
    msg: countUserTurns(text),
    usage: transcriptUsage(text),
    turnKey,
    turnStart: turnKey ? new Date(turnKey) : null,
    guarded,
    namedItself: Boolean(process.env.LEDGER_SESSION_URL),
    // How many conversations this store logs. One is unambiguous
    // whatever the environment says; beyond that the hook needs telling.
    conversations: new Set(readAll(root).map((event) => event.anchor?.session).filter(Boolean)).size,
    repoRoot: process.env.HEARTBEAT_REPO_ROOT || null,
    // DECISION:IFACE — the store is named by its URL, the variable the
    // environment already sets, and its checkout is FOUND rather than
    // configured. A second path variable would have to be derived, and
    // the store's convention is to clone fresh per recording session —
    // so there is no conventional path to derive it to.
    decisionUrl: process.env.DECISION_MEMORY_URL || null,
    evidenceUrl: process.env.EVIDENCE_MEMORY_URL || null,
    transcriptText: text,
    // The forge accounts the agent posts as, comma-separated and
    // optional: with distinct principal and agent accounts configured,
    // authorship beats the footer as the human/agent discriminator,
    // and a broken footer contract fails loudly instead of misreading.
    agentAccounts: (process.env.AGENT_ACCOUNTS || "")
      .split(",")
      .map((name) => name.trim())
      .filter(Boolean),
    renderPath: process.env.LEDGER_RENDER_PATH || null,
    answers: readAnswers(),
    clones: clonesUnder(process.env.HEARTBEAT_REPO_ROOT || null),
    summary: readTurnSummary(),
    events: readAll(root),
    // What the principal will read — the last message with a text
    // block, so a correction supersedes the message it corrects.
    assistantText: lastAssistantText(text),
  };
}
