// Writing to the store — validate, append, push, reconcile a race.
//
// The append, the identity choice and the push are one action: an event
// written locally and never pushed is an event nobody can read, and one
// pushed under a guessed identity is published before it can be
// corrected. Header contract: `../ledger.mjs`.

import fs from "node:fs";
import path from "node:path";
import process from "node:process";

import { LedgerError, mergeLogLines, stamp, validate } from "../core.mjs";
import { git, ledgerDir, readAll } from "./io.mjs";
import { checkSessionFile, countUserMessages } from "./identity.mjs";

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
 * The page is a snapshot of the fold, and a stale checkout produces a
 * wrong page that renders cleanly. This rule used to live in SKILL.md
 * as prose; as the tool's own step it holds without being remembered.
 *
 * Reports, never gates: offline, diverged or not a repository, the
 * page still renders from disk. The reason goes to stderr, and the
 * caller gets banner text for the page itself, so the reader learns
 * what the operator would. Returns null when the store is current.
 */
export function pullForRender(root) {
  let top;
  try {
    top = git(root, "rev-parse", "--show-toplevel").trim();
  } catch {
    return null; // a bare log directory has no remote to be behind
  }
  // Same guard as the push side: `git -C` would otherwise pull whatever
  // repository happens to enclose a plain log directory.
  if (fs.realpathSync(top) !== fs.realpathSync(root)) return null;
  try {
    git(root, "pull", "--ff-only", "-q");
    return null;
  } catch (err) {
    const reason = String(err.message ?? err).split("\n").find((line) => line.trim()) ?? "";
    process.stderr.write(
      `ledger: could not fast-forward ${root} before rendering — the page ` +
        `is built from this checkout as it stands (${reason.trim()})\n`,
    );
    return "Possibly outdated: the store could not be fast-forwarded before this render.";
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
export function append(root, session, event, transcript, sessionUrl, explicitIdentity = false) {
  requireDefaultBranch(root);
  // The one-log guard asks whether a conversation is splitting its log
  // in two. A writer that is not a conversation has no such log to
  // split, and its own is expected to sit beside the sessions' — and a
  // session that STATED its identity has already answered the guard's
  // question (skills#62): the split it catches is an inferred name
  // drifting, which an explicit URL cannot do.
  if (!event.by && !explicitIdentity) checkSessionFile(root, session);
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
