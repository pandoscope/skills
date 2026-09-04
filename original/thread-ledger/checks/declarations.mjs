// Checks over what the turn declared it touched.
//
// The declaration is cheap and unverifiable on its own; each check here
// diffs it against something written — a ledger event, a ticket comment,
// a store record. Header contract: `../heartbeat.mjs`.

import path from "node:path";

import { ticketWrites } from "../core.mjs";
import {
  PROBE_EXEMPT,
  SPAWNED_ORIGINS,
  answersOf,
  committedThisTurn,
  observedThreads,
  probeExempt,
  recordsThisTurn,
  storeCheckout,
} from "../context.mjs";
import { LEDGER } from "../paths.mjs";

/**
 * Check 1 — the turn declared what it touched, this turn.
 *
 * A summary left in place from an earlier turn is present, well-formed
 * and about different work, so existence cannot be the test: every
 * check downstream would diff against the wrong declaration and report
 * on a turn nobody asked about. Freshness is the mtime against the
 * stamp of the message the principal last typed.
 */
export function checkTurnSummary(ctx) {
  // The block teaches the validated writer, never the raw file: hand
  // edits are what let a malformed declaration reach this hook at all
  // (skills#157), and naming the path invites them.
  const write = `  node ${LEDGER} declare --reviews <none|read|persisted|nothing-to-persist> [--tickets owner/repo#n] [--no-update "<target> <reason>"]`;

  // Without a boundary nothing downstream means what it says: freshness
  // has nothing to compare against and check 3's window widens to all
  // of history, so both would report a pass they never established.
  // This blocks rather than reporting `unconfigured` — an unset repo
  // root is a deployment declining check 2, whereas the platform always
  // supplies a transcript, so its absence is something broken and the
  // hook cannot do what it was registered for.
  if (!ctx.turnStart) {
    return {
      verdict: "fail",
      detail: `no user turn in ${ctx.transcript ?? "(no transcript path given)"}`,
      reason: [
        "The turn is not complete until this hook can tell where it began. " +
          "The transcript it was given holds no message from the principal, " +
          "so nothing establishes the turn's boundary and no check " +
          "downstream can be trusted.",
        "",
        `  ls -l ${ctx.transcript ?? "<no transcript path was given>"}`,
      ].join("\n"),
    };
  }

  // Identity before anything that depends on it. A store with several
  // conversations and nothing naming this one leaves the recorder
  // falling back to a platform-local id that matches no log, so check 3
  // compares against events nothing ever writes and can never pass —
  // block, release, repeat. Saying which configuration is missing costs
  // one turn; failing as though the ledger were behind costs every one
  // after it.
  if (!ctx.namedItself && ctx.conversations > 1) {
    return {
      verdict: "fail",
      detail: `${ctx.conversations} conversations in the store and none named as this one`,
      reason: [
        "The turn is not complete until this session names which " +
          `conversation it is. The store holds ${ctx.conversations} ` +
          "conversations and nothing says which one this turn belongs to, so " +
          "no check can tell this session's events from another's.",
        "",
        "  echo 'SESSION_URL=<this conversation's URL>' >> $HOME/.claude/session.env",
      ].join("\n"),
    };
  }

  const stale = ctx.summary.exists && ctx.turnStart && ctx.summary.writtenAt < ctx.turnStart;
  if (!ctx.summary.exists || stale) {
    return {
      verdict: "fail",
      detail: stale
        ? `turn summary predates the turn (written ${ctx.summary.writtenAt.toISOString()})`
        : "no turn summary",
      reason: [
        "The turn is not complete until it declares itself. Declare the " +
          "tickets this turn touched and its reviews state; the threads are " +
          "observed from the ledger, not declared (skills#153).",
        "",
        write,
      ].join("\n"),
    };
  }

  // Threads are DERIVED from the ledger's own events this turn
  // (skills#153) — the declaration was redundant with the observation,
  // and the empty-declaration trap moved to check 3, which measures
  // commits against observed events instead of declared names.
  return {
    verdict: "pass",
    detail: ctx.summary.legacy
      ? "turn summary read from the v1 path — deprecated, migrate the wrapper (skills#153)"
      : "turn summary fresh",
  };
}

