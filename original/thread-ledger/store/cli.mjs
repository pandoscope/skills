// The command line — argument grammar, event construction, usage.
//
// Store-wide options are accepted on either side of the command,
// because that is how every caller writes it. Header contract:
// `../ledger.mjs`.

import { LedgerError } from "../core.mjs";

// ---------------------------------------------------------------- CLI

const FLAGS = [
  "root", "session", "transcript", "session-url", "ev", "thread", "title",
  "ticket", "parent", "deps", "urgency", "importance", "pct", "note", "on",
  "what", "trigger", "out", "format", "by", "range", "branch", "pr", "repos",
  "threads", "tickets", "reviews", "rulings", "summary-path",
];

const BOOLS = ["conversation-only", "no-push", "no-pull"];

// Flags that accumulate: each occurrence appends. A turn can waive
// several tickets, and "last one wins" would silently drop the rest.
const MULTI = ["no-update"];


/**
 * Split argv into a command and its options.
 *
 * Options may appear on either side of the command. Callers put the
 * store-wide ones first — `--root . render …` — and pinning the command
 * to argv[0] silently broke every one of them, since a flag's value
 * then parses as a stray argument.
 */
export function parseArgs(argv) {
  let cmd = null;
  const opts = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith("--")) {
      if (cmd !== null) throw new LedgerError(`unexpected argument ${arg}`);
      cmd = arg;
      continue;
    }
    const name = arg.slice(2);
    if (MULTI.includes(name)) {
      i += 1;
      if (i >= argv.length) throw new LedgerError(`--${name} needs a value`);
      (opts[name] ??= []).push(argv[i]);
    } else if (BOOLS.includes(name)) {
      opts[name] = true;
    } else if (FLAGS.includes(name)) {
      i += 1;
      if (i >= argv.length) throw new LedgerError(`--${name} needs a value`);
      opts[name] = argv[i];
    } else if (name === "help") {
      cmd = cmd ?? "help";
    } else {
      throw new LedgerError(`unknown option --${name}`);
    }
  }
  return [cmd, opts];
}


export function eventFrom(opts) {
  const event = { ev: opts.ev, thread: opts.thread };
  const copyIf = (key, field = key) => {
    if (opts[key] !== undefined) event[field] = opts[key];
  };
  copyIf("title");
  copyIf("ticket");
  copyIf("parent");
  copyIf("note");
  copyIf("on");
  copyIf("what");
  copyIf("trigger");
  copyIf("urgency");
  copyIf("importance");
  copyIf("branch");
  copyIf("pr");
  copyIf("by");
  if (opts["conversation-only"]) event.conversation_only = true;
  if (opts.deps) event.deps = opts.deps.split(",").map((s) => s.trim()).filter(Boolean);
  if (opts.pct !== undefined) event.pct = Number.parseInt(opts.pct, 10);
  return event;
}


// ------------------------------------------------------- turn summary

// The writer side of the heartbeat's turn-summary contract
// (skills#157). The grammar below is what the heartbeat's checks
// read; validating here turns a Stop-hook rejection round trip into
// an immediate error with the correction in it. The round-trip test
// parses the written text with the heartbeat's own reader, so writer
// and checker cannot drift apart silently.
const REVIEW_WORDS = ["none", "read", "persisted", "nothing-to-persist"];

const SLUG_LINE = /^[a-z0-9][a-z0-9-]*$/;

const TICKET_REF = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+#\d+$/;


/** Validate a declaration and render it as turn-summary text. */
export function declareText(opts) {
  const list = (value) =>
    (value ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const errors = [];

  // Threads are observed from the ledger's events, never declared
  // (skills#153) — refusing the flag outright teaches the change
  // instead of writing a line every check now ignores.
  if (opts.threads !== undefined) {
    errors.push(
      "--threads is gone: threads are observed from the ledger's events " +
        "this turn, not declared (skills#153) — append the event instead",
    );
  }
  const tickets = list(opts.tickets);
  for (const ref of tickets) {
    if (!TICKET_REF.test(ref)) {
      errors.push(`ticket ${JSON.stringify(ref)} is not an owner/repo#n reference`);
    }
  }
  const reviews = (opts.reviews ?? "").trim();
  const reviewToken = reviews ? reviews.split(/[\s,]+/)[0].toLowerCase() : null;
  if (!reviews) {
    errors.push(`--reviews is required: one of ${REVIEW_WORDS.join(", ")}`);
  } else if (!REVIEW_WORDS.includes(reviewToken)) {
    errors.push(
      `reviews ${JSON.stringify(reviews)} names no state the heartbeat reads — ` +
        `declare one of: ${REVIEW_WORDS.join(", ")}`,
    );
  }
  const rulings = list(opts.rulings);
  for (const slug of rulings) {
    if (!SLUG_LINE.test(slug)) {
      errors.push(`ruling ${JSON.stringify(slug)} is not a kebab-case slug ([a-z0-9-])`);
    }
  }
  // A waiver without a reason renders as "(no reason given)" on the
  // checker side — representable there, refused here.
  const waivers = opts["no-update"] ?? [];
  for (const waiver of waivers) {
    const [target, ...why] = waiver.trim().split(/\s+/);
    if (!target || !why.length) {
      errors.push(
        `--no-update ${JSON.stringify(waiver)} needs a target and a reason: ` +
          `"<ticket-or-thread> <why it was deliberately not updated>"`,
      );
    }
  }
  if (errors.length) {
    throw new LedgerError(`declare refused:\n  - ${errors.join("\n  - ")}`);
  }

  const lines = [
    `tickets: ${tickets.join(", ")}`,
    `reviews: ${reviews}`,
  ];
  if (rulings.length) lines.push(`rulings: ${rulings.join(", ")}`);
  for (const waiver of waivers) lines.push(`no-update: ${waiver.trim()}`);
  return `${lines.join("\n")}\n`;
}


export const USAGE = `ledger — a session's open-work record

  ledger append --ev <kind> --thread <slug> [--title …] [--ticket owner/repo#1]
                [--conversation-only] [--deps a,b] [--urgency high]
                [--pct 40] [--note …] [--on internal] [--what …] [--trigger …]
                [--by bot] [--no-push]
                [--branch <name>] [--pr owner/repo#2]
  ledger declare --reviews <none|read|persisted|nothing-to-persist>
                 [--tickets owner/repo#1,owner/repo#2]
                 [--rulings slug-a] [--no-update "<target> <reason>"]...
                 [--summary-path <file>]   # validated turn-summary writer; no store needed
                 # threads are observed from the ledger's events, not declared (skills#153)
  ledger state
  ledger render [--out <file>] [--format html|md] [--title …] [--session-url …]
                [--no-pull]   # render pulls the store first; this skips it
                (--out defaults to LEDGER_RENDER_PATH)
  ledger guard --range <before>..<after>   # append-only + fold guard, for store CI
  ledger merged-report --repos <dir>       # live threads whose branch merged; reports, never gates
  ledger reconcile                         # ledger vs forge divergences, needs gh

Global: --root <dir> --session <name> --session-url <url> --transcript <file>
Store: SESSION_MEMORY_URL (required; unset fails)
Identity: append requires --session-url (or LEDGER_SESSION_URL) or --session;
          reads may fall back to the store's recorded URL`;
