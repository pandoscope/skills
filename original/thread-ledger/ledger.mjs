#!/usr/bin/env node
// Thread ledger — a session's open-work record.
//
// Appends schema-validated events to a per-conversation JSONL file in
// the session-memory store, and renders the folded state as a standalone
// page or as Markdown.
//
// Contract authority: this comment and the SKILL.md next to it.
//
//     ledger append --ev opened --thread <slug> --title "…" \
//         --ticket owner/repo#1 [--deps a,b] [--urgency high]
//     ledger state    # folded state as JSON, for debugging and graphs
//     ledger render --out page.html
//
// The store comes from SESSION_MEMORY_URL. Unset, every command fails:
// there is no fallback path to degrade to, because events written where
// nobody looks are worse than events not written.
//
// Node builtins only. Pushes with plain git; no forge API, no MCP.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { LedgerError, fold } from "./core.mjs";
import { renderBody, renderMarkdown } from "./views.mjs";
import {
  readAll,
  readCodes,
  readDiligence,
  readForge,
  readNames,
  resolveRoot,
} from "./store/io.mjs";
import { countUserMessages, findTranscript, resolveSession, storeUrl } from "./store/identity.mjs";
import { append, pullForRender, push } from "./store/writes.mjs";
import { mergedReport, reconcile } from "./store/reconcile.mjs";
import { guardRange } from "./store/guard.mjs";
import { renderPage } from "./store/pages.mjs";
import { USAGE, declareText, eventFrom, parseArgs } from "./store/cli.mjs";

// The surface the heartbeat and the tests import from the entry point,
// re-exported so the split stays an internal boundary.
export { readAll, resolveRoot, tail } from "./store/io.mjs";
export { checkSessionFile, countUserMessages, resolveSession } from "./store/identity.mjs";
export { append, push } from "./store/writes.mjs";
export { mergedReport } from "./store/reconcile.mjs";
export { renderPage } from "./store/pages.mjs";
export { declareText, parseArgs } from "./store/cli.mjs";


