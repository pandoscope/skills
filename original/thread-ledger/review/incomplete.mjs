// The result the driver publishes for a review that did not complete (skills#297).
//
// A run the loop guard releases with a completion check unmet still publishes a result,
// so the order's branch tells its reader what happened instead of holding nothing.
// The result carries no `findings` array, so the contract in `findings.schema.json` refuses it,
// and no reader can take it for a completed review that found nothing.

import fs from "node:fs";

/** @typedef {import("./policy.mjs").ReviewRun} ReviewRun */
/** @typedef {{ at: string | null, tool: string | null, arg: string | null, why: string | null }} Denial */

/**
 * The calls the policy denied in one session, from the driver's log.
 * The driver writes the log at the first denial, so a session without one has none.
 * @param {string} logFile the driver's log, one JSON object per line
 * @param {string} session the session whose denials to list
 * @returns {Denial[]} in the order they were denied
 */
export function deniedCalls(logFile, session) {
  if (!fs.existsSync(logFile)) return [];
  /** @type {Denial[]} */
  const out = [];
  for (const line of fs.readFileSync(logFile, "utf8").split("\n")) {
    if (!line.trim()) continue;
    const d = JSON.parse(line);
    if (d.event !== "deny" || d.session !== session) continue;
    out.push({ at: d.at ?? null, tool: d.tool ?? null, arg: d.arg ?? null, why: d.why ?? null });
  }
  return out;
}

/**
 * The result of a review the loop guard released with a check unmet.
 * @param {ReviewRun} run
 * @param {{ check: string, detail: string }} unmet the completion check that stayed unmet
 * @param {Denial[]} denied the calls the policy denied
 * @param {string | null} reviewerFile what the reviewer had written to the result file, null when nothing
 * @returns {Record<string, unknown>} `state` is `incomplete`; there is no `findings` field
 */
export function incompleteResult(run, unmet, denied, reviewerFile) {
  return {
    order_id: run.orderId,
    pass: run.pass,
    model_tier: run.modelTier,
    state: "incomplete",
    unmet: { check: unmet.check, detail: unmet.detail },
    denied,
    // DECISION:SCOPE — the reviewer's own text is kept, as text.
    // #297 asks for the check and the denials; the run it measured lost two findings the reviewer had written.
    // As a string it holds no findings array a reader could take for the review's.
    reviewer_file: reviewerFile,
  };
}
