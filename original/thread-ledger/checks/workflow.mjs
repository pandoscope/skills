// Checks over the shape of the turn's work: the branch it landed on,
// the headers it committed, the bodies it posted.
//
// The driver lab (skills#130) measured that a stop-time refusal naming
// the unmet criterion with evidence brings every model to compliance,
// and that a check followed must not be wrong. So each check here
// reads the rule from the repo it judges — `.github/reference-keywords
// .json`, the same file the forge gates read — names paths in its
// evidence, and enters the table shadowed (skills#192) until the
// compliance log has shown what it would refuse. Header contract:
// `../heartbeat.mjs`.

import fs from "node:fs";
import path from "node:path";

import { bodyViolations, branchTickets, branchViolation, headerViolation } from "../core/workflow.mjs";
import { trackerWrites } from "../core.mjs";
import { committedThisTurn, gitOrNull, storeCheckout } from "../context.mjs";

/**
 * The keyword file a clone carries, or null when it carries none.
 *
 * Read from the clone, never from this skill: the pattern and the
 * keywords are the judged repo's own gate, and a repo without the file
 * has no such gate to anticipate.
 */
function keywordsOf(repo) {
  const file = path.join(repo.path, ".github", "reference-keywords.json");
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

/**
 * The clones whose work these checks judge.
 *
 * The session-memory store and the decision or evidence checkouts are
 * left out: their branch and commit conventions are the recorder's,
 * not the working branch's, and judging them by the working-branch
 * rules would refuse the stores for doing what they are built to do.
 */
function workClones(ctx) {
  const excluded = new Set();
  if (ctx.root) excluded.add(path.resolve(ctx.root));
  for (const url of [ctx.decisionUrl, ctx.evidenceUrl]) {
    if (!url) continue;
    const { store } = storeCheckout(url, ctx.clones);
    if (store) excluded.add(path.resolve(store));
  }
  return ctx.clones.filter((repo) => !excluded.has(path.resolve(repo.path)));
}

/** Clones that gained a commit this turn, with their keyword file. */
function committedClones(ctx) {
  return workClones(ctx)
    .filter((repo) => committedThisTurn(repo, ctx.turnStart))
    .map((repo) => ({ ...repo, keywords: keywordsOf(repo) }));
}

/**
 * Check — a clone committed to this turn sits on a pattern branch.
 *
 * The branch rule is the ticket gate's: `claude/<code><ticket>…-<desc>`,
 * read from the clone's keyword file. A commit on `main` or on a branch
 * with no ticket token is the finding; a clone without the keyword
 * file is not examined, because it has no gate to fail.
 */
export function checkBranchPattern(ctx) {
  if (!ctx.turnStart) return { verdict: "pass", detail: "no turn boundary" };
  const judged = committedClones(ctx);
  if (!judged.length) return { verdict: "pass", detail: "no clone committed this turn" };
  const gated = judged.filter((repo) => repo.keywords?.branch_pattern);
  if (!gated.length) {
    return {
      verdict: "unconfigured",
      detail: `${judged.map((repo) => repo.name).join(", ")} carry no .github/reference-keywords.json — no branch was examined`,
    };
  }
  for (const repo of gated) {
    const branch = gitOrNull(repo.path, "rev-parse", "--abbrev-ref", "HEAD") ?? "HEAD";
    const why = branchViolation(branch, repo.keywords.branch_pattern);
    if (!why) continue;
    return {
      verdict: "fail",
      detail: `${repo.name}: ${why}`,
      reason: [
        "The turn is not complete until the work sits on a ticket branch: " +
          `${repo.name} committed this turn and ${why}. The ticket gate ` +
          "rejects a PR from any other branch name.",
        "",
        `  git -C ${repo.path} branch -m claude/<code><ticket>-<desc>`,
      ].join("\n"),
    };
  }
  return { verdict: "pass", detail: `${gated.map((repo) => repo.name).join(", ")} on pattern branches` };
}

/**
 * Check — the commits a clone gained this turn carry conventional
 * headers, and no merge commit landed on a working branch.
 *
 * The grammar is commitlint's, with the two forms the branch rules add
 * (`fixup!`, `squash!`) and the one commitlint ignores (`Revert "`).
 * The evidence names the header, never the hash: the reader acts on
 * the wording, and a hash pins a contract string to a fixture value.
 */
export function checkCommitHeaders(ctx) {
  if (!ctx.turnStart) return { verdict: "pass", detail: "no turn boundary" };
  const judged = committedClones(ctx);
  if (!judged.length) return { verdict: "pass", detail: "no clone committed this turn" };
  for (const repo of judged) {
    const headers = (
      gitOrNull(repo.path, "log", `--since=${ctx.turnStart.toISOString()}`, "--format=%s") ?? ""
    )
      .split("\n")
      .filter(Boolean);
    const bad = headers.map((header) => headerViolation(header)).filter(Boolean);
    if (!bad.length) continue;
    return {
      verdict: "fail",
      detail: `${repo.name}: ${bad.join("; ")}`,
      reason: [
        "The turn is not complete until every commit it made has a " +
          `conventional header on a linear branch: ${repo.name} has ` +
          `${bad.length} that do not.`,
        "",
        ...bad.map((why) => `  ${why}`),
        "",
        `  git -C ${repo.path} rebase -i origin/main   # reword, or drop the merge`,
      ].join("\n"),
    };
  }
  return { verdict: "pass", detail: `${judged.map((repo) => repo.name).join(", ")}: headers conventional` };
}

/**
 * Check — every tracker body the turn posted renders as written.
 *
 * Read from the transcript's tool calls, the only observer of what was
 * posted without a network round-trip. The rules are the tracker
 * formatting rules the org's AGENTS.md states and the ticket gate
 * enforces on PR bodies: canonical keywords only, no angle-bracket
 * placeholders, no hard wraps, and a PR from a pattern branch names
 * every ticket the branch does. The keyword file comes from the clone
 * the body was posted to; a body for a repo with no clone here is
 * judged by the first keyword file any judged clone carries, since
 * the org shares one, and by none at all when there is none.
 */
export function checkTrackerBodies(ctx) {
  if (!ctx.turnStart) return { verdict: "pass", detail: "no turn boundary" };
  const posted = trackerWrites(ctx.transcriptText, ctx.turnStart.toISOString());
  if (!posted.length) return { verdict: "pass", detail: "no tracker body posted this turn" };
  const clones = workClones(ctx).map((repo) => ({ ...repo, keywords: keywordsOf(repo) }));
  const fallback = clones.find((repo) => repo.keywords)?.keywords ?? null;
  const keywordsFor = (fullName) => {
    const name = fullName?.split("/")[1];
    return clones.find((repo) => repo.name === name)?.keywords ?? fallback;
  };
  const findings = [];
  for (const write of posted) {
    const keywords = keywordsFor(write.repo);
    if (!keywords) continue;
    const tickets = write.head ? branchTickets(write.head, keywords.branch_pattern ?? "") : [];
    for (const violation of bodyViolations(write.body, keywords, tickets)) {
      findings.push({ ...violation, tool: write.tool, repo: write.repo ?? "(no repo)" });
    }
  }
  if (!findings.length) {
    return { verdict: "pass", detail: `${posted.length} tracker body(ies) render as written` };
  }
  const line = (f) => `  ${f.tool} on ${f.repo}: ${f.kind} — ${f.evidence}`;
  return {
    verdict: "fail",
    detail: findings.map((f) => `${f.tool} on ${f.repo}: ${f.kind} (${f.evidence})`).join("; "),
    reason: [
      "The turn is not complete until every tracker body it posted renders " +
        "as written: canonical keywords in ALL CAPS, guillemets for " +
        "placeholders, one paragraph per line, every branch ticket referenced.",
      "",
      ...findings.map(line),
      "",
      "Edit each body in place with the same tool that posted it.",
    ].join("\n"),
  };
}
