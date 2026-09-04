// The ready-to-paste prompts the page offers.
//
// The page is read where the work is not, so what it hands back is a
// prompt a session can act on rather than an instruction to remember.
// Header contract: `../views.mjs`.

// ------------------------------------------------------------ prompts

/**
 * The instruction that brings one ticket back in line.
 *
 * Generated rather than hand-written into the page so the copy button
 * and the always-present text box say the same thing. Two copies of a
 * prompt drift, and the one nobody reads is the one that is wrong.
 */
export function singlePrompt(thread) {
  return [
    `Update ${thread.ticket} to match what the session now knows: ${thread.stale}`,
    "Keep the ticket's structure and do not restate the history of the edit.",
    `Then: ledger append --ev synced --thread ${thread.thread}`,
  ].join("\n");
}


/**
 * The instruction that brings named tickets back in line.
 *
 * Names each ticket and what it is missing, because "update the
 * outdated tickets" sends the agent re-deriving what this ledger
 * already knows.
 */
export function stalePrompt(threads) {
  const lines = [
    "Update these ticket descriptions to match what the session now knows.",
    "For each: read the ticket, fold in the change below, keep the existing",
    "structure, and do not restate the history of the edit.",
    "",
  ];
  for (const thread of threads) lines.push(`- ${thread.ticket} — ${thread.stale}`);
  const slugs = threads.map((thread) => thread.thread).join(" ");
  lines.push(
    "",
    "Then mark each one synced so the ledger stops flagging it:",
    `  for t in ${slugs}; do ledger append --ev synced --thread $t; done`,
  );
  return lines.join("\n");
}


export function filePrompt(thread, repo) {
  return (
    `File a ticket in ${repo} for the ledger thread "${thread.thread}": ` +
    `"${thread.title}". Use the session's context for the body. Then promote ` +
    `the thread: ledger append --ev promoted --thread ${thread.thread} ` +
    `--ticket ${repo}#<number>`
  );
}
