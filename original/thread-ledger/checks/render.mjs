// The check over the rendered ledger page.
//
// The page is the principal's view of the log, so a page older than the
// log it renders is a report of work nobody can see. Header contract:
// `../heartbeat.mjs`.

import fs from "node:fs";

import { PROBE_EXEMPT, probeExempt } from "../context.mjs";
import { LEDGER } from "../paths.mjs";

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
export function checkArtifactFresh(ctx) {
  if (!ctx.turnStart) {
    return { verdict: "unconfigured", detail: "no turn boundary to measure against" };
  }
  if (probeExempt(ctx)) return PROBE_EXEMPT;
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
        '--title "Thread ledger" — then republish the artifact this session ' +
        "already publishes from that file; a session with none publishes nothing.",
    ].join("\n"),
  };
}
