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

import { LedgerError, countUserTurns, lastUserTurnAt } from "./core.mjs";
import { append, readAll, resolveRoot, resolveSession } from "./ledger.mjs";

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
  if (!ctx.repoRoot) {
    return {
      verdict: "unconfigured",
      detail: "HEARTBEAT_REPO_ROOT is unset — no clones were examined",
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
  // Narrowed by session as well as by time. The fold reads every log in
  // the store, which is right for rendering and wrong for this
  // question: an event another conversation wrote records what that
  // conversation did, and two sessions on one thread would otherwise
  // excuse each other's bookkeeping.
  const touched = new Set(
    ctx.events
      .filter((event) => event.anchor?.session === ctx.session)
      .filter((event) => event.at && new Date(event.at).getTime() >= start)
      .map((event) => event.thread),
  );
  const missing = ctx.summary.threads.filter((thread) => !touched.has(thread));
  if (!missing.length) {
    return { verdict: "pass", detail: `${ctx.summary.threads.length} threads recorded` };
  }

  // A thread with no history at all cannot take `progress` — the state
  // machine allows only an opening from nothing — so offering it would
  // hand over a command that fails, and the model would be left
  // improvising inside the one turn the hook allows it.
  const [first] = missing;
  const known = ctx.events.some((event) => event.thread === first);
  const command = known
    ? `  node ${LEDGER} append --ev progress --thread ${first} --pct <n> --note "<what changed>"`
    : `  node ${LEDGER} append --ev opened --thread ${first} --title "<one line>" --ticket <owner/repo#n>`;
  return {
    verdict: "fail",
    detail: known
      ? `no event this turn for ${missing.join(", ")}`
      : `${first} was never opened`,
    reason: [
      "The turn is not complete until the ledger has an event for every " +
        `thread it changed. ${known ? "Missing" : "Never opened"}: ${first}.`,
      "",
      command,
    ].join("\n"),
  };
}

// Priority order. First failure wins; the rest wait for the next turn.
const CHECKS = [
  { check: "turn-summary", run: checkTurnSummary },
  { check: "pushed", run: checkPushed },
  { check: "ledger-event", run: checkLedgerEvent },
];

// ------------------------------------------------------- compliance log

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
  const record = {
    at: new Date().toISOString().replace(/\.\d+Z$/, "+00:00"),
    session: ctx.session,
    msg: ctx.msg,
    guarded: ctx.guarded,
    outcome,
    fired,
    verdicts,
  };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, `${JSON.stringify(record)}\n`, "utf8");
}

// ----------------------------------------------------------------- run

/** Everything the checks read, gathered once. */
function context(input) {
  const root = process.env.SESSION_MEMORY_ROOT || resolveRoot(null);
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
    turnStart: turnStart ? new Date(turnStart) : null,
    guarded: input.stop_hook_active === true,
    namedItself: Boolean(process.env.LEDGER_SESSION_URL),
    // How many conversations this store logs. One is unambiguous
    // whatever the environment says; beyond that the hook needs telling.
    conversations: new Set(readAll(root).map((event) => event.anchor?.session).filter(Boolean)).size,
    repoRoot: process.env.HEARTBEAT_REPO_ROOT || null,
    clones: clonesUnder(process.env.HEARTBEAT_REPO_ROOT || null),
    summary: readTurnSummary(),
    events: readAll(root),
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
    append(ctx.root, ctx.session, { ev: "sealed" }, ctx.transcript, ctx.sessionUrl);
    logCompliance(ctx, reported, "sealed", null);
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

  try {
    process.exit(run(input));
  } catch (err) {
    const detail = err instanceof LedgerError ? err.message : (err.stack ?? String(err));
    // The crash reaches the compliance log with no verdicts, because
    // none were reached. An empty verdict list is the honest shape of
    // "nothing was checked" — and a crash that logged nothing would be
    // invisible to the one record built to observe this mechanism.
    try {
      logCompliance(
        { session: null, msg: null, guarded: input.stop_hook_active === true },
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
    if (input.stop_hook_active === true) process.exit(0);
    process.stderr.write(
      "The ledger heartbeat could not check this turn, so nothing verified " +
        `its bookkeeping:\n\n${detail}\n`,
    );
    process.exit(2);
  }
}
