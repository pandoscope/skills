#!/usr/bin/env node
// The ledger heartbeat — a Stop hook that will not let a turn end with
// its bookkeeping missing.
//
// Registered for `Stop`, which fires when the model finishes a
// response. It reads the hook's JSON on stdin, checks the turn against
// OBSERVED state — files on disk, git, the ledger log, the transcript —
// and either blocks the turn once with a reason, or seals it.
//
//     exit 2 + stderr   the model cannot end its turn; the text is fed
//                       back and acted on within the same turn
//     exit 0            the turn ends
//
// Why observed state and not a checklist: a report written by the agent
// that did the work is another claim from the context that already
// believed the work happened. Every failure in this org's catalogue
// would have been ticked.
//
// Discipline: checks run in priority order and the FIRST failure wins.
// A wall of failures recreates checklist fatigue, and a reason phrased
// as instructions makes a model start new work in a loop — so a reason
// is a completion criterion plus the exact command, nothing else.
//
// Contract authority: this comment, SKILL.md next to it, and the katas
// in tests/original/reminder-heartbeat/.
//
//     SESSION_MEMORY_ROOT   the store clone this session writes to
//     HEARTBEAT_REPO_ROOT   directory holding the session's repo clones
//     LEDGER_SESSION_URL    this conversation's URL — the log's identity
//     DECISION_MEMORY_URL   the decision store, when the session has one
//     LEDGER_RENDER_PATH    the rendered ledger page this session republishes
//
// The store root comes from the environment, never from cwd. The
// platform's own Stop hook silently no-ops in multi-repo sessions
// because its first act is `git rev-parse` in cwd, which sits above
// every clone and is not a repo. A check that cannot fail is worse than
// no check: its silence reads as success.

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import {
  LedgerError,
  OPENING,
  countUserTurns,
  knownPrs,
  lastAssistantText,
  lastUserTurnAt,
  grillingInvokedAt,
  refViolations,
  reviewSignals,
  stripCode,
  ticketWrites,
  transcriptUsage,
} from "./core.mjs";
import { digestOf, readLog, stretchOf } from "./diligence.mjs";
import { append, push, readAll, resolveRoot, resolveSession, tail } from "./ledger.mjs";
import { blocklistTerms, scanText, shellRef } from "./scan.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const LEDGER = path.join(HERE, "ledger.mjs");

