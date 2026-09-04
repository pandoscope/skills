// Reading the store — git, the log files, and the maps beside them.
//
// Every read the recorder does is here, so a caller never has to know
// where a log lives or which of them belongs to this conversation.
// Header contract: `../ledger.mjs`.

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";

import { LedgerError } from "../core.mjs";

const DEFAULT_ROOT = "/workspace/session-memory";


// ----------------------------------------------------------------- IO

/**
 * Run git in `root`; throw with full stderr on failure.
 *
 * stderr is captured rather than inherited, so a step this tool expects
 * to fail and recovers from — a push that lost a race — does not print
 * git's alarm to a reader who is about to be told it worked.
 */
export function git(root, ...args) {
  try {
    return execFileSync("git", ["-C", root, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (err) {
    throw new LedgerError(`git ${args.join(" ")} failed in ${root}:\n${err.stderr ?? err.message}`);
  }
}


// --------------------------------------------------------- reconcile

/** Run git in `dir`, or null when the command legitimately fails. */
export function gitOrNull(dir, ...args) {
  try {
    return git(dir, ...args).trim();
  } catch {
    return null;
  }
}


export function tail(url) {
  const trimmed = String(url).replace(/\/+$/, "").replace(/\.git$/, "");
  const parts = trimmed.replace(/:/g, "/").split("/").filter(Boolean);
  return parts.slice(-2).join("/").toLowerCase();
}


/**
 * Fail when the clone is not the store the environment names.
 *
 * Managed environments rewrite remotes through local proxies, so compare
 * the trailing owner/repo pair rather than the whole URL.
 */
function verifyOrigin(root, url) {
  const origin = git(root, "remote", "get-url", "origin").trim();
  if (tail(origin) !== tail(url)) {
    throw new LedgerError(
      `${root} has origin ${JSON.stringify(tail(origin))}, but SESSION_MEMORY_URL ` +
        `names ${JSON.stringify(tail(url))} — refusing to write to the wrong store`,
    );
  }
}


/**
 * The harness clone of `url` in the session root, or null.
 *
 * SESSION_MEMORY_ROOT is exported by the Stop-hook wrapper, so it is
 * absent from an ordinary command line in the same session. Reading
 * the session.env the hooks read — and deriving the directory exactly
 * as ensure-stores.sh does — is what makes a bare `append` and the
 * heartbeat agree without anyone remembering to export a variable.
 */
function harnessClone(url) {
  const envFile = path.join(process.env.HOME ?? os.homedir(), ".claude", "session.env");
  let sessionRoot = null;
  try {
    const match = fs.readFileSync(envFile, "utf8").match(/^SESSION_ROOT=(.*)$/m);
    sessionRoot = match ? match[1].trim() : null;
  } catch {
    return null;
  }
  if (!sessionRoot) return null;
  const dir = path.join(sessionRoot, path.basename(url.replace(/\/+$/, ""), ".git"));
  return fs.existsSync(path.join(dir, ".git")) ? dir : null;
}


/**
 * Locate the session-memory clone.
 *
 * `--root` names a clone outright. Otherwise SESSION_MEMORY_ROOT names
 * it — the same variable the Stop-hook heartbeat reads, so the copy
 * this tool writes IS the copy the checker judges. Resolve, never
 * clone (meta#67): a writer that clones a store of its own splits
 * every store into a written copy and a read copy, and the split is
 * silent — each half is a healthy git clone, and the checker reports a
 * just-written event as missing. A missing clone therefore fails here,
 * naming the fix (add the store to the session's sources), exactly as
 * ensure-stores.sh does.
 */
export function resolveRoot(explicit) {
  if (explicit) return explicit;
  const url = process.env.SESSION_MEMORY_URL ?? "";
  if (!url) {
    throw new LedgerError(
      "SESSION_MEMORY_URL is unset, so there is no store to write to. Set it " +
        "in this environment (shell profile locally, the environment's " +
        "configuration for cloud sessions, a repository secret in CI), or pass " +
        "--root to name a clone explicitly.",
    );
  }
  const named = process.env.SESSION_MEMORY_ROOT || harnessClone(url) || DEFAULT_ROOT;
  if (!fs.existsSync(path.join(named, ".git"))) {
    throw new LedgerError(
      `no session-memory clone at ${named}. This tool does not clone one: a ` +
        `second clone splits the store into a copy the writer writes and a copy ` +
        `the heartbeat reads (meta#67). Add the store repo to this session's ` +
        `sources so the harness clones it, set SESSION_MEMORY_ROOT to the ` +
        `existing clone, or pass --root. Nothing was written.`,
    );
  }
  verifyOrigin(named, url);
  return named;
}


export function ledgerDir(root) {
  return path.join(root, "ledger");
}


export function logFiles(root) {
  const dir = ledgerDir(root);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((name) => name.endsWith(".jsonl"))
    .map((name) => path.join(dir, name));
}


/**
 * Every event across every session file, in global order.
 *
 * Events interleave by their own stamp. Conversations overlap — one
 * starts, a second starts and ends, the first writes again — so ordering
 * whole files puts every later event of the earlier-starting file ahead
 * of every event of the other, and the fold takes an older event as the
 * newer one. Nothing looks wrong: both files are valid, the state is
 * merely built in an order that never happened.
 *
 * Two ties break it, in order: line position within a file, because a
 * second of wall clock holds several appends and only the file knows
 * which came first; then the filename, so two files stamped alike order
 * the same way on every machine.
 *
 * An event with no stamp sorts after every stamped one. Unstamped means
 * pre-contract, which is older than anything the recorder has written —
 * but it cannot be placed, and last is the position that claims least.
 */
export function readAll(root) {
  const events = [];
  for (const file of logFiles(root)) {
    const name = path.basename(file);
    const lines = fs.readFileSync(file, "utf8").split("\n");
    lines.forEach((line, index) => {
      if (!line.trim()) return;
      try {
        events.push({ event: JSON.parse(line), name, line: index });
      } catch (err) {
        throw new LedgerError(`${file}:${index + 1} is not valid JSON: ${err.message}`);
      }
    });
  }
  const key = (entry) => [entry.event.at ?? "~", entry.name, entry.line];
  events.sort((a, b) => {
    const [ka, kb] = [key(a), key(b)];
    for (let i = 0; i < ka.length; i += 1) {
      if (ka[i] < kb[i]) return -1;
      if (ka[i] > kb[i]) return 1;
    }
    return 0;
  });
  return events.map((entry) => entry.event);
}


/**
 * Repo short codes from the store, for ticket prefixes.
 *
 * Store-owned rather than tool-owned: the skill ships no org's repo
 * names. Missing file or missing entry both degrade to the repo's own
 * name, which reads as long rather than wrong.
 */
export function readCodes(root) {
  const file = path.join(root, "repo-codes.json");
  if (!fs.existsSync(file)) return {};
  const data = JSON.parse(fs.readFileSync(file, "utf8"));
  return Object.fromEntries(Object.entries(data).filter(([key]) => !key.startsWith("_")));
}


/**
 * The store's forge config, shared with the response-hygiene check.
 *
 * `config/shortcodes.json`: a flat shortcode → repo map (GitHub
 * assumed) or `{forge, patterns, repos}` naming the org's own base and
 * URL patterns. Views take it as data — a missing or unreadable file
 * degrades to the GitHub defaults, exactly like an absent map.
 */
export function readForge(root) {
  const file = path.join(root, "config", "shortcodes.json");
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return {};
  }
}


/**
 * Human names for sessions, from `ledger/<session>.name` sidecars.
 *
 * A session's id identifies it; a name is what a reader recognises it
 * by. The sidecar is written by whoever wants the name — principal or
 * session — and absence simply renders the id.
 */
export function readNames(root) {
  const dir = ledgerDir(root);
  if (!fs.existsSync(dir)) return {};
  const names = {};
  for (const file of fs.readdirSync(dir).filter((name) => name.endsWith(".name"))) {
    const text = fs.readFileSync(path.join(dir, file), "utf8").trim();
    if (text) names[path.basename(file, ".name")] = text;
  }
  return names;
}


/**
 * Every raw diligence record in the store, oldest file order.
 *
 * These are the per-Stop records the heartbeat flushes beside each
 * seal. The page embeds them so digest-less seals can project their
 * digest at render time; a torn line is skipped, not thrown on.
 */
export function readDiligence(root) {
  const dir = path.join(root, "diligence");
  if (!fs.existsSync(dir)) return [];
  const records = [];
  for (const name of fs.readdirSync(dir).filter((file) => file.endsWith(".jsonl")).sort()) {
    for (const line of fs.readFileSync(path.join(dir, name), "utf8").split("\n")) {
      if (!line.trim()) continue;
      try {
        records.push(JSON.parse(line));
      } catch {
        // A torn record must not deny the rest of the corpus a render.
      }
    }
  }
  return records;
}
