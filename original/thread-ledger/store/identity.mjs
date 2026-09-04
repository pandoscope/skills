// Which conversation this is.
//
// An append pushes immediately, so a guessed identity is published
// before any warning can be acted on: identity comes from the
// environment or the store, and a store with several conversations and
// nothing naming this one refuses rather than picks. Header contract:
// `../ledger.mjs`.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";

import { LedgerError, WRITERS, countUserTurns, sessionFromUrl } from "../core.mjs";
import { ledgerDir, logFiles } from "./io.mjs";

const TRANSCRIPT_ROOT = path.join(os.homedir(), ".claude", "projects");


// ----------------------------------------------------------- identity

/**
 * Refuse to start a second log for a conversation already logging.
 *
 * Appending under a second name starts a fresh file that folds in beside
 * the first, and nothing looks wrong: both files are valid, the state is
 * merely built from the wrong one.
 *
 * The guard is for INFERRED names only (skills#62). It cannot tell a
 * drifted name from a genuinely new conversation — but the caller can,
 * and one that states identity by URL has said so authoritatively: the
 * append path skips the check then, and a second conversation opens its
 * own log beside the first, which is the store's documented shape.
 */
export function checkSessionFile(root, session) {
  const existing = logFiles(root)
    .map((file) => path.basename(file, ".jsonl"))
    // A writer's log is not a conversation's, so it neither counts as
    // the conversation already logging nor is something to append to.
    .filter((name) => !WRITERS.includes(name));
  if (existing.length === 1 && existing[0] !== session) {
    throw new LedgerError(
      `this store logs session ${JSON.stringify(existing[0])}, not ` +
        `${JSON.stringify(session)} — an append under a second inferred name ` +
        `would split one conversation's log in two. If this is that ` +
        `conversation, pass --session ${existing[0]}. If it is genuinely a ` +
        `new conversation, state its identity with --session-url (or ` +
        `LEDGER_SESSION_URL): an explicit URL is the identity, and the ` +
        `guard steps aside for it.`,
    );
  }
}


function urlFor(root, session) {
  const file = path.join(ledgerDir(root), `${session}.url`);
  if (!fs.existsSync(file)) return null;
  return fs.readFileSync(file, "utf8").trim() || null;
}


/**
 * The conversation a rendered view links back to, or null.
 *
 * Null is a correct answer here, unlike for a write. A store holding
 * several conversations has no single one to link to, and every thread
 * already carries its own URL on its anchors — which is the link the
 * rows actually use. A store-wide link is a convenience for the
 * one-conversation case, so its absence degrades the header and nothing
 * else.
 */
export function storeUrl(root, explicit) {
  if (explicit) return explicit.trim();
  const dir = ledgerDir(root);
  if (!fs.existsSync(dir)) return null;
  const known = fs.readdirSync(dir).filter((name) => name.endsWith(".url"));
  if (known.length !== 1) return null;
  return fs.readFileSync(path.join(dir, known[0]), "utf8").trim() || null;
}


/**
 * Decide which conversation this invocation is writing.
 *
 * The URL is the identity when one is known, and the log's filename is
 * derived from it. Everything else is a fallback that says so.
 */
export function resolveSession(root, givenUrl, givenId, transcript, { write = false } = {}) {
  const dir = ledgerDir(root);
  if (givenUrl) {
    const url = givenUrl.trim();
    const session = sessionFromUrl(url);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${session}.url`), `${url}\n`, "utf8");
    // The third element says the identity was STATED, not inferred —
    // the one-log guard steps aside for a caller who answered the
    // question it exists to ask (skills#62).
    return [session, url, true];
  }

  // A WRITE proves its identity or refuses (skills#51). The fallbacks
  // below exist for reads — CI rendering a store it cannot know the
  // session of — but an append that guesses publishes the guess: the
  // append, the identity choice and the push are one action, so by the
  // time a warning prints, the store has already recorded events under
  // an identity that exists nowhere. Measured twice: once adopting the
  // store's recorded URL from a different conversation, once falling
  // back to the transcript filename. DECISION:IFACE — the refusal is
  // scoped to writes, not to resolution: the sealing hook keeps the
  // recorded-URL fallback because its only alternative identity is a
  // platform-local id that matches no log, and a single-conversation
  // store makes that fallback exact, while the CLI append always has a
  // caller who can say who they are.
  if (write) {
    if (givenId) return [givenId, urlFor(root, givenId), false];
    throw new LedgerError(
      "refusing to append without an explicit identity: pass --session-url " +
        "(or set LEDGER_SESSION_URL), or --session when the log is named " +
        "outright. Guessing has been measured to misfile events — adopting " +
        "the store's recorded URL or the transcript filename — and the " +
        "append pushes immediately, so the wrong identity is published " +
        "before any warning can be acted on. Nothing was written.",
    );
  }

  const known = fs.existsSync(dir)
    ? fs.readdirSync(dir).filter((name) => name.endsWith(".url")).sort()
    : [];
  if (known.length === 1) {
    const url = fs.readFileSync(path.join(dir, known[0]), "utf8").trim();
    if (url) return [sessionFromUrl(url), url, false];
  }

  if (givenId) return [givenId, urlFor(root, givenId), false];
  if (transcript) {
    process.stderr.write(
      "ledger: no session URL known; identifying this conversation by its " +
        "transcript filename, which is local to this machine. Pass " +
        "--session-url once to fix the identity in the store.\n",
    );
    return [path.basename(transcript, ".jsonl"), null, false];
  }
  throw new LedgerError(
    "cannot tell which conversation this is: no --session-url, no recorded " +
      "URL in the store, no --session, and no transcript.",
  );
}


// --------------------------------------------------------- transcript

/**
 * User turns so far in `transcript` — the anchor's message index.
 *
 * Null when no transcript is available, so the anchor records an honest
 * gap rather than a fabricated number. The counting itself is
 * `countUserTurns` in core.mjs: the heartbeat and the transcript
 * renderer address the same positions, and two counters that disagree
 * would make an anchor point at a different message per reader.
 */
export function countUserMessages(transcript) {
  if (!transcript || !fs.existsSync(transcript)) return null;
  return countUserTurns(fs.readFileSync(transcript, "utf8"));
}


export function findTranscript(explicit) {
  if (explicit) return explicit;
  if (!fs.existsSync(TRANSCRIPT_ROOT)) return null;
  const found = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith(".jsonl")) found.push(full);
    }
  };
  walk(TRANSCRIPT_ROOT);
  if (!found.length) return null;
  return found.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0];
}
