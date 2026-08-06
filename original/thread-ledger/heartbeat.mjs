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
  TRANSITIONS,
  countUserTurns,
  currentStates,
  knownPrs,
  lastAssistantText,
  lastUserTurnAt,
  refViolations,
  stripCode,
  transcriptUsage,
} from "./core.mjs";
import { digestOf, readLog, stretchOf } from "./diligence.mjs";
import { append, readAll, resolveRoot, resolveSession, tail } from "./ledger.mjs";

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
function readTurnSummary() {
  const file = localFile("turn-summary.txt");
  if (!fs.existsSync(file)) {
    return { path: file, exists: false, writtenAt: null, threads: [], tickets: [] };
  }
  const text = fs.readFileSync(file, "utf8");
  const field = (name) => {
    const line = text.split("\n").find((item) => item.trim().startsWith(`${name}:`));
    if (!line) return [];
    return line.slice(line.indexOf(":") + 1).split(",").map((s) => s.trim()).filter(Boolean);
  };
  return {
    path: file,
    exists: true,
    writtenAt: fs.statSync(file).mtime,
    threads: field("threads"),
    tickets: field("tickets"),
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
  const write = `  printf 'threads: %s\\ntickets: %s\\n' '<thread-slug>, <thread-slug>' '<owner/repo#n>' > ${ctx.summary.path}`;

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
        `The turn is not complete until ${ctx.summary.path} describes it. ` +
          "Write the ledger threads and the tickets this turn touched.",
        "",
        write,
      ].join("\n"),
    };
  }

  // A declaration of nothing is a declaration nothing can contradict:
  // every later check diffs against it, so an empty one passes them all
  // and the bare seal — there so idle turns are not nagged — becomes
  // the way out of every check. The turn's own commits are evidence it
  // cannot write about itself, so they are what the emptiness is
  // measured against.
  if (!ctx.summary.threads.length) {
    const touched = ctx.clones.find((repo) => committedThisTurn(repo, ctx.turnStart));
    if (touched) {
      return {
        verdict: "fail",
        detail: `committed to ${touched.name} while declaring no thread`,
        reason: [
          `The turn is not complete until ${ctx.summary.path} names the ` +
            `threads behind it. It committed to ${touched.name} and declared ` +
            "no thread.",
          "",
          write,
        ].join("\n"),
      };
    }
  }
  return { verdict: "pass", detail: `${ctx.summary.threads.length} threads declared` };
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
    // Pushing it belongs to the seal protocol's third phase, unbuilt.
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
 * Check 3 — the ledger has an event for every declared thread.
 *
 * The original heartbeat. The recorder validates WHAT gets written;
 * this is the only thing that validates THAT something was written.
 * An event counts when it landed after the turn began, so a thread
 * carried over from an earlier turn does not answer for this one.
 */
