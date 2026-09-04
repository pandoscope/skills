// The line above the table — what is open, and what is going stale.
//
// Shared by both views and by the stretch blocks, so the counts a
// reader sees are computed once. Header contract: `../views.mjs`.

import { counts, esc, promptPopover } from "./html.mjs";
import { singlePrompt, stalePrompt } from "./prompts.mjs";

/**
 * Counts first, detail after — what needs the principal leads.
 *
 * A tool is scanned, not read, so the state that only a human can clear
 * is the one the eye should land on.
 */
export function summary(open, closed) {
  const n = counts(open, closed);
  const stats = [
    ["active", n.active, ""],
    ["blocked on you", n.onYou, " you"],
    ["waiting", n.waiting, ""],
    ["parked", n.parked, ""],
    ["done", n.done, ""],
  ];
  let cells = stats
    .filter(([label, count]) => count || label === "active")
    .map(([label, count, extra]) => `<span class="stat${extra}"><b>${count}</b> ${esc(label)}</span>`)
    .join("");
  const outdated = open.filter((item) => item.stale);
  if (outdated.length) {
    const head =
      `<summary class="stat outdated" id="sync-all">` +
      `<b>${outdated.length}</b> tickets outdated</summary>`;
    cells += promptPopover(head, stalePrompt(outdated), `update ${outdated.length} tickets`);
  }
  return `<div class="summary">${cells}</div>`;
}


/** The marker beside the anchor: this ticket is behind. */
export function stalePill(thread) {
  if (!thread.stale) return "";
  const summary = `<summary class="info" title="ticket is behind: ${esc(thread.stale)}">i</summary>`;
  return promptPopover(summary, singlePrompt(thread), `update ${thread.ticket}`);
}
