// Reconciling the ledger with the forge.
//
// The forge knows which tickets merged; the ledger knows which threads
// claim them. This is the one place the two are compared, and it
// reports rather than writes. Header contract: `../ledger.mjs`.

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { LedgerError, TERMINAL, fold } from "../core.mjs";
import { git, gitOrNull, readAll, tail } from "./io.mjs";

/** The clone under `reposDir` whose origin names `ownerRepo`, or null. */
function cloneFor(reposDir, ownerRepo) {
  if (!reposDir || !fs.existsSync(reposDir)) return null;
  for (const entry of fs.readdirSync(reposDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const dir = path.join(reposDir, entry.name);
    if (!fs.existsSync(path.join(dir, ".git"))) continue;
    const origin = gitOrNull(dir, "remote", "get-url", "origin");
    if (origin && tail(origin) === ownerRepo.toLowerCase()) return dir;
  }
  return null;
}


/**
 * Live threads whose recorded branch is already merged (skills#70).
 *
 * The SessionStart twin of check-clones.sh: merged-into-default is a
 * pure git question — `merge-base --is-ancestor` — so it needs no
 * credentials and runs where the API cannot. It REPORTS and never
 * gates: an unknown ref, a missing clone, a thread that recorded no
 * branch are all silence, because a reporter that can fail becomes a
 * gate the moment someone waits on it. Exit is always 0; deciding what
 * event to append stays with the reader.
 */
export function mergedReport(root, reposDir) {
  const lines = [];
  for (const thread of fold(readAll(root))) {
    if (TERMINAL.includes(thread.state)) continue;
    if (!thread.branch || !thread.ticket) continue;
    const clone = cloneFor(reposDir, thread.ticket.split("#")[0]);
    if (!clone) continue;
    if (gitOrNull(clone, "rev-parse", "--verify", "--quiet", `origin/${thread.branch}`) === null) {
      continue; // The ref is gone (deleted on merge, or never pushed): unknowable, so silent.
    }
    const head = gitOrNull(clone, "symbolic-ref", "-q", "refs/remotes/origin/HEAD");
    const target = head ? head.replace("refs/remotes/origin/", "") : "main";
    try {
      git(clone, "merge-base", "--is-ancestor", `origin/${thread.branch}`, `origin/${target}`);
    } catch {
      continue; // Not merged (or not comparable) — nothing to report.
    }
    lines.push(
      `ledger: thread ${thread.thread} is ${thread.state} at ${thread.pct}%, but its ` +
        `branch ${thread.branch} is merged into ${target} — if the work is done, ` +
        `append completed; if follow-up remains, say so in a progress note.`,
    );
  }
  return lines.length ? `${lines.join("\n")}\n` : "";
}


/** Parse `owner/repo#n` into its two halves. */
function ticketParts(ref) {
  const match = /^([\w.-]+\/[\w.-]+)#(\d+)$/.exec(String(ref));
  return match ? { repo: match[1], number: match[2] } : null;
}


function ghJson(args) {
  try {
    return JSON.parse(
      execFileSync("gh", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }),
    );
  } catch {
    return null;
  }
}


/**
 * Compare live threads against forge state, both directions
 * (skills#70): a live thread whose ticket is closed, and a completed
 * thread whose PR never merged. On demand, because it is API-priced:
 * latency belongs where someone asked the question, not on every Stop.
 * Prints divergences and never writes — reconciliation reports, a
 * human or the model decides what event to append.
 */
export function reconcile(root) {
  try {
    execFileSync("gh", ["--version"], { stdio: ["ignore", "ignore", "ignore"] });
  } catch {
    throw new LedgerError(
      "reconcile asks the forge, which needs the gh CLI — run it where gh is " +
        "installed and authenticated (not in a managed session whose tooling " +
        "replaces it).",
    );
  }
  const lines = [];
  for (const thread of fold(readAll(root))) {
    const live = !TERMINAL.includes(thread.state);
    const ticket = ticketParts(thread.ticket);
    if (live && ticket) {
      const data = ghJson(["issue", "view", ticket.number, "--repo", ticket.repo, "--json", "state"]);
      if (!data) {
        lines.push(`? ${thread.thread}: could not read ticket ${thread.ticket}`);
      } else if (data.state === "CLOSED") {
        lines.push(
          `! ${thread.thread} is ${thread.state}, but its ticket ${thread.ticket} is closed`,
        );
      }
    }
    const pr = ticketParts(thread.pr);
    if (!live && thread.state === "completed" && pr) {
      const data = ghJson(["pr", "view", pr.number, "--repo", pr.repo, "--json", "state"]);
      if (!data) {
        lines.push(`? ${thread.thread}: could not read PR ${thread.pr}`);
      } else if (data.state !== "MERGED") {
        lines.push(
          `! ${thread.thread} is completed, but its PR ${thread.pr} is ${data.state.toLowerCase()} — completed work that never merged`,
        );
      }
    }
  }
  if (!lines.length) return "reconciled: no divergence between the ledger and the forge.\n";
  return `${lines.join("\n")}\n`;
}
