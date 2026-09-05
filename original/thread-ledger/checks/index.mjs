// The check table — the one place the priority order lives.
//
// First failure wins and the rest wait for the next turn, so this order
// is the hook's whole triage policy. push-blocklist sits ahead of
// pushed deliberately: a hit must block BEFORE the turn is told to
// push, or the reminder itself publishes it. Header contract:
// `../heartbeat.mjs`.

import {
  checkLedgerEvent,
  checkPassedTickets,
  checkRulingsRecorded,
  checkTicketsUpdated,
  checkTurnSummary,
} from "./declarations.mjs";
import {
  checkCloneConfig,
  checkCommitSigned,
  checkLinearHistory,
  checkPushBlocklist,
  checkPushed,
} from "./git-state.mjs";
import {
  checkDecisionRecord,
  checkGrillingRecorded,
  checkReviewPersistence,
} from "./stores.mjs";
import { checkBlockedCaptured, checkKataReminder } from "./reminders.mjs";
import { checkResponseHygiene } from "./response.mjs";
import { checkArtifactFresh } from "./render.mjs";
import { checkBranchPattern, checkCommitHeaders, checkTrackerBodies } from "./workflow.mjs";

export const CHECKS = [
  { check: "turn-summary", run: checkTurnSummary },
  { check: "push-blocklist", run: checkPushBlocklist },
  { check: "clone-config", run: checkCloneConfig },
  { check: "commit-signed", run: checkCommitSigned },
  { check: "linear-history", run: checkLinearHistory },
  { check: "pushed", run: checkPushed },
  { check: "ledger-event", run: checkLedgerEvent },
  { check: "tickets-updated", run: checkTicketsUpdated },
  { check: "passed-tickets", run: checkPassedTickets },
  { check: "decision-record", run: checkDecisionRecord },
  { check: "rulings-recorded", run: checkRulingsRecorded },
  { check: "review-persistence", run: checkReviewPersistence },
  { check: "grilling-recorded", run: checkGrillingRecorded },
  { check: "kata-reminder", run: checkKataReminder },
  { check: "blocked-captured", run: checkBlockedCaptured },
  { check: "response-hygiene", run: checkResponseHygiene },
  { check: "artifact-fresh", run: checkArtifactFresh },
  // Shadowed (skills#192): a failure is logged as `shadow`, never
  // blocked on and never counted as fired, until the compliance log
  // has shown on real turns what each would have refused. Arming is
  // dropping the flag, with the kata that pins the wording.
  { check: "branch-pattern", run: checkBranchPattern, shadow: true },
  { check: "commit-headers", run: checkCommitHeaders, shadow: true },
  { check: "tracker-bodies", run: checkTrackerBodies, shadow: true },
];

/**
 * Every check's verdict over `ctx`, in table order.
 *
 * A shadowed check's failure comes back as `shadow`, with its detail
 * and without its reason: the log keeps what it saw, and nothing
 * downstream can mistake it for a block. Every caller that runs the
 * table runs it through here, so the hook and the preflight cannot
 * disagree about what a shadow is.
 */
export function runChecks(ctx) {
  return CHECKS.map((entry) => {
    const verdict = { check: entry.check, ...entry.run(ctx) };
    if (entry.shadow && verdict.verdict === "fail") {
      return { check: entry.check, verdict: "shadow", detail: verdict.detail };
    }
    return verdict;
  });
}