function checkLedgerEvent(ctx) {
  // Every check runs even once one has failed, so this has to survive a
  // turn with no boundary rather than throw into the crash handler and
  // replace check 1's reason with a stack trace.
  if (!ctx.turnStart) {
    return { verdict: "unconfigured", detail: "no turn boundary to measure against" };
  }
  if (!ctx.summary.threads.length) {
    return { verdict: "pass", detail: "no threads declared — nothing to record" };
  }
  const start = ctx.turnStart.getTime();
  // Narrowed by time, and by writer — but the writer set includes the
  // NAMED ones. The check's question is "is the ledger current about
  // what this turn touched", not "did this session hold the pen": the
  // close-loop's bot completes a declared thread mid-turn, and the
  // ledger is then already exactly what the turn produced — blocking
  // there punishes the mechanism for working (#89). An event from
  // another conversation still does not count, because two sessions on
  // one thread would otherwise excuse each other's bookkeeping; a `by`
  // writer is not a conversation and has no bookkeeping to excuse.
  const touched = new Set(
    ctx.events
      .filter((event) => event.anchor?.session === ctx.session || event.by)
      .filter((event) => event.at && new Date(event.at).getTime() >= start)
      .map((event) => event.thread),
  );
  const missing = ctx.summary.threads.filter((thread) => !touched.has(thread));
  if (!missing.length) {
    return { verdict: "pass", detail: `${ctx.summary.threads.length} threads recorded` };
  }

  // The verb has to be one the state machine will accept from where the
  // thread actually stands. Offering `progress` unconditionally fails
  // for every thread that is blocked, parked or finished as surely as
  // for one never opened, and a command that errors leaves the model
  // improvising inside the single turn the hook allows it.
  const [first] = missing;
  const state = currentStates(ctx.events)[first] ?? "";
  // From a terminal state the only legal append is `reopened`, and a
  // `reopened` that no resumed work caused is a false event written to
  // clear a check — the lie this whole system exists to prevent. A
  // block reason must never propose an event that is false, so here
  // the remedy is the DECLARATION: a finished thread nothing touched
  // since the boundary means the summary names a thread this turn did
  // not actually change.
  if (state === "completed" || state === "dropped") {
    return {
      verdict: "fail",
      detail: `no event this turn for ${missing.join(", ")}`,
      reason: [
        "The turn is not complete until the ledger has an event for every " +
          `thread it changed. ${first} is already ${state} and nothing has ` +
          `touched it since the turn began — if this turn did not change ` +
          `it, the declaration is what is wrong.`,
        "",
        `  Remove ${first} from ${ctx.summary.path} and end the turn. ` +
          `Append --ev reopened only if the work genuinely resumed; never ` +
          `append it to satisfy this check.`,
      ].join("\n"),
    };
  }
  const args = appendArgs(first, state);
  // The state is named only where it changes the answer. For a thread
  // that can simply take `progress` it is noise; for one that cannot,
  // it is the whole explanation for the unfamiliar verb being offered.
  const named = !state
    ? `Never opened: ${first}`
    : args.startsWith("--ev progress")
      ? `Missing: ${first}`
      : `Missing: ${first}, which is ${state}`;
  return {
    verdict: "fail",
    detail: state ? `no event this turn for ${missing.join(", ")}` : `${first} was never opened`,
    reason: [
      "The turn is not complete until the ledger has an event for every " +
        `thread it changed. ${named}.`,
      "",
      `  node ${LEDGER} append ${args}`,
    ].join("\n"),
  };
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
 * Check 4 — a decision marked in the code has a record beside it.
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
  // stated when declared. Matching is on the raw response — backticks
  // around a slug are style, not evasion.
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
  for (const slug of ctx.summary.threads) {
    if (openedNow.includes(slug)) continue;
    if (!response.includes(slug)) naming.push({ slug, expected: slug });
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
 * The append a thread in `state` can actually take.
 *
 * Driven by the same transition table the recorder validates against,
 * so the offer cannot drift from what the recorder will accept — and
 * each kind's own required fields come with it, since a legal verb
 * missing its arguments fails just as loudly as an illegal one.
 */
function appendArgs(thread, state) {
  const [next] = TRANSITIONS[state] ?? [];
  const extra = {
    opened: '--title "<one line>" --ticket <owner/repo#n>',
    reopened: '--title "<one line>" --ticket <owner/repo#n>',
    progress: '--pct <n> --note "<what changed>"',
    unblocked: '--note "<what changed>"',
  };
  return `--ev ${next} --thread ${thread} ${extra[next] ?? '--note "<what changed>"'}`.trim();
}

// Priority order. First failure wins; the rest wait for the next turn.
const CHECKS = [
  { check: "turn-summary", run: checkTurnSummary },
  { check: "pushed", run: checkPushed },
  { check: "ledger-event", run: checkLedgerEvent },
  { check: "decision-record", run: checkDecisionRecord },
  { check: "response-hygiene", run: checkResponseHygiene },
  { check: "artifact-fresh", run: checkArtifactFresh },
];

// ------------------------------------------------------- compliance log

/**
 * Which Stop of this turn this is, counted from the log itself.
 *
 * `stop_hook_active` only says "at least one block already happened",
 * so it cannot tell a second cycle from a fifth. The log can, and it is
 * the same file the answer has to be written to.
 */
function cycleOf(file, ctx) {
  if (!fs.existsSync(file)) return 1;
  let seen = 0;
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      const record = JSON.parse(line);
      if (record.session === ctx.session && record.msg === ctx.msg) seen += 1;
    } catch {
      // A torn line is not a cycle. Counting one would be worse than
      // missing it: the cost of a real cycle would land on the wrong
      // turn, where nothing could ever contradict it.
    }
  }
  return seen + 1;
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
  const turnStart = lastUserTurnAt(text);
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
  return {
    root,
    transcript,
    session,
    sessionUrl,
    msg: countUserTurns(text),
    usage: transcriptUsage(text),
    turnStart: turnStart ? new Date(turnStart) : null,
    guarded: input.stop_hook_active === true,
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
    );
    flushDiligence(ctx.root, ctx.session, window);
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
  // once; blocking again feeds the model the same reason it just acted
  // on. The turn is released, unsealed — the honest record of a turn
  // that did not finish — and every verdict is still logged, because
  // this pass is the only place where whether the model complied with
  // the reason it was given can be observed at all.
  if (ctx.guarded) {
    logCompliance(ctx, reported, "unsealed", failed.check);
    return 0;
  }

  logCompliance(ctx, reported, "blocked", failed.check);
  process.stderr.write(`${failed.reason}\n`);
  return 2;
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
