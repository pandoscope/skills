// Checks over the state of the session's clones.
//
// Ordered inside the table by what a miss costs: a blocklist hit must
// block before the turn is told to push, or the reminder publishes what
// it was guarding. Header contract: `../heartbeat.mjs`.

import fs from "node:fs";
import path from "node:path";
import process from "node:process";

import { blocklistTerms, scanText, shellRef } from "../scan.mjs";
import { committedThisTurn, gitOrNull } from "../context.mjs";

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
export function checkPushBlocklist(ctx) {
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
export function checkCloneConfig(ctx) {
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
export function checkCommitSigned(ctx) {
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
export function checkLinearHistory(ctx) {
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
    let merges = gitOrNull(repo.path, "rev-list", "--merges", "HEAD", "--not", target);
    if (!merges) continue;
    // A suspect merge is judged against the remote's default branch as
    // it IS, not as the tracking ref remembers it (skills#185): the
    // harness creates the session branch at main's fresh tip, and a
    // clone nobody fetched holds an older origin/main — so the forge's
    // own merge, the very commit that is main, read as a merge main
    // does not hold. The fetch is paid only here, by the one clone
    // whose first pass found something; a fetch the network refuses
    // leaves the first reading standing.
    if (gitOrNull(repo.path, "fetch", "--quiet", "origin", target.replace(/^origin\//, "")) !== null) {
      merges = gitOrNull(repo.path, "rev-list", "--merges", "HEAD", "--not", target);
      if (!merges) continue;
    }
    const shas = merges.split("\n").filter(Boolean);
    // A merge that predates the turn on a clone the turn never
    // committed to is debt, and named as such — but the rewrite is
    // offered only to the turn that worked the branch. Rebasing a
    // branch this turn did not touch is not this turn's to do.
    if (!committedThisTurn(repo, ctx.turnStart)) {
      return {
        verdict: "pass",
        detail:
          `${repo.name} (${branch}) carries ${shas.length} merge commit(s) not on ${target} ` +
          `(${shas.map((sha) => sha.slice(0, 8)).join(", ")}) from before this turn — ` +
          "reported, not this turn's to rewrite",
      };
    }
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

/**
 * Check 2 — every clone is committed and pushed.
 *
 * Unconfigured rather than passing when no repo root is named: a check
 * with nothing to look at has not looked, and recording that as a pass
 * would put the absence and the success in the same column of the very
 * log that exists to tell them apart.
 */
export function checkPushed(ctx) {
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