/**
 * Check 3 — the ledger heard about the turn's work.
 *
 * The original heartbeat, inverted by skills#153: threads are observed
 * from the ledger's own events, so a declaration can no longer name a
 * thread the ledger never heard of — the two-step trap (#123) is gone
 * by construction. What remains checkable is the empty-observation
 * trap that used to live in check 1: the turn's own commits are
 * evidence it cannot write about itself, so a turn that committed to a
 * clone while appending nothing is a turn the ledger knows nothing
 * about.
 */
export function checkLedgerEvent(ctx) {
  // Every check runs even once one has failed, so this has to survive a
  // turn with no boundary rather than throw into the crash handler and
  // replace check 1's reason with a stack trace.
  if (!ctx.turnStart) {
    return { verdict: "unconfigured", detail: "no turn boundary to measure against" };
  }
  if (probeExempt(ctx)) return PROBE_EXEMPT;
  const touched = observedThreads(ctx);
  if (!touched.size) {
    const committed = ctx.clones.find((repo) => committedThisTurn(repo, ctx.turnStart));
    if (committed) {
      return {
        verdict: "fail",
        detail: `committed to ${committed.name} with no ledger event this turn`,
        reason: [
          "The turn is not complete until the ledger has an event for the " +
            `work behind it. It committed to ${committed.name} and appended ` +
            "nothing, so the ledger knows nothing about this turn.",
          "",
          `  node ${LEDGER} append --ev progress --thread <slug> --note <what happened>`,
        ].join("\n"),
      };
    }
    return { verdict: "pass", detail: "no events and no commits this turn — nothing to record" };
  }
  return { verdict: "pass", detail: `${touched.size} threads observed` };
}

/**
 * Check 4 — every ticket the turn declared heard about it.
 *
 * The declared set diffs against issue-writing tool calls in the
 * transcript — no network, same unlock as every transcript-side
 * check. Fires on EVERY declared ticket lacking an observed write, by
 * ruling: better a coarse reminder than a ticket that silently
 * diverges from what the session knows. The per-ticket escape is the
 * `no-update:` waiver — logged as a claim, never verified, so
 * declining to update is a visible act rather than a silence.
 */
