// Paths the heartbeat owns.
//
// Two homes, and they are not interchangeable: the skill's own files
// sit beside this module, and the session's local state sits under the
// home the session runs as. A check that mixes them up writes state
// into the checkout or teaches a command that points at nothing.

import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));

export const LEDGER = path.join(HERE, "ledger.mjs");

/** Local state the hook owns, under the home the session runs as. */
export function localFile(name) {
  return path.join(process.env.HOME ?? "", ".claude", name);
}
