// Checks over the stores a turn writes to.
//
// Decisions, reviews and grilling sessions each live in their own
// store, and each check asks the same question: did the work this turn
// did reach the store that outlives the container? Header contract:
// `../heartbeat.mjs`.

import fs from "node:fs";
import path from "node:path";

import { grillingInvokedAt, reviewSignals } from "../core.mjs";
import {
  RECORDER_STATE,
  gitOrNull,
  recordsThisTurn,
  storeCheckout,
  storeWroteThisTurn,
} from "../context.mjs";

// --------------------------------------------------- decision records

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
export function checkDecisionRecord(ctx) {
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
export function checkReviewPersistence(ctx) {
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
export function checkGrillingRecorded(ctx) {
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