export function checkTicketsUpdated(ctx) {
  if (!ctx.turnStart) {
    return { verdict: "unconfigured", detail: "no turn boundary to measure against" };
  }
  const declared = ctx.summary.tickets
    .map((ticket) => ticket.toLowerCase())
    .filter((ticket) => /^[\w.-]+\/[\w.-]+#\d+$/.test(ticket));
  if (!declared.length) {
    return { verdict: "pass", detail: "no tickets declared — nothing to diff" };
  }
  const written = ticketWrites(ctx.transcriptText, ctx.turnStart.toISOString());
  const waived = declared.filter((ticket) => ctx.summary.waivers[ticket]);
  const missing = declared.filter(
    (ticket) => !written.has(ticket) && !ctx.summary.waivers[ticket],
  );
  if (!missing.length) {
    const claims = waived.length
      ? `; waived as claims: ${waived.map((t) => `${t} (${ctx.summary.waivers[t]})`).join(", ")}`
      : "";
    return { verdict: "pass", detail: `${declared.length} tickets declared${claims}` };
  }
  return {
    verdict: "fail",
    detail: `no observed write for ${missing.join(", ")}`,
    reason: [
      "The turn is not complete until every ticket it declared heard " +
        `about it. Declared and never written to this turn: ` +
        `${missing.join(", ")}. Update each one on the forge, or waive ` +
        "it explicitly — redeclare with a waiver per ticket, which is " +
        "logged as a claim:",
      "",
      `  node ${LEDGER} declare <your declaration> --no-update "<owner/repo#n> <why>"`,
    ].join("\n"),
  };
}

/**
 * Check 4b — a declared ticket outside the spawner's passed list is
 * surfaced, never blocked (skills#179 D5).
 *
 * `passed.thread` and `passed.tickets` are the spawner's claim and the
 * ledger is the record. A spawned session declaring a ticket its
 * spawner never named has drifted from what it was spawned for — which
 * may be right, and is the orchestrator's to judge from the printed
 * drift. A principal-origin session has no passed list and no drift to
 * measure; without an answers file the check has looked at nothing.
 */
export function checkPassedTickets(ctx) {
  if (!ctx.answers) {
    return { verdict: "unconfigured", detail: "no session answers file — nothing to diff" };
  }
  if (ctx.answers.error) {
    return {
      verdict: "unconfigured",
      detail: `session answers file unreadable: ${ctx.answers.error}`,
    };
  }
  const passed = answersOf(ctx)?.passed;
  if (!passed || !SPAWNED_ORIGINS.has(passed.origin)) {
    return { verdict: "pass", detail: "no spawner's passed list — nothing to drift from" };
  }
  const allowed = new Set((passed.tickets ?? []).map((ticket) => String(ticket).toLowerCase()));
  const declared = ctx.summary.tickets
    .map((ticket) => ticket.toLowerCase())
    .filter((ticket) => /^[\w.-]+\/[\w.-]+#\d+$/.test(ticket));
  const drifted = declared.filter((ticket) => !allowed.has(ticket));
  if (!drifted.length) {
    return { verdict: "pass", detail: `${declared.length} declared tickets inside the passed list` };
  }
  const list = allowed.size ? [...allowed].join(", ") : "(none)";
  return {
    verdict: "pass",
    detail: `declared outside the passed list: ${drifted.join(", ")}`,
    notice:
      "Ticket drift, surfaced and not blocked (skills#179 D5): this turn " +
      `declared ${drifted.join(", ")}, outside the tickets its spawner ` +
      `passed — ${list} (origin ${passed.origin}). The ledger is the ` +
      "record; the spawner's list is its claim.",
  };
}

/**
 * Check 8 — every ruling the turn declared is a record in the store.
 *
 * The `rulings:` summary line names the slugs the principal ruled on
 * this turn; each one must appear in a decisions/ filename that
 * ARRIVED this turn. Purely mechanical — declared set vs observed
 * files — so it lands blocking. The blind spot is accepted by ruling
 * E10: a ruling the turn never declares is invisible here, and the
 * habit of declaring is what the grammar trains.
 */
export function checkRulingsRecorded(ctx) {
  if (!ctx.turnStart) {
    return { verdict: "unconfigured", detail: "no turn boundary to measure against" };
  }
  if (!ctx.summary.rulings.length) {
    return { verdict: "pass", detail: "no rulings declared — nothing to diff" };
  }
  if (!ctx.decisionUrl) {
    return {
      verdict: "unconfigured",
      detail: "rulings declared but DECISION_MEMORY_URL is unset — nothing was checked",
    };
  }
  const { store, open } = storeCheckout(ctx.decisionUrl, ctx.clones);
  if (!store) {
    return {
      verdict: "unconfigured",
      detail: "rulings declared but the decision store has no checkout to observe",
    };
  }
  if (open.length > 1) {
    return {
      verdict: "unconfigured",
      detail: `${open.length} decision-store checkouts have open recorder sessions — ambiguous`,
    };
  }
  const arrived = recordsThisTurn(store, ctx.turnStart);
  const missing = ctx.summary.rulings.filter(
    (slug) => !arrived.some((name) => name.includes(slug)),
  );
  if (!missing.length) {
    return { verdict: "pass", detail: `${ctx.summary.rulings.length} declared rulings recorded` };
  }
  const recorder = `python3 ${path.join(store, "tools", "record.py")}`;
  return {
    verdict: "fail",
    detail: `no record arrived for ${missing.join(", ")}`,
    reason: [
      "The turn is not complete until every ruling it declared is a " +
        `record. Declared and not in any decisions/ file that arrived ` +
        `this turn: ${missing.join(", ")}. Write each record, or correct ` +
        "the declaration to the slugs actually recorded.",
      "",
      `  ${recorder} record --from <drafts.json>`,
    ].join("\n"),
  };
}