/** Local state the hook owns, under the home the session runs as. */
function localFile(name) {
  return path.join(process.env.HOME ?? "", ".claude", name);
}

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
function gitOrNull(repo, ...args) {
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
function committedThisTurn(repo, turnStart) {
  if (!turnStart) return false;
  const since = gitOrNull(repo.path, "log", `--since=${turnStart.toISOString()}`, "--format=%H");
  return Boolean(since);
}

// --------------------------------------------------------------- checks

/**
 * Check 1 — the turn declared what it touched, this turn.
 *
 * A summary left in place from an earlier turn is present, well-formed
 * and about different work, so existence cannot be the test: every
 * check downstream would diff against the wrong declaration and report
 * on a turn nobody asked about. Freshness is the mtime against the
 * stamp of the message the principal last typed.
 */
function checkTurnSummary(ctx) {
  // The block teaches the validated writer, never the raw file: hand
  // edits are what let a malformed declaration reach this hook at all
  // (skills#157), and naming the path invites them.
  const write = `  node ${LEDGER} declare --reviews <none|read|persisted|nothing-to-persist> [--tickets owner/repo#n] [--no-update "<target> <reason>"]`;

  // Without a boundary nothing downstream means what it says: freshness
  // has nothing to compare against and check 3's window widens to all
  // of history, so both would report a pass they never established.
  // This blocks rather than reporting `unconfigured` — an unset repo
  // root is a deployment declining check 2, whereas the platform always
  // supplies a transcript, so its absence is something broken and the
  // hook cannot do what it was registered for.
  if (!ctx.turnStart) {
    return {
      verdict: "fail",
      detail: `no user turn in ${ctx.transcript ?? "(no transcript path given)"}`,
      reason: [
        "The turn is not complete until this hook can tell where it began. " +
          "The transcript it was given holds no message from the principal, " +
          "so nothing establishes the turn's boundary and no check " +
          "downstream can be trusted.",
        "",
        `  ls -l ${ctx.transcript ?? "<no transcript path was given>"}`,
      ].join("\n"),
    };
  }

  // Identity before anything that depends on it. A store with several
  // conversations and nothing naming this one leaves the recorder
  // falling back to a platform-local id that matches no log, so check 3
  // compares against events nothing ever writes and can never pass —
  // block, release, repeat. Saying which configuration is missing costs
  // one turn; failing as though the ledger were behind costs every one
  // after it.
  if (!ctx.namedItself && ctx.conversations > 1) {
    return {
      verdict: "fail",
      detail: `${ctx.conversations} conversations in the store and none named as this one`,
      reason: [
        "The turn is not complete until this session names which " +
          `conversation it is. The store holds ${ctx.conversations} ` +
          "conversations and nothing says which one this turn belongs to, so " +
          "no check can tell this session's events from another's.",
        "",
        "  echo 'SESSION_URL=<this conversation's URL>' >> $HOME/.claude/session.env",
      ].join("\n"),
    };
  }

  const stale = ctx.summary.exists && ctx.turnStart && ctx.summary.writtenAt < ctx.turnStart;
  if (!ctx.summary.exists || stale) {
    return {
      verdict: "fail",
      detail: stale
        ? `turn summary predates the turn (written ${ctx.summary.writtenAt.toISOString()})`
        : "no turn summary",
      reason: [
        "The turn is not complete until it declares itself. Declare the " +
          "tickets this turn touched and its reviews state; the threads are " +
          "observed from the ledger, not declared (skills#153).",
        "",
        write,
      ].join("\n"),
    };
  }

  // Threads are DERIVED from the ledger's own events this turn
  // (skills#153) — the declaration was redundant with the observation,
  // and the empty-declaration trap moved to check 3, which measures
  // commits against observed events instead of declared names.
  return {
    verdict: "pass",
    detail: ctx.summary.legacy
      ? "turn summary read from the v1 path — deprecated, migrate the wrapper (skills#153)"
      : "turn summary fresh",
  };
}

/**
 * Check 2 — every clone is committed and pushed.
 *
 * Unconfigured rather than passing when no repo root is named: a check
 * with nothing to look at has not looked, and recording that as a pass
 * would put the absence and the success in the same column of the very
 * log that exists to tell them apart.
 */
function checkPushed(ctx) {
  // Unset is a deployment declining this check. Set-and-missing is a
  // typo, and reporting it as a pass over zero clones would file a
  // misconfiguration as health in the log built to tell those apart.
  // Both are "nothing was examined", which is what the verdict says.
  if (!ctx.repoRoot) {
    return {
      verdict: "unconfigured",
      detail: "HEARTBEAT_REPO_ROOT is unset — no clones were examined",
    };
  }
  if (!fs.existsSync(ctx.repoRoot)) {
    return {
      verdict: "unconfigured",
      detail: `HEARTBEAT_REPO_ROOT names ${ctx.repoRoot}, which does not exist — no clones were examined`,
    };
  }
  for (const repo of ctx.clones) {
    // The store is the hook's own output, not the session's work: the
    // seal dirties it, so reporting it would be the hook observing
    // itself and blocking every turn on a commit nobody can make.
    // The seal protocol's third phase pushes it once the turn is green.
    if (ctx.root && path.resolve(repo.path) === path.resolve(ctx.root)) continue;
    const branch = gitOrNull(repo.path, "rev-parse", "--abbrev-ref", "HEAD") ?? "HEAD";
    // Uncommitted before unpushed: a change that is not committed cannot
    // be pushed, and HEAD against origin cannot see it at all.
    if (gitOrNull(repo.path, "status", "--porcelain")) {
      return {
        verdict: "fail",
        detail: `${repo.name} has uncommitted changes`,
        reason: [
          "The turn is not complete until every clone is committed and " +
            `pushed. Uncommitted: ${repo.name}.`,
          "",
          `  git -C ${repo.path} add -A && git -C ${repo.path} commit -m ` +
            `"<type>: <what changed>" && git -C ${repo.path} push -u origin ${branch}`,
        ].join("\n"),
      };
    }
    // The remote counterpart, whether or not tracking was configured.
    // A branch created and never pushed has no upstream, and that says
    // nothing about whether work is waiting.
    const tracked = gitOrNull(repo.path, "rev-parse", "--abbrev-ref", "@{upstream}");
    const named = gitOrNull(repo.path, "rev-parse", "--verify", "--quiet", `origin/${branch}`);
    const upstream = tracked ?? (named ? `origin/${branch}` : null);
    const behind = upstream
      ? gitOrNull(repo.path, "rev-list", "--count", `HEAD..${upstream}`)
      : null;
    // Behind before ahead. Divergence from the pushed branch runs both
    // ways, and the direction that arrives silently is this one: a
    // clone rolled back by a resume has a clean tree, the right branch
    // name and every file in place. A clone that is BOTH has to
    // reconcile before it can push, so naming the push first would hand
    // over a command that cannot succeed.
    //
    // What this cannot see, deliberately: a restore that rolls `.git`
    // back takes the remote-tracking refs with it, so both sides of the
    // comparison move together and nothing local differs. Catching it
    // needs a fetch, and a fetch per clone per turn is the wrong price
    // for a check whose worth is being cheap enough to always run. The
    // SessionStart clone report fetches once, at the moment a resume
    // would produce the rollback; that is where the case is covered.
    if (behind && behind !== "0") {
      return {
        verdict: "fail",
        detail: `${repo.name} is ${behind} commits behind ${upstream}`,
        reason: [
          "The turn is not complete until every clone matches its pushed " +
            `branch. Behind origin: ${repo.name}.`,
          "",
          `  git -C ${repo.path} fetch origin ${branch} && ` +
            `git -C ${repo.path} merge --ff-only origin/${branch}`,
        ].join("\n"),
      };
    }
    // Commits this clone holds that exist on no remote ref at all. That
    // is the question worth asking — it answers "ahead of upstream" and
    // "branched but never pushed" together, and it does not mistake a
    // clone nobody wrote to for work about to be lost.
    const unpushed = gitOrNull(repo.path, "rev-list", "--count", "HEAD", "--not", "--remotes");
    if (unpushed === "0") continue;
    return {
      verdict: "fail",
      detail: `${repo.name} holds ${unpushed} commits that are on no remote`,
      reason: [
        "The turn is not complete until every clone is committed and " +
          `pushed. Unpushed: ${repo.name}.`,
        "",
        `  git -C ${repo.path} push -u origin ${branch}`,
      ].join("\n"),
    };
  }
  return { verdict: "pass", detail: `${ctx.clones.length} clones committed and pushed` };
}

/**
 * Check 7 — nothing outgoing carries a blocked term (skills#46).
 *
 * Scans what is about to LEAVE — commits on no remote, tracked changes
 * a commit would sweep up, and the rendered page — never untracked
 * files or the environment: a term may legitimately live in env or
 * scratchpad and must only never leave. Runs before the pushed check so
 * this block precedes that check's push instruction; a term caught here
 * is still local. Reasons name the SOURCE of a hit, never its value,
 * and the confirm command counts matches rather than printing them —
 * echoing either would put the secret in the very channel this check
 * guards.
 */
function checkPushBlocklist(ctx) {
  const terms = blocklistTerms(process.env);
  // Unset store URLs and no PUSH_BLOCKLIST is a deployment with nothing
  // to guard, and "nothing was scanned for" is what the verdict says.
  if (!terms.length) {
    return {
      verdict: "unconfigured",
      detail: "no store URL variables and no PUSH_BLOCKLIST — nothing to scan for",
    };
  }
  const hits = [];
  for (const repo of ctx.clones) {
    const outgoing = [
      gitOrNull(repo.path, "log", "-p", "HEAD", "--not", "--remotes") ?? "",
      gitOrNull(repo.path, "diff", "HEAD") ?? "",
    ].join("\n");
    for (const label of scanText(outgoing, terms)) {
      hits.push({
        source: label,
        where: `the outgoing diff in ${repo.name}`,
        confirm:
          `git -C ${repo.path} log -p HEAD --not --remotes | grep -cF ${shellRef(label)} && ` +
          `git -C ${repo.path} diff HEAD | grep -cF ${shellRef(label)}`,
      });
    }
  }
  if (ctx.renderPath && fs.existsSync(ctx.renderPath)) {
    for (const label of scanText(fs.readFileSync(ctx.renderPath, "utf8"), terms)) {
      hits.push({
        source: label,
        where: `the rendered page at ${ctx.renderPath}`,
        confirm: `grep -cF ${shellRef(label)} ${ctx.renderPath}`,
      });
    }
  }
  if (!hits.length) {
    return { verdict: "pass", detail: `${terms.length} terms scanned, nothing outgoing carries one` };
  }
  return {
    verdict: "fail",
    detail: hits.map((hit) => `${hit.where} carries the value of ${hit.source}`).join("; "),
    reason: [
      "The turn is not complete while outgoing content carries a blocked " +
        "term. Hits, by source — values are never printed:",
      "",
      ...hits.flatMap((hit) => [
        `  ${hit.where} carries the value of ${hit.source}`,
        `    confirm (match counts only): ${hit.confirm}`,
      ]),
      "",
      "Remove the term from what would leave — amend or drop the commits, " +
        "or re-render the page from a clean source — before anything is " +
        "pushed or published. Untracked files and the environment are not " +
        "scanned: a term may live there, it must only never leave.",
    ].join("\n"),
  };
}

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
function observedThreads(ctx) {
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

/**
 * Check 3 — the ledger heard about the turn's work.
 *
 * The original heartbeat, inverted by skills#153: threads are observed
 * from the ledger's own events, so a declaration can no longer name a
 * thread the ledger never heard of — the two-step trap (#123) is gone
 * by construction. What remains checkable is the empty-observation
 * trap that used to live in check 1: the turn's own commits are
 * evidence it cannot write about itself, so a turn that committed to a
 * clone while appending nothing is a turn the ledger knows nothing
 * about.
 */
function checkLedgerEvent(ctx) {
  // Every check runs even once one has failed, so this has to survive a
  // turn with no boundary rather than throw into the crash handler and
  // replace check 1's reason with a stack trace.
  if (!ctx.turnStart) {
    return { verdict: "unconfigured", detail: "no turn boundary to measure against" };
  }
  const touched = observedThreads(ctx);
  if (!touched.size) {
    const committed = ctx.clones.find((repo) => committedThisTurn(repo, ctx.turnStart));
    if (committed) {
      return {
        verdict: "fail",
        detail: `committed to ${committed.name} with no ledger event this turn`,
        reason: [
          "The turn is not complete until the ledger has an event for the " +
            `work behind it. It committed to ${committed.name} and appended ` +
            "nothing, so the ledger knows nothing about this turn.",
          "",
          `  node ${LEDGER} append --ev progress --thread <slug> --note <what happened>`,
        ].join("\n"),
      };
    }
    return { verdict: "pass", detail: "no events and no commits this turn — nothing to record" };
  }
  return { verdict: "pass", detail: `${touched.size} threads observed` };
}

// --------------------------------------------------------- decisions

// DECISION:SCOPE — only the MARKED half of documenting-decisions is
// mechanized. "A decision was made and never marked" is not decidable
// from observed state: the skill's own rule exempts routine changes,
// and nothing separates an interpolation from a pattern-follow. A check
// guessing at it would fire on every commit and be disabled in a day.
/** The marker documenting-decisions places, added by a commit. */
const MARKER = /^\+.*DECISION:(ARCH|SCOPE|IFACE|SEC|IRREV|NOVEL)\b/;

/**
 * Everything under a kata fixture tree is data staged for a test —
 * including the shell that stages it, whose string literals write
 * markers into throwaway repos precisely so the check can find them
 * THERE (#86). A marker in such a file is nobody's decision, and the
 * only record that would clear it describes reasoning nobody had. The
 * harness running the katas sits outside this path, so a genuine
 * decision about how katas run is still markable and still owed.
 */
export const FIXTURE_PATH = /(^|\/)tests\/(.*\/)?katas\//;

/** The file the recorder writes when a session is open in a checkout. */
const RECORDER_STATE = ".recorder-session.json";

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
function storeCheckout(url, clones) {
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
 * Decision markers this turn's commits ADDED, in order.
 *
 * DECISION:SCOPE — the turn's diff, never the working tree.
 *
 * The diff, not the working tree. Every repo accumulates markers, and a
 * check reading the tree would collect all of them, block on the first
 * forever, and be switched off by the end of the day — a reminder that
 * is right about things the turn cannot fix is a reminder nobody keeps.
 */
function markersThisTurn(repo, turnStart) {
  // Selected by AUTHOR date, which names the turn in which the
  // reasoning was available to write down — the check's whole premise.
  // `--since` filters the COMMITTER date, and a rebase mints a fresh
  // one while preserving the author's: every marker in every merged
  // branch then read as added this turn, and the block scaled with the
  // size of the merge (#73).
  //
  // `--since` stays as the cheap pre-filter, because it cannot exclude
  // anything wanted: a commit authored after the boundary cannot have
  // been committed before it, so this set is a superset of the turn's
  // own work.
  const listed = gitOrNull(
    repo.path,
    "log",
    `--since=${turnStart.toISOString()}`,
    "--format=%H %aI",
  );
  if (!listed) return [];
  const mine = listed
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => line.split(" "))
    .filter(([, authored]) => authored && new Date(authored) >= turnStart)
    .map(([sha]) => sha);
  if (!mine.length) return [];
  const diff = gitOrNull(
    repo.path,
    "log",
    "--no-walk",
    "--unified=0",
    "--format=",
    "-p",
    ...mine,
  );
  if (!diff) return [];
  const found = [];
  let file = null;
  for (const line of diff.split("\n")) {
    if (line.startsWith("+++ b/")) {
      file = line.slice(6);
      continue;
    }
    if (file && FIXTURE_PATH.test(file)) continue;
    const hit = MARKER.exec(line);
    if (hit) found.push({ at: `${repo.name}/${file}`, tag: hit[1] });
  }
  return found;
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
function recordsThisTurn(root, turnStart) {
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
 * The decision-record check — a decision marked in the code has a
 * record beside it.
 *
 * The reasoning behind a decision is free to write down in the turn
 * that made it and can only be reconstructed afterwards; a
 * reconstructed prediction scores nothing, which is the whole purpose
 * of the record. So the reminder has to arrive in that turn.
 *
 * What it does NOT check, deliberately: whether a decision that was
 * made got marked at all. The skill's own rule is that routine changes
 * carry no marker, and nothing observable separates an interpolation
 * from a pattern-follow — a check guessing at that would fire on every
 * commit, which is how reminders get turned off. The marked half is
 * observable on both sides, so that is the half mechanized.
 */
function checkDecisionRecord(ctx) {
  if (!ctx.turnStart) {
    return { verdict: "unconfigured", detail: "no turn boundary to measure against" };
  }
  // A session with no decision store is the ordinary case. Filing that
  // as a pass would put "checked and clean" and "never looked" in the
  // same column of the log built to tell them apart.
  if (!ctx.decisionUrl) {
    return {
      verdict: "unconfigured",
      detail: "DECISION_MEMORY_URL is unset — no decision store was examined",
    };
  }
  // Never the value. The store URLs are secrets, and the compliance log
  // is a file this hook appends to on every single turn — naming the
  // variable is what a misconfiguration needs to be fixed anyway.
  const { store, open } = storeCheckout(ctx.decisionUrl, ctx.clones);
  // Two checkouts both claiming an open recorder session cannot be
  // guessed between: records could land in either, and reading the
  // wrong one books a recorded decision as missing. Named as its own
  // condition — paths, never the URL — so the fix is visible.
  if (open.length > 1) {
    return {
      verdict: "unconfigured",
      detail:
        "DECISION_MEMORY_URL matches several checkouts with open recorder " +
        `sessions (${open.join(", ")}) — ambiguous, no decision store was examined`,
    };
  }
  if (!store) {
    return {
      verdict: "unconfigured",
      detail:
        "DECISION_MEMORY_URL names a store with no checkout among the " +
        "session's clones — no decision store was examined",
    };
  }
  const markers = ctx.clones.flatMap((repo) => markersThisTurn(repo, ctx.turnStart));
  if (!markers.length) {
    return { verdict: "pass", detail: "no decision markers landed this turn" };
  }
  const records = recordsThisTurn(store, ctx.turnStart);
  if (records.length) {
    return {
      verdict: "pass",
      detail: `${markers.length} marked, ${records.length} recorded this turn`,
    };
  }

  // `open` mints a session branch off the default branch every time it
  // runs, so offering it to a checkout that already has one strands the
  // records committed on the branch it replaces — a reminder whose own
  // command loses work. The state file says which case this is, so the
  // offer is read rather than guessed, exactly as check 3 reads the
  // transition table.
  // DECISION:ARCH — the offered command is read from the recorder's own
  // state file, not fixed.
  const recorder = `python ${path.join(store, "tools", "record.py")}`;
  const opened = fs.existsSync(path.join(store, RECORDER_STATE));
  const [first] = markers;
  return {
    verdict: "fail",
    detail:
      `${markers.length} marker${markers.length === 1 ? "" : "s"} added this turn ` +
      "with no record in the decision store",
    reason: [
      "The turn is not complete until every decision it marked has a " +
        `record. Marked and unrecorded: ${markers.length} marker` +
        `${markers.length === 1 ? "" : "s"}, first at ${first.at} (${first.tag}).`,
      "",
      `  ${opened ? "" : `${recorder} open && `}${recorder} record --from <drafts.json>`,
    ].join("\n"),
  };
}

/**
 * Check 4 — every ticket the turn declared heard about it.
 *
 * The declared set diffs against issue-writing tool calls in the
 * transcript — no network, same unlock as every transcript-side
 * check. Fires on EVERY declared ticket lacking an observed write, by
 * ruling: better a coarse reminder than a ticket that silently
 * diverges from what the session knows. The per-ticket escape is the
 * `no-update:` waiver — logged as a claim, never verified, so
 * declining to update is a visible act rather than a silence.
 */
function checkTicketsUpdated(ctx) {
  if (!ctx.turnStart) {
    return { verdict: "unconfigured", detail: "no turn boundary to measure against" };
  }
  const declared = ctx.summary.tickets
    .map((ticket) => ticket.toLowerCase())
    .filter((ticket) => /^[\w.-]+\/[\w.-]+#\d+$/.test(ticket));
  if (!declared.length) {
    return { verdict: "pass", detail: "no tickets declared — nothing to diff" };
  }
  const written = ticketWrites(ctx.transcriptText, ctx.turnStart.toISOString());
  const waived = declared.filter((ticket) => ctx.summary.waivers[ticket]);
  const missing = declared.filter(
    (ticket) => !written.has(ticket) && !ctx.summary.waivers[ticket],
  );
  if (!missing.length) {
    const claims = waived.length
      ? `; waived as claims: ${waived.map((t) => `${t} (${ctx.summary.waivers[t]})`).join(", ")}`
      : "";
    return { verdict: "pass", detail: `${declared.length} tickets declared${claims}` };
  }
  return {
    verdict: "fail",
    detail: `no observed write for ${missing.join(", ")}`,
    reason: [
      "The turn is not complete until every ticket it declared heard " +
        `about it. Declared and never written to this turn: ` +
        `${missing.join(", ")}. Update each one on the forge, or waive ` +
        "it explicitly — redeclare with a waiver per ticket, which is " +
        "logged as a claim:",
      "",
      `  node ${LEDGER} declare <your declaration> --no-update "<owner/repo#n> <why>"`,
    ].join("\n"),
  };
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
function storeWroteThisTurn(root, turnStart) {
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

/**
 * Check 8 — every ruling the turn declared is a record in the store.
 *
 * The `rulings:` summary line names the slugs the principal ruled on
 * this turn; each one must appear in a decisions/ filename that
 * ARRIVED this turn. Purely mechanical — declared set vs observed
 * files — so it lands blocking. The blind spot is accepted by ruling
 * E10: a ruling the turn never declares is invisible here, and the
 * habit of declaring is what the grammar trains.
 */
function checkRulingsRecorded(ctx) {
  if (!ctx.turnStart) {
    return { verdict: "unconfigured", detail: "no turn boundary to measure against" };
  }
  if (!ctx.summary.rulings.length) {
    return { verdict: "pass", detail: "no rulings declared — nothing to diff" };
  }
  if (!ctx.decisionUrl) {
    return {
      verdict: "unconfigured",
      detail: "rulings declared but DECISION_MEMORY_URL is unset — nothing was checked",
    };
  }
  const { store, open } = storeCheckout(ctx.decisionUrl, ctx.clones);
  if (!store) {
    return {
      verdict: "unconfigured",
      detail: "rulings declared but the decision store has no checkout to observe",
    };
  }
  if (open.length > 1) {
    return {
      verdict: "unconfigured",
      detail: `${open.length} decision-store checkouts have open recorder sessions — ambiguous`,
    };
  }
  const arrived = recordsThisTurn(store, ctx.turnStart);
  const missing = ctx.summary.rulings.filter(
    (slug) => !arrived.some((name) => name.includes(slug)),
  );
  if (!missing.length) {
    return { verdict: "pass", detail: `${ctx.summary.rulings.length} declared rulings recorded` };
  }
  const recorder = `python3 ${path.join(store, "tools", "record.py")}`;
  return {
    verdict: "fail",
    detail: `no record arrived for ${missing.join(", ")}`,
    reason: [
      "The turn is not complete until every ruling it declared is a " +
        `record. Declared and not in any decisions/ file that arrived ` +
        `this turn: ${missing.join(", ")}. Write each record, or correct ` +
        "the declaration to the slugs actually recorded.",
      "",
      `  ${recorder} record --from <drafts.json>`,
    ].join("\n"),
  };
}

/**
 * Check 13 — a grilling leaves records behind. Observe-first.
 *
 * The invocation is mechanical (the slash command or the Skill call
 * is in the transcript); the TIMING is not — answers arrive in waves
 * over later turns and the records legitimately land when the rulings
 * settle. A blocking check would fire between waves, so this one only
 * observes: invocation seen, records since it counted, verdict always
 * a pass with the state in its detail. Ruling A2 — a heuristic
 * detector is measured before it may nag.
 */
function checkGrillingRecorded(ctx) {
  if (!ctx.turnStart) {
    return { verdict: "unconfigured", detail: "no turn boundary to measure against" };
  }
  const invoked = grillingInvokedAt(ctx.transcriptText);
  if (!invoked) {
    return { verdict: "pass", detail: "no grilling invoked this session" };
  }
  if (!ctx.decisionUrl) {
    return {
      verdict: "unconfigured",
      detail: "grilling invoked but DECISION_MEMORY_URL is unset — nothing was checked",
    };
  }
  const { store } = storeCheckout(ctx.decisionUrl, ctx.clones);
  if (!store) {
    return {
      verdict: "unconfigured",
      detail: "grilling invoked but the decision store has no checkout to observe",
    };
  }
  const since = recordsThisTurn(store, new Date(invoked)).length;
  return {
    verdict: "pass",
    detail: since
      ? `grilling invoked; ${since} records since`
      : "grilling invoked and no record since — observing, not blocking",
  };
}

/**
 * Check 10 — completed work with a PR leaves a kata behind. Remind-once.
 *
 * The trigger is mechanical (a `completed` event carrying `--pr`
 * landed this turn); the adequacy of a kata is not, and a hook that
 * pretended otherwise would block on a judgement it cannot make. So
 * this check reminds exactly once per thread — the fresh-incident
 * moment is when a kata is cheap to write — and afterwards records
 * only the claim. The delivered set is hook-owned local state, keyed
 * by session and thread.
 */
function checkKataReminder(ctx) {
  if (!ctx.turnStart) {
    return { verdict: "unconfigured", detail: "no turn boundary to measure against" };
  }
  const start = ctx.turnStart.getTime();
  const finished = ctx.events
    .filter((event) => event.anchor?.session === ctx.session || event.by)
    .filter((event) => event.at && new Date(event.at).getTime() >= start)
    .filter((event) => event.ev === "completed" && event.pr);
  if (!finished.length) {
    return { verdict: "pass", detail: "nothing completed with a PR this turn" };
  }
  const file = localFile("kata-reminders.json");
  let delivered = {};
  try {
    delivered = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    delivered = {};
  }
  const fresh = finished.filter((event) => !delivered[`${ctx.session}/${event.thread}`]);
  if (!fresh.length) {
    return {
      verdict: "pass",
      detail: `kata reminder already delivered for ${finished
        .map((event) => event.thread)
        .join(", ")} — adequacy stays a claim`,
    };
  }
  // Marked delivered at FIRING: remind-once means once, whatever the
  // model does with it — a reminder that re-fires until obeyed is a
  // blocking check wearing a softer name.
  for (const event of fresh) delivered[`${ctx.session}/${event.thread}`] = event.pr;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(delivered, null, 2), "utf8");
  const [first] = fresh;
  return {
    verdict: "fail",
    detail: `completed with a PR and no kata prompt yet: ${fresh
      .map((event) => event.thread)
      .join(", ")}`,
    reason: [
      `${first.thread} completed with ${first.pr} this turn. A kata ` +
        "freezes the incident while it is fresh — the corpus is this " +
        "org's own failure catalogue, and a case not written down now " +
        "is reconstructed later or lost. Write the kata, or note in the " +
        "thread why none is owed. This reminder fires once and will not " +
        "block again.",
    ].join("\n"),
  };
}

/**
 * Check 11 — a question-shaped close is a blocked thread. Observe-only.
 *
 * The detector is imperfect by admission: a final message ending in a
 * question USUALLY means the turn is waiting on the principal, and a
 * wait not captured as a `blocked` event is invisible to the next
 * session. Imperfect detectors do not block (ruling A2) — this one
 * logs what it sees, and the compliance data decides whether it ever
 * earns a voice.
 */
function checkBlockedCaptured(ctx) {
  if (!ctx.turnStart) {
    return { verdict: "unconfigured", detail: "no turn boundary to measure against" };
  }
  const text = (ctx.assistantText ?? "").trimEnd();
  if (!text.endsWith("?")) {
    return { verdict: "pass", detail: "the close is not question-shaped" };
  }
  const start = ctx.turnStart.getTime();
  const blocked = ctx.events
    .filter((event) => event.anchor?.session === ctx.session)
    .filter((event) => event.at && new Date(event.at).getTime() >= start)
    .some((event) => event.ev === "blocked");
  return {
    verdict: "pass",
    detail: blocked
      ? "question-shaped close and a blocked event captured"
      : "question-shaped close and no blocked event — observing, not blocking",
  };
}

/**
 * Check 14 — what a review decided is persisted, not just read.
 *
 * The truth source is the attribution-footer contract: a fetched
 * comment body without the footer was written by a human, and a
 * human's review answers that live only in the transcript are lost
 * with the container. Coarse turn-level match by ruling — human
 * comments in, zero memory writes out, fires once; either store
 * counts as persisted, because "not lost" beats "right cabinet".
 *
 * The summary's `reviews:` line is an ADDITIONAL signal, cross-checked
 * and never trusted alone: a declaration can widen detection — its own
 * contradiction fires — but a claim from the context that already
 * believed the work happened cannot green the check. The one
 * exception is the explicit waiver, `nothing-to-persist`, which is
 * logged as a claim exactly so declining to persist is a visible act
 * rather than a silence. The footer heuristic on its own, with no
 * declaration to contradict, only observes.
 */
function checkReviewPersistence(ctx) {
  if (!ctx.turnStart) {
    return { verdict: "unconfigured", detail: "no turn boundary to measure against" };
  }
  const declared = ctx.summary.reviews;
  const token = declared ? declared.split(/[\s,]+/)[0].toLowerCase() : null;
  const known = [null, "none", "read", "persisted", "nothing-to-persist"];
  if (!known.includes(token)) {
    return {
      verdict: "fail",
      detail: `unreadable reviews declaration: ${declared}`,
      reason: [
        "The turn is not complete until its reviews declaration parses. " +
          `\`reviews: ${declared}\` names no state this check reads — declare ` +
          "one of: none, read, persisted, nothing-to-persist.",
      ].join("\n"),
    };
  }
  const stores = [];
  for (const [name, url] of [
    ["decision-memory", ctx.decisionUrl],
    ["evidence-memory", ctx.evidenceUrl],
  ]) {
    if (!url) continue;
    const { store } = storeCheckout(url, ctx.clones);
    if (store) stores.push({ name, path: store });
  }
  const observed = reviewSignals(
    ctx.transcriptText,
    ctx.turnStart.toISOString(),
    ctx.agentAccounts,
  );
  // The account safeguard, ahead of everything the footer decides: with
  // distinct accounts configured, a footer on a foreign account or an
  // agent account posting bare means the attribution contract itself is
  // broken, and every classification built on it is suspect. Loud by
  // request, and opt-in by construction — no AGENT_ACCOUNTS, no check.
  if (observed.anomalies.length) {
    const [first] = observed.anomalies;
    const what =
      first.kind === "footer-drift"
        ? `the agent account ${first.author} posted WITHOUT the attribution footer`
        : `the account ${first.author} carries the attribution footer and is not a configured agent account`;
    return {
      verdict: "fail",
      detail: `${observed.anomalies.length} footer-contract anomalies, first: ${first.kind} by ${first.author}`,
      reason: [
        "The turn is not complete while the attribution-footer contract " +
          `is broken: ${what}. Every human/agent reading built on the ` +
          "footer is suspect until the posting account or the footer " +
          "habit is fixed — or AGENT_ACCOUNTS is corrected to name the " +
          "accounts the agent actually posts as.",
      ].join("\n"),
    };
  }
  const wrote = stores
    .filter((entry) => storeWroteThisTurn(entry.path, ctx.turnStart))
    .map((entry) => entry.name);
  if (wrote.length) {
    return { verdict: "pass", detail: `persistence observed: ${wrote.join(", ")}` };
  }
  // The contradiction needs no store to be wrong: the turn said no
  // comments were read, and the transcript shows human ones fetched.
  if (token === "none" && observed.human) {
    return {
      verdict: "fail",
      detail: "declared none, but human comment bodies were fetched this turn",
      reason: [
        "The turn is not complete while the summary contradicts the " +
          "transcript. It declares `reviews: none`, but comments fetched " +
          "this turn carry no attribution footer — comments a human wrote. " +
          "Persist what they decided as a decision-memory or " +
          "evidence-memory record and declare `reviews: persisted`.",
      ].join("\n"),
    };
  }
  if ((token === "read" || token === "persisted") && !stores.length) {
    return {
      verdict: "unconfigured",
      detail: `declared ${token}, but no memory store checkout was found to observe`,
    };
  }
  if (token === "persisted") {
    return {
      verdict: "fail",
      detail: "declared persisted, but no memory checkout gained a write this turn",
      reason: [
        "The turn is not complete while the summary claims a persistence " +
          "no store shows. It declares `reviews: persisted`, but no memory " +
          "checkout gained a write this turn. Write the record, or declare " +
          "what actually happened — a declaration widens detection and " +
          "never greens this check.",
      ].join("\n"),
    };
  }
  if (token === "read") {
    return {
      verdict: "fail",
      detail: "reviews read this turn and nothing reached a memory",
      reason: [
        "The turn is not complete until what the review decided is written " +
          "down. The summary declares `reviews: read` and no memory " +
          "checkout gained a write this turn — answers that live only in " +
          "the transcript are lost with it. Persist the outcome as a " +
          "decision-memory or evidence-memory record, or declare " +
          "`reviews: nothing-to-persist` if the comments changed nothing — " +
          "that waiver is logged as a claim.",
      ].join("\n"),
    };
  }
  if (token === "nothing-to-persist") {
    return {
      verdict: "pass",
      detail: "nothing-to-persist declared — a claim, logged unverified",
    };
  }
  if (token === null && observed.human) {
    return {
      verdict: "pass",
      detail:
        "human comment bodies fetched and nothing declared — observed only " +
        "(the footer heuristic runs observe-first)",
    };
  }
  return { verdict: "pass", detail: "no review activity declared or observed" };
}

/**
 * Check 5 — the rendered ledger page is newer than what it should show.
 *
 * The silent-render incident, twice over: a dead render workflow hidden
 * for 21 runs by hand-rendering, then the published artifact drifting
 * 15 events stale the moment a compaction dropped the habit — while
 * every mechanized check held. The page kept rendering; it rendered
 * yesterday. Absence and success looked identical, which is this
 * hook's founding failure class.
 *
 * DECISION:SCOPE — freshness is the rendered FILE's mtime, because the
 * publish itself leaves no file evidence (it is a harness tool call).
 * The verifiable half is the render, and blocking there puts the
 * republish one step away, which is where check 3 already puts the
 * append.
 */
function checkArtifactFresh(ctx) {
  if (!ctx.turnStart) {
    return { verdict: "unconfigured", detail: "no turn boundary to measure against" };
  }
  if (!ctx.renderPath) {
    return {
      verdict: "unconfigured",
      detail: "LEDGER_RENDER_PATH is unset — no rendered page was examined",
    };
  }
  // The newest event a reader could be missing. Seals are excluded:
  // the hook writes one after every green turn, AFTER the render, so
  // counting them would put every healthy turn one render behind its
  // own seal, forever — a reminder that is always right and never
  // useful. Check 2 refuses to observe the hook's write in space; this
  // is the same rule in time.
  const newest = ctx.events
    .filter((event) => event.ev !== "sealed")
    .map((event) => (event.at ? new Date(event.at).getTime() : 0))
    .reduce((a, b) => Math.max(a, b), 0);
  if (!newest) {
    return { verdict: "pass", detail: "no events to show — nothing to render" };
  }
  const renderedAt = fs.existsSync(ctx.renderPath) ? fs.statSync(ctx.renderPath).mtime.getTime() : 0;
  if (renderedAt >= newest) {
    return { verdict: "pass", detail: "rendered page is newer than the newest event" };
  }
  // The command carries --session-url when the session knows it: a
  // store holding several conversations refuses to render without one,
  // and a command that errors leaves the model improvising inside the
  // single turn the hook allows it.
  const name = ctx.sessionUrl ? ` --session-url ${ctx.sessionUrl}` : "";
  return {
    verdict: "fail",
    detail: renderedAt
      ? `rendered page predates the newest event by ${Math.round((newest - renderedAt) / 1000)}s`
      : `nothing rendered at ${ctx.renderPath}`,
    reason: [
      "The turn is not complete until the rendered ledger page is newer " +
        `than the newest event it should show. ${ctx.renderPath} ` +
        `${renderedAt ? "predates the log" : "does not exist"}.`,
      "",
      `  node ${LEDGER} --root ${ctx.root}${name} render --out ${ctx.renderPath} ` +
        '--title "Thread ledger" — then republish the artifact from that file.',
    ].join("\n"),
  };
}

/**
 * Check 6 — the response follows the reference style, and a corrected
 * response actually contains its corrections (#99).
 *
 * The style: tickets and PRs in prose are linked shortcode refs
 * (`XXX#n` tickets, `XXX!n` PRs), a thread opened this turn is
 * announced as `new thread: <slug>`, and every thread the summary
 * declares is named in the prose that discusses it. Code spans are
 * quoted material and exempt.
 *
 * The exercise is the point: a block names the canonical forms and the
 * re-fire requires them PRESENT in the rewritten response — deleting
 * the offending refs silences the scanner while learning nothing, so
 * deletion does not pass. Pending expectations live in a state file
 * keyed by session and message; a stale key is dropped unread, because
 * holding one turn to another turn's homework grades the wrong student.
 */
function checkResponseHygiene(ctx) {
  if (!ctx.turnStart) {
    return { verdict: "unconfigured", detail: "no turn boundary to measure against" };
  }
  const mapFile = path.join(ctx.root, "config", "shortcodes.json");
  let shortcodes = null;
  try {
    shortcodes = JSON.parse(fs.readFileSync(mapFile, "utf8"));
  } catch {
    // Absent and unreadable land together: either way no map was
    // consulted, and "never looked" must not read as "clean".
    return {
      verdict: "unconfigured",
      detail: `no shortcode map at ${mapFile} — the response was not examined`,
    };
  }
  const response = ctx.assistantText ?? "";
  if (!response.trim()) {
    return { verdict: "pass", detail: "no response text to examine" };
  }
  const prose = stripCode(response);
  const violations = refViolations(prose, shortcodes, knownPrs(ctx.events));

  // Threads owed a name in prose: announced when opened this turn,
  // stated when observed with an event this turn (skills#153 — the
  // observation replaced the declaration). Matching is on the raw
  // response — backticks around a slug are style, not evasion.
  const start = ctx.turnStart.getTime();
  const openedNow = ctx.events
    .filter((event) => event.anchor?.session === ctx.session)
    .filter((event) => event.at && new Date(event.at).getTime() >= start)
    .filter((event) => OPENING.includes(event.ev))
    .map((event) => event.thread);
  const naming = [];
  for (const slug of new Set(openedNow)) {
    if (!new RegExp(`new thread:\\s*\`?${slug}\`?`, "i").test(response)) {
      naming.push({ slug, expected: `new thread: ${slug}` });
    }
  }
  for (const slug of observedThreads(ctx)) {
    if (openedNow.includes(slug)) continue;
    if (!response.includes(slug)) naming.push({ slug, expected: slug });
  }

  // Preflight reports and repairs notation; the correction exercise is
  // the Stop hook's pedagogy. A preflight that assigned or graded
  // homework would turn the linter into the gate it is explicitly not.
  if (ctx.preflight) {
    if (!violations.length && !naming.length) {
      return { verdict: "pass", detail: "response follows the reference style" };
    }
    return {
      verdict: "fail",
      detail: `${violations.length + naming.length} style violations in the draft`,
      reason: [
        ...violations.map((v) => `  ${v.token} — ${v.why}${v.canonical ? ` → ${v.canonical}` : ""}`),
        ...naming.map((n) => `  ${n.slug} — write: ${n.expected}`),
      ].join("\n"),
    };
  }

  // The pending exercise, before any new homework is assigned.
  const pendingFile = localFile("hygiene-corrections.json");
  let pending = null;
  try {
    pending = JSON.parse(fs.readFileSync(pendingFile, "utf8"));
  } catch {
    pending = null;
  }
  if (pending && (pending.session !== ctx.session || pending.msg !== ctx.msg)) {
    fs.rmSync(pendingFile, { force: true });
    pending = null;
  }
  if (pending) {
    const absent = (pending.expected ?? []).filter((s) => !response.includes(s));
    if (!absent.length && !violations.length && !naming.length) {
      fs.rmSync(pendingFile, { force: true });
      return { verdict: "pass", detail: "correction exercise completed" };
    }
    if (absent.length) {
      return {
        verdict: "fail",
        detail: `${absent.length} assigned corrections missing from the response`,
        reason: [
          "The turn is not complete until the corrected forms appear in the " +
            "response — removing the wrong refs is not writing the right " +
            "ones. Still missing, verbatim:",
          "",
          ...absent.map((s) => `  ${s}`),
        ].join("\n"),
      };
    }
  }

  if (!violations.length && !naming.length) {
    return { verdict: "pass", detail: "response follows the reference style" };
  }

  // New homework: every derivable canonical form, assigned and stored
  // so the re-fire can hold the rewrite to it.
  const expected = [
    ...violations.filter((v) => v.canonical).map((v) => v.canonical),
    ...naming.map((n) => n.expected),
  ];
  fs.mkdirSync(path.dirname(pendingFile), { recursive: true });
  fs.writeFileSync(
    pendingFile,
    JSON.stringify({ session: ctx.session, msg: ctx.msg, expected }, null, 2),
    "utf8",
  );
  const lines = [
    ...violations.map((v) => `  ${v.token} — ${v.why}${v.canonical ? ` → ${v.canonical}` : ""}`),
    ...naming.map((n) =>
      n.expected.startsWith("new thread:")
        ? `  ${n.slug} — opened this turn and never announced → write: ${n.expected}`
        : `  ${n.slug} — declared but never named in the response → state it by name`,
    ),
  ];
  return {
    verdict: "fail",
    detail: `${violations.length + naming.length} style violations in the response`,
    reason: [
      "The turn is not complete until the response follows the reference " +
        "style: linked shortcode refs (XXX#n tickets, XXX!n PRs), threads " +
        "named in prose. Rewrite your response and write each correction " +
        "out in full — the corrected forms must appear, verbatim:",
      "",
      ...lines,
    ].join("\n"),
  };
}

/**
 * Check 15 — no clone carries a local git identity.
 *
 * The identity that must sign and author every commit is derived once,
 * from the signing key's own uid, and written to the GLOBAL config. A
 * local `user.email` beats it, and a commit then names an identity the
 * key does not — which the forge validates cryptographically and still
 * renders Unverified, unmergeable under a verified-signatures ruleset,
 * with no error anywhere along the way (meta#74).
 *
 * Checked every turn rather than repaired once at SessionStart: the
 * harness writes these overrides when it attaches a clone, which can
 * happen mid-session, and a model reaching for `git config user.email`
 * to settle an unrelated complaint puts one back. A repair that only
 * runs before the work cannot see either.
 *
 * The fix REMOVES the local key rather than correcting it: one identity
 * held in one place cannot drift from the key's uid later.
 */
function checkCloneConfig(ctx) {
  if (!ctx.repoRoot) {
    return {
      verdict: "unconfigured",
      detail: "HEARTBEAT_REPO_ROOT is unset — no clones were examined",
    };
  }
  for (const repo of ctx.clones) {
    for (const key of ["user.email", "user.name"]) {
      const local = gitOrNull(repo.path, "config", "--local", "--get", key);
      if (!local) continue;
      return {
        verdict: "fail",
        detail: `${repo.name} sets ${key} locally (${local})`,
        reason: [
          "The turn is not complete until no clone overrides the git " +
            `identity locally: ${repo.name} sets ${key}. A commit made ` +
            "there is signed by a key that does not name its author, so " +
            "the forge renders it Unverified and it cannot be merged.",
          "",
          `  git -C ${repo.path} config --local --unset-all ${key}`,
        ].join("\n"),
      };
    }
  }
  return {
    verdict: "pass",
    detail: `${ctx.clones.length} clone(s) use the global identity`,
  };
}

/**
 * Check 16 — commits made this turn are signed, where signing is on.
 *
 * Gated on the clone's own effective config rather than assumed: a
 * deployment that does not sign is not failing, and reporting it as a
 * failure every turn would train the reader to skip the one report that
 * matters. Where `commit.gpgsign` IS set, an unsigned commit is a defect
 * that surfaces only at push time under the org's ruleset (meta#70),
 * long after the turn that made it.
 *
 * `%G?` is read for presence, not validity: `U` — good signature of
 * unknown validity — is the ordinary local answer for a key whose owner
 * trust was never set, and failing on it would fail every correctly
 * signed commit. Whether the forge can bind that signature to an account
 * is the identity question check 15 answers.
 */
function checkCommitSigned(ctx) {
  if (!ctx.turnStart) return { verdict: "pass", detail: "no turn boundary" };
  for (const repo of ctx.clones) {
    if (ctx.root && path.resolve(repo.path) === path.resolve(ctx.root)) continue;
    if (gitOrNull(repo.path, "config", "--get", "commit.gpgsign") !== "true") continue;
    const lines = gitOrNull(
      repo.path,
      "log",
      `--since=${ctx.turnStart.toISOString()}`,
      "--format=%H %G?",
    );
    if (!lines) continue;
    // The hashes go in the detail, which is logged, and never into the
    // reason, which is asserted: pinning a fixture's hash in a contract
    // string couples the wording to a value the harness can shift, and
    // the count plus the clone is what the reader acts on anyway.
    const unsigned = lines
      .split("\n")
      .map((line) => line.split(" "))
      .filter(([sha, state]) => sha && state === "N")
      .map(([sha]) => sha);
    if (!unsigned.length) continue;
    const branch = gitOrNull(repo.path, "rev-parse", "--abbrev-ref", "HEAD") ?? "HEAD";
    const named = gitOrNull(repo.path, "rev-parse", "--verify", "--quiet", `origin/${branch}`);
    // An unsigned commit cannot have been pushed — the ruleset refuses
    // it — so replaying onto the upstream rewrites only local history,
    // and one form covers a single commit and a run of them alike.
    const fix = named
      ? `git -C ${repo.path} rebase --exec 'git commit --amend --no-edit -S' origin/${branch}`
      : `git -C ${repo.path} commit --amend --no-edit -S`;
    return {
      verdict: "fail",
      detail: `${repo.name}: ${unsigned.length} unsigned this turn (${unsigned
        .map((sha) => sha.slice(0, 8))
        .join(", ")}) while commit.gpgsign is true`,
      reason: [
        "The turn is not complete until every commit it made is signed: " +
          `${repo.name} has ${unsigned.length} unsigned commit(s) from ` +
          "this turn while signing is configured, so the push will be " +
          "rejected by the verified-signatures ruleset.",
        "",
        `  ${fix}`,
      ].join("\n"),
    };
  }
  return {
    verdict: "pass",
    detail: "commits this turn are signed where signing is configured",
  };
}

/**
 * Check 17 — every working branch is linear (skills#147).
 *
 * A working branch is updated by rebase onto the default branch, never
 * by merging anything into it; the only legitimate merge commits are
 * the ones a forge makes when it merges a PR. Measured 2026-08-16:
 * main merged INTO a claude/* branch dragged 45 upstream commits into
 * the branch's rebase range, and the repair took four steps.
 *
 * The judgement is the branch's own range — `--merges HEAD --not
 * origin/<default>` — so a merge commit main already holds is the
 * forge's and passes, and so does a linear branch rebased on top of
 * one. The default branch is what the clone's origin/HEAD names, or
 * origin/main; a clone with neither is not judged, and says so.
 *
 * Runs before `pushed` deliberately: the per-clone pre-push hook
 * (the template's scripts/check-linear-history.sh at pre-push) refuses this exact state,
 * so telling the turn to push first would hand it a command that
 * cannot succeed. The subject goes in the reason, the hash in the
 * detail — the same split check 16 makes, for the same reason.
 */
function checkLinearHistory(ctx) {
  if (!ctx.repoRoot) {
    return {
      verdict: "unconfigured",
      detail: "HEARTBEAT_REPO_ROOT is unset — no clones were examined",
    };
  }
  let judged = 0;
  for (const repo of ctx.clones) {
    if (ctx.root && path.resolve(repo.path) === path.resolve(ctx.root)) continue;
    const branch = gitOrNull(repo.path, "symbolic-ref", "--short", "-q", "HEAD");
    if (!branch || !branch.startsWith("claude/")) continue;
    const head = gitOrNull(repo.path, "symbolic-ref", "-q", "--short", "refs/remotes/origin/HEAD");
    const target =
      head ??
      (gitOrNull(repo.path, "rev-parse", "--verify", "--quiet", "origin/main") ? "origin/main" : null);
    if (!target) continue;
    judged += 1;
    const merges = gitOrNull(repo.path, "rev-list", "--merges", "HEAD", "--not", target);
    if (!merges) continue;
    const shas = merges.split("\n").filter(Boolean);
    // The oldest merge is the one the rebase has to unpick first.
    const first = shas[shas.length - 1];
    const subject = gitOrNull(repo.path, "log", "-1", "--format=%s", first) ?? first.slice(0, 8);
    return {
      verdict: "fail",
      detail: `${repo.name} (${branch}): ${shas.length} merge commit(s) not on ${target} (${shas
        .map((sha) => sha.slice(0, 8))
        .join(", ")})`,
      reason: [
        "The turn is not complete until every working branch is linear: " +
          `${repo.name} is on ${branch}, which carries ${shas.length} merge ` +
          `commit${shas.length === 1 ? "" : "s"} main does not hold (${subject}). ` +
          "A working branch is rebased onto main, never merged into; the " +
          "forge's own merges are the only merge commits.",
        "",
        `  git -C ${repo.path} rebase ${target}`,
      ].join("\n"),
    };
  }
  return {
    verdict: "pass",
    detail: judged
      ? `${judged} working branch(es) linear against their default branch`
      : "no clone on a working branch with a known default branch — nothing judged",
  };
}

// Priority order. First failure wins; the rest wait for the next turn.
// push-blocklist sits ahead of pushed deliberately: a hit must block
// BEFORE the turn is told to push, or the reminder itself publishes it.
// At most this many blocks in one turn. Bounded because several checks
// are not agent-actionable — a network fault under `pushed`, a
// concurrent writer under `artifact-fresh`, a crash — and an unbounded
// loop over those traps the session, which is the fear the crash path
// already names. Bounded also because the checks that accept unverified
// claims (waivers, `nothing-to-persist`) make a false claim the cheapest
// exit from a loop: pressure past this point buys lies, not bookkeeping.
const MAX_BLOCKS = 3;

const CHECKS = [
  { check: "turn-summary", run: checkTurnSummary },
  { check: "push-blocklist", run: checkPushBlocklist },
  { check: "clone-config", run: checkCloneConfig },
  { check: "commit-signed", run: checkCommitSigned },
  { check: "linear-history", run: checkLinearHistory },
  { check: "pushed", run: checkPushed },
  { check: "ledger-event", run: checkLedgerEvent },
  { check: "tickets-updated", run: checkTicketsUpdated },
  { check: "decision-record", run: checkDecisionRecord },
  { check: "rulings-recorded", run: checkRulingsRecorded },
  { check: "review-persistence", run: checkReviewPersistence },
  { check: "grilling-recorded", run: checkGrillingRecorded },
  { check: "kata-reminder", run: checkKataReminder },
  { check: "blocked-captured", run: checkBlockedCaptured },
  { check: "response-hygiene", run: checkResponseHygiene },
  { check: "artifact-fresh", run: checkArtifactFresh },
];

// ------------------------------------------------------- compliance log

/** Every compliance record for `session`, oldest first. */
function recordsFor(file, session) {
  if (!fs.existsSync(file)) return [];
  const records = [];
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      const record = JSON.parse(line);
      if (record.session === session) records.push(record);
    } catch {
      // A torn line is not a cycle. Counting one would be worse than
      // missing it: the cost of a real cycle would land on the wrong
      // turn, where nothing could ever contradict it.
    }
  }
  return records;
}

/**
 * Where this turn began — stable across the hook's own re-fires.
 *
 * Every check measures "this turn" from here, so a boundary that moves
 * mid-turn silently rewrites all thirteen of them. It does move. The
 * block feedback this hook writes is delivered to the model as a user
 * turn carrying its own timestamp, so on the guarded fire both
 * `countUserTurns` and `lastUserTurnAt` advance past it, and work the
 * model did BEFORE it was blocked falls outside its own turn.
 *
 * Measured: `ledger-event` passed on a turn's first Stop ("1 threads
 * recorded") and failed twelve seconds later on the re-fire ("no event
 * this turn"), same store, same append — the append simply preceded the
 * feedback that moved the boundary.
 *
 * So the UNGUARDED fire defines the turn: it is the first Stop after the
 * principal spoke. A guarded fire inherits that boundary from the record
 * the opening fire wrote rather than recomputing it from a transcript
 * this hook has since added to.
 */
function turnBoundary(file, guarded, session, computed) {
  if (!guarded) return computed;
  const prior = recordsFor(file, session);
  const last = prior[prior.length - 1];
  return last?.turnKey ?? computed;
}

/**
 * Which Stop of this turn this is, counted from the log itself.
 *
 * `stop_hook_active` only says "at least one block already happened",
 * so it cannot tell a second cycle from a fifth. The log can, and it is
 * the same file the answer has to be written to. Counted by `turnKey`
 * rather than `msg`: `msg` advances on the re-fire (the feedback is a
 * user turn), so a same-turn record never matched and the counter was
 * pinned at 1 forever — measured across 24 records of one session.
 */
function cycleOf(file, ctx) {
  // Preflight rounds share the turn's key but are not Stops: counting
  // them would spend the block budget on lint runs the model asked for
  // and shift cycle 1 — the unprompted baseline — off the first Stop.
  return recordsFor(file, ctx.session)
    .filter((record) => record.turnKey === ctx.turnKey && record.outcome !== "preflight")
    .length + 1;
}

/** Checks already delivered as a block reason this turn. */
function deliveredThisTurn(file, ctx) {
  return new Set(
    recordsFor(file, ctx.session)
      .filter((record) => record.turnKey === ctx.turnKey && record.outcome === "blocked")
      .map((record) => record.fired)
      .filter(Boolean),
  );
}

/**
 * Record every check's verdict, pass or fail.
 *
 * This log is the input for measuring whether reminders change
 * behaviour at all — a reminder that never changes the next turn is a
 * reminder to delete. Logging only failures would measure only the
 * failures and leave the question unanswerable.
 */
function logCompliance(ctx, verdicts, outcome, fired) {
  const file = localFile("reminder-compliance.jsonl");
  writeCompliance(file, complianceRecord(file, ctx, verdicts, outcome, fired));
}

/** The record `logCompliance` would write, built without writing it. */
function complianceRecord(file, ctx, verdicts, outcome, fired) {
  return {
    at: new Date().toISOString().replace(/\.\d+Z$/, "+00:00"),
    session: ctx.session,
    msg: ctx.msg,
    // The turn's identity, written so the next fire of the same turn can
    // inherit it instead of recomputing a boundary this hook has moved.
    turnKey: ctx.turnKey,
    // Which Stop of this turn. Cycle 1 is the model's unprompted
    // attempt — it has not been reminded yet — so cycle-1 verdicts are
    // the no-reminder baseline, measured without a second arm to run.
    // Everything above 1 exists only because this hook blocked, and is
    // the reminder's cost in round-trips.
    cycle: cycleOf(file, ctx),
    model: ctx.usage.model,
    tokens: {
      input: ctx.usage.input,
      output: ctx.usage.output,
      cacheRead: ctx.usage.cacheRead,
      cacheCreation: ctx.usage.cacheCreation,
    },
    guarded: ctx.guarded,
    outcome,
    fired,
    verdicts,
  };
}

function writeCompliance(file, record) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, `${JSON.stringify(record)}\n`, "utf8");
}

/**
 * Append the stretch's raw records to the store.
 *
 * Raw flushes, digest summarises (skills#69): the digest on the seal is
 * a projection of these records, and a projection of retained data —
 * per-check, per-cycle, per-model detail stays recoverable after the
 * container and its compliance log are reclaimed. Each record belongs
 * to exactly one stretch, so flushing per seal writes each line once.
 */
function flushDiligence(root, session, window) {
  const dir = path.join(root, "diligence");
  fs.mkdirSync(dir, { recursive: true });
  fs.appendFileSync(
    path.join(dir, `${session}.jsonl`),
    window.map((record) => JSON.stringify(record)).join("\n") + "\n",
    "utf8",
  );
}

// ----------------------------------------------------------------- run

/** Everything the checks read, gathered once. */
function context(input) {
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
    clones: clonesUnder(process.env.HEARTBEAT_REPO_ROOT || null),
    summary: readTurnSummary(),
    events: readAll(root),
    // What the principal will read — the last message with a text
    // block, so a correction supersedes the message it corrects.
    assistantText: lastAssistantText(text),
  };
}

/**
 * Check the turn, then block it or seal it.
 *
 * Returns the process exit code. Seals only when every check is green,
 * so an unsealed tail always means one thing — the last turn did not
 * finish its bookkeeping — with no recency heuristic anywhere.
 */
export function run(input) {
  const ctx = context(input);
  const verdicts = CHECKS.map((entry) => ({ check: entry.check, ...entry.run(ctx) }));
  const failed = verdicts.find((verdict) => verdict.verdict === "fail");
  const reported = verdicts.map(({ check, verdict, detail }) => ({ check, verdict, detail }));

  // Green seals, and nothing else does. An unsealed tail then carries
  // exactly one meaning — the last turn did not finish its bookkeeping
  // — which is the predicate the renderer and the store's CI both read,
  // with no recency heuristic anywhere in it.
  if (!failed) {
    // The digest is computed, never typed: the sealing execution's own
    // record is built first, the stretch window is read off the same
    // log `cycleOf` counts from, and the seal carries the projection.
    // The window is everything since the previous seal in this
    // session's log — not a parameter, so not choosable flatteringly.
    const file = localFile("reminder-compliance.jsonl");
    const record = complianceRecord(file, ctx, reported, "sealed", null);
    const { window, baseline } = stretchOf([...readLog(file), record], ctx.session);
    append(
      ctx.root,
      ctx.session,
      { ev: "sealed", diligence: digestOf(window, baseline) },
      ctx.transcript,
      ctx.sessionUrl,
      // Identity from LEDGER_SESSION_URL is explicit here exactly as
      // --session-url is at the CLI (skills#62): a second conversation
      // the environment named must be able to seal its own log.
      ctx.namedItself,
    );
    flushDiligence(ctx.root, ctx.session, window);
    // The seal protocol's third phase (skills#46): the checks gated the
    // seal — the render among them — and the seal gates this push, so
    // what reaches the remote is a turn whose bookkeeping is complete.
    // The recorder's own push carries the union-merge protection, and
    // this is the only ride the seal line and the flushed diligence
    // records get: the CLI pushes per append, but nothing else pushes
    // what the hook itself wrote. A store that is not a git clone (or a
    // push the network refuses) is left for the next seal's push to
    // sweep — the turn sealed, and blocking it again over transport
    // would double-seal on the re-fire; the SessionStart clone report
    // and the store's CI tail guard are the observers for that gap.
    try {
      push(ctx.root, ctx.session, "sealed");
    } catch {
      // Local seal stands; the next push carries it.
    }
    writeCompliance(file, record);
    return 0;
  }

  // The baseline arm. HEARTBEAT_OBSERVE runs every check and logs every
  // verdict without ever surfacing a reason — the arm the Hawthorne
  // question needs, since a hook that always blocks has no run where
  // the reminder was withheld. The one thing it must not do is seal:
  // green seals and nothing else does, in every mode, or the store
  // starts lying about which turns finished. DECISION:SCOPE — observe
  // mode is a measurement arm, not a soft deployment; a deployment that
  // wants no blocking should not install the hook.
  if (process.env.HEARTBEAT_OBSERVE) {
    logCompliance(ctx, reported, "observed", failed.check);
    return 0;
  }

  // The loop guard, read before blocking rather than before checking.
  // `stop_hook_active` is true when this hook already blocked the turn
  // once, and repeating a reason the model just acted on is how a Stop
  // hook traps a session.
  //
  // But a re-fire commonly fails a DIFFERENT check: remediating one
  // reveals the next. Measured over ten turns of one session, eight
  // re-fires fired on a check the block had never named — the model had
  // acted on what it was told and hit a new wall, silently, because the
  // release wrote nothing. That is not the loop the guard protects
  // against, so a reason never yet delivered this turn is worth one more
  // block, up to MAX_BLOCKS.
  //
  // Everything else releases the turn unsealed — the honest record of a
  // turn that did not finish — and says so on stderr. A released turn
  // the model KNOWS is unsealed is a different thing from one it reads
  // as success. Every verdict is still logged either way: this pass is
  // the only place where whether the model complied with the reason it
  // was given can be observed at all.
  if (ctx.guarded) {
    const file = localFile("reminder-compliance.jsonl");
    const delivered = deliveredThisTurn(file, ctx);
    const unheard = delivered.size > 0 && !delivered.has(failed.check);
    if (unheard && cycleOf(file, ctx) <= MAX_BLOCKS) {
      logCompliance(ctx, reported, "blocked", failed.check);
      process.stderr.write(`${failed.reason}\n`);
      return 2;
    }
    logCompliance(ctx, reported, "unsealed", failed.check);
    process.stderr.write(
      `The turn is released UNSEALED — ${failed.check} is still failing: ` +
        `${failed.detail}. Not blocking again; the next turn begins with ` +
        `this outstanding, and the store's tail shows it.\n`,
    );
    return 0;
  }

  logCompliance(ctx, reported, "blocked", failed.check);
  process.stderr.write(`${failed.reason}\n`);
  return 2;
}

// ----------------------------------------------------------- preflight
//
// The same heartbeat, run as a linter before the turn ends (skills#126).
// Invoked as a tool call — `node heartbeat.mjs --preflight --draft
// <file> [--fix]` — it runs every check against observed state with the
// draft standing in for the response, prints every verdict, and exits 1
// when anything would fail. It never seals, never blocks, and never
// writes ledger events, summaries, or waivers: preflight reports, the
// agent does the work. `--fix` is the one write it owns, and it edits
// notation only — refs to their canonical linked forms, commit hashes
// to commit links — in the draft file and nowhere else.

/** The shortcode map the store carries, or null when it carries none. */
function readShortcodes(root) {
  try {
    return JSON.parse(fs.readFileSync(path.join(root, "config", "shortcodes.json"), "utf8"));
  } catch {
    return null;
  }
}

function escapeRe(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Resolve a commit hash across the session's clones.
 *
 * The formulation ruled on skills#126: unique hit → a link to that
 * repo's commit page, built from the same shortcode map every other
 * link uses; anything else → leave the token and report why. The map,
 * not the clone's remote URL, names the repo — origin URLs come in
 * shapes (ssh, local mirrors) that no link should be derived from.
 */
function resolveHash(clones, config, hash) {
  const hits = clones.filter(
    (repo) => gitOrNull(repo.path, "cat-file", "-e", `${hash}^{commit}`) !== null,
  );
  if (hits.length === 0) return { why: "resolves in no clone" };
  if (hits.length > 1) return { why: `ambiguous — resolves in ${hits.length} clones` };
  const [repo] = hits;
  const repos = config.repos ?? config;
  const fullName = Object.values(repos).find((name) => name.split("/").pop() === repo.name);
  if (!fullName) return { why: `no shortcode maps to clone ${repo.name}` };
  const full = gitOrNull(repo.path, "rev-parse", `${hash}^{commit}`);
  const base = config.forge ?? "https://github.com";
  return { link: `[${repo.name}@${hash}](${base}/${fullName}/commit/${full})` };
}

/**
 * Lint the draft's notation, optionally repairing it.
 *
 * Fenced blocks are quoted material and stay untouched; existing
 * markdown links are already spoken for. Inline code is scanned for
 * commit hashes ONLY — prose habitually backticks a hash, so for this
 * one rule the code-span exemption would be the escape hatch rather
 * than the protection (skills#126, 2026-08-20 incident) — while ref
 * style inside inline code stays exempt as everywhere else.
 */
function lintDraft(text, ctx, config, fix) {
  const findings = [];
  const violations = refViolations(stripCode(text), config, knownPrs(ctx.events)).filter(
    (violation) => violation.canonical,
  );
  const fixRefs = (piece) => {
    let out = piece;
    for (const violation of violations) {
      out = out.replace(
        new RegExp(`(?<![\\w\\[/])${escapeRe(violation.token)}(?![\\w\\]])`, "g"),
        violation.canonical,
      );
    }
    return out;
  };
  const scanHashes = (piece) =>
    piece.replace(/(`?)\b([0-9a-f]{7,40})\b(`?)/g, (whole, open, hash, close) => {
      if (!/[a-f]/.test(hash) || open !== close) return whole;
      const resolved = resolveHash(ctx.clones, config, hash);
      if (!resolved.link) {
        findings.push({ token: hash, why: resolved.why });
        return whole;
      }
      if (!fix) {
        findings.push({ token: hash, why: `bare commit hash → ${resolved.link}` });
        return whole;
      }
      return resolved.link;
    });
  const out = text
    .split(/(```[\s\S]*?```)/)
    .map((block, fence) => {
      if (fence % 2) return block;
      return block
        .split(/(\[[^\]\n]*\]\([^()\s]*\))/)
        .map((part, link) => {
          if (link % 2) return part;
          return scanHashes(fix ? fixRefs(part) : part);
        })
        .join("");
    })
    .join("");
  return { text: out, findings, changed: out !== text };
}

/** Run every check advisorily against the draft. Returns the exit code. */
export function preflight(input, opts) {
  const ctx = context(input);
  ctx.preflight = true;
  const config = readShortcodes(ctx.root);
  const findings = [];
  if (opts.draft) {
    let draftText = fs.readFileSync(opts.draft, "utf8");
    if (config) {
      const linted = lintDraft(draftText, ctx, config, Boolean(opts.fix));
      findings.push(...linted.findings);
      if (opts.fix && linted.changed) {
        fs.writeFileSync(opts.draft, linted.text, "utf8");
        draftText = linted.text;
      }
    }
    ctx.assistantText = draftText;
  }
  const verdicts = CHECKS.map((entry) => ({ check: entry.check, ...entry.run(ctx) }));
  const failed = verdicts.filter((verdict) => verdict.verdict === "fail");
  for (const verdict of verdicts) {
    process.stdout.write(`${verdict.verdict.padEnd(12)} ${verdict.check} — ${verdict.detail}\n`);
  }
  for (const verdict of failed) {
    if (verdict.reason) process.stdout.write(`\n${verdict.check}:\n${verdict.reason}\n`);
  }
  for (const finding of findings) {
    process.stdout.write(`\ncommit-ref: ${finding.token} — ${finding.why}\n`);
  }
  logCompliance(
    ctx,
    verdicts.map(({ check, verdict, detail }) => ({ check, verdict, detail })),
    "preflight",
    failed[0]?.check ?? null,
  );
  return failed.length || findings.length ? 1 : 0;
}

function readStdin() {
  try {
    return fs.readFileSync(0, "utf8");
  } catch {
    // No stdin at all: the hook was invoked by hand, not by the platform.
    return "";
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const raw = readStdin();
  // Parsed OUTSIDE the try, so the loop guard survives a crash. Reading
  // it inside `run` put it beyond any throw in `context` — a single
  // torn line in a store log then blocked every Stop including the
  // guarded one, which is the trapped session this whole design exists
  // to avoid, reached through its own crash handler.
  let input = {};
  try {
    input = raw.trim() ? JSON.parse(raw) : {};
  } catch {
    // Unparsable stdin is itself a crash, handled below with no guard
    // available — one block, and the platform's next Stop carries
    // readable JSON or the same fault repeats visibly.
  }

  // `exitCode` rather than `exit()` throughout, for the reason in
  // ledger.mjs's wrapper: stderr is asynchronous on a pipe, and the
  // block reason IS the mechanism here — a reason cut off mid-sentence
  // would be a reminder the model cannot act on.
  // A reader that closes early is the end of reading, not a fault —
  // same rule as ledger.mjs, on the channel this hook writes to.
  process.stderr.on("error", (err) => {
    if (err?.code === "EPIPE") process.exit(process.exitCode ?? 0);
    throw err;
  });
  // Preflight is a tool call, not a Stop: a crash reports and exits 1
  // — it must never block a turn it was asked to advise on.
  if (process.argv.includes("--preflight")) {
    const argAfter = (flag) => {
      const at = process.argv.indexOf(flag);
      return at > -1 ? process.argv[at + 1] : null;
    };
    try {
      process.exitCode = preflight(input, {
        draft: argAfter("--draft"),
        fix: process.argv.includes("--fix"),
      });
    } catch (err) {
      const detail = err instanceof LedgerError ? err.message : (err.stack ?? String(err));
      process.stderr.write(`preflight could not check the draft:\n${detail}\n`);
      process.exitCode = 1;
    }
  } else {
    try {
      process.exitCode = run(input);
    } catch (err) {
      const detail = err instanceof LedgerError ? err.message : (err.stack ?? String(err));
      // The crash reaches the compliance log with no verdicts, because
      // none were reached. An empty verdict list is the honest shape of
      // "nothing was checked" — and a crash that logged nothing would be
      // invisible to the one record built to observe this mechanism.
      try {
        logCompliance(
          {
            session: null,
            msg: null,
            usage: { model: null, input: 0, output: 0, cacheRead: 0, cacheCreation: 0 },
            guarded: input.stop_hook_active === true,
          },
          [],
          "crashed",
          "heartbeat-crashed",
        );
      } catch {
        // The log lives under HOME; if that is unwritable too, the stderr
        // below is the only channel left and it still gets used.
      }
      // A crashed heartbeat must never end the turn quietly: exiting 0
      // would make a broken check indistinguishable from a passing one,
      // and exit 1 is silently non-blocking. But it blocks ONCE — the
      // guard applies to a crash exactly as it applies to a reason,
      // because a fault the model cannot fix must not trap the session.
      // On the guarded fire the reason is withheld like any other: it was
      // already delivered in full, and stderr at exit 0 reaches only the
      // diagnostics log anyway.
      if (input.stop_hook_active === true) {
        process.exitCode = 0;
      } else {
        process.stderr.write(
          "The ledger heartbeat could not check this turn, so nothing verified " +
            `its bookkeeping:\n\n${detail}\n`,
        );
        process.exitCode = 2;
      }
    }
  }
}