export function main(argv) {
  const [cmd, opts] = parseArgs(argv);
  if (!cmd || cmd === "help") {
    process.stdout.write(`${USAGE}\n`);
    return 0;
  }

  // Before the store resolves: declare writes a session-local file the
  // heartbeat reads, and needs no clone, identity, or transcript — a
  // missing SESSION_MEMORY_URL must not block the one command whose job
  // is passing the very hook that would otherwise reject the turn.
  if (cmd === "declare") {
    const text = declareText(opts);
    // The same single env var the hook wrapper exports (skills#153):
    // writer and checker resolve the location through one name, so
    // neither can drift to a private path. The legacy home fallback
    // keeps unmigrated environments declaring while the wrapper rolls
    // out; the heartbeat reads it with a deprecation note.
    const file =
      opts["summary-path"] ??
      process.env.TURN_SUMMARY_PATH ??
      path.join(os.homedir(), ".claude", "turn-summary.txt");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text, "utf8");
    process.stdout.write(`wrote ${file}\n${text}`);
    return 0;
  }

  const root = resolveRoot(opts.root);
  // A writer that is not a conversation has no transcript. Looking for
  // one anyway finds the most recently modified session's, and stamps
  // that session's message count onto the workflow's events.
  const transcript = opts.by ? null : findTranscript(opts.transcript);

  // Identity is resolved for WRITES only. A write has to know which
  // conversation it belongs to; a read folds every log in the store and
  // never asks. Resolving it up front for all three commands is what
  // stopped the store rendering the moment it held a second
  // conversation — the requirement was real, it was just in the wrong
  // place.
  if (cmd === "append") {
    // A writer that is not a conversation names itself and skips session
    // resolution, which exists to answer "which conversation is this".
    // Routed through it, the workflow would inherit a session's name and
    // URL and its events would read as that session's own work.
    const [session, sessionUrl, explicitIdentity] = opts.by
      ? [opts.by, null, false]
      : resolveSession(
          root,
          opts["session-url"] || process.env.LEDGER_SESSION_URL || null,
          opts.session,
          transcript,
          { write: true },
        );
    const stamped = append(root, session, eventFrom(opts), transcript, sessionUrl, explicitIdentity);
    // Printed before the push, because the write already happened: a
    // push that fails must not make a recorded event look unrecorded.
    process.stdout.write(`${JSON.stringify(stamped)}\n`);
    if (!opts["no-push"]) push(root, session, `${stamped.ev} ${stamped.thread}`, stamped);
    return 0;
  }

  if (cmd === "guard") {
    if (!opts.range) throw new LedgerError("guard needs --range <before>..<after>");
    const { ok, report } = guardRange(root, opts.range);
    process.stdout.write(report);
    return ok ? 0 : 1;
  }

  if (cmd === "merged-report") {
    if (!opts.repos) throw new LedgerError("merged-report needs --repos <dir of clones>");
    process.stdout.write(mergedReport(root, opts.repos));
    return 0;
  }

  if (cmd === "reconcile") {
    process.stdout.write(reconcile(root));
    return 0;
  }

  // Before reading, not after: the fold a render publishes must come
  // from the store as the remote has it (skills#52). `--no-pull` is for
  // deliberate offline renders and for tests that pin the events —
  // honest about what it skipped, so the page says so too.
  let staleNote = null;
  if (cmd === "render") {
    staleNote = opts["no-pull"]
      ? "Possibly outdated: rendered without checking the remote (--no-pull)."
      : pullForRender(root);
  }

  const events = readAll(root);
  if (cmd === "state") {
    process.stdout.write(`${JSON.stringify(fold(events), null, 2)}\n`);
    return 0;
  }

  if (cmd !== "render") throw new LedgerError(`unknown command ${JSON.stringify(cmd)}`);
  // The artifact-fresh check reads LEDGER_RENDER_PATH; a writer that
  // must be handed the same path by the model re-introduces the copy
  // that drifts (skills#115 — a session rendered ledger-page.html for
  // a check watching ledger.html). Explicit --out still wins: tests
  // and store CI render to paths of their own choosing.
  const out = opts.out ?? process.env.LEDGER_RENDER_PATH;
  if (!out) {
    throw new LedgerError("render needs --out (or LEDGER_RENDER_PATH set)");
  }

  const folded = fold(events);
  const sessionUrl = storeUrl(root, opts["session-url"]);
  const nowMsg = countUserMessages(transcript);
  const codes = readCodes(root);
  const forge = readForge(root);
  const title = opts.title ?? "Thread ledger";
  let page;
  if (opts.format === "md") {
    const generated = new Date().toISOString().slice(0, 16).replace("T", " ") + " UTC";
    page = renderMarkdown(folded, title, nowMsg, codes, generated, sessionUrl, forge);
    if (staleNote) page = `> ⚠ ${staleNote}\n\n${page}`;
  } else {
    page = renderPage(events, title, nowMsg, codes, sessionUrl, readDiligence(root), readNames(root), forge, staleNote);
  }
  fs.writeFileSync(out, page, "utf8");
  process.stdout.write(`wrote ${out}\n`);
  return 0;
}

// Only the body of `renderBody` is shared with the page; node never
// builds rows itself.
export { renderBody };

// `exitCode` rather than `exit()`: stdout is ASYNCHRONOUS on a pipe, and
// `process.exit()` discards whatever is still buffered — so `state`,
// whose whole purpose is to be read by another program, lost everything
// past the first 64 KiB the moment it was piped anywhere. To a file or a
// terminal the write is synchronous, which is why every interactive use
// looked fine. Setting the code and falling off the end lets node drain
// first, and keeps the status a caller branches on.
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  // A consumer that stops reading early — head, a pager quit half-way —
  // closes the pipe, and node surfaces that as an EPIPE error on
  // stdout. That is how reading ends, not a fault: every other CLI
  // exits quietly there. `process.exit()` is legitimate in this one
  // place, because the reader is gone and there is nothing left to
  // drain for. Anything that is not EPIPE still fails loudly — and the
  // handler is registered only on the CLI path, so importing this
  // module never rewires the host process's stdout.
  process.stdout.on("error", (err) => {
    if (err?.code === "EPIPE") process.exit(0);
    throw err;
  });
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (err) {
    if (err instanceof LedgerError) {
      process.stderr.write(`ledger: ${err.message}\n`);
      process.exitCode = 1;
    } else {
      throw err;
    }
  }
}
