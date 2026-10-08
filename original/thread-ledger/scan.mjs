// The outgoing-content scanner (skills#46, check 7).
//
// One scanner, three call sites: the heartbeat's pre-push check, prek
// in the store repos, and the transcript render gate (skills#57). Pure
// functions over plain text — the call sites own what counts as
// "outgoing" and what to do about a hit.
//
// The contract that shapes everything here: values are secrets. A term
// is returned, logged and reported only by its LABEL — the variable it
// came from — because echoing the value would put the secret in the
// very channel this scanner guards.

/**
 * The terms to scan for, labeled by source.
 *
 * Built-ins are the store URL values, taken from the environment
 * automatically. User terms come from `PUSH_BLOCKLIST`, |-separated
 * (newlines get truncated by some layers and `=` confuses parsers; a
 * literal `|` in a term is not expressible — documented as reserved).
 * Unset means built-in scan only: the variable is optional by design.
 */
const STORE_VARS = ["SESSION_MEMORY_URL", "DECISION_MEMORY_URL", "EVIDENCE_MEMORY_URL"];

// A clone URL ends in `.git`; a link to a file in the store does not.
// Scanning the bare base catches both.
function storeBase(url) {
  return url?.replace(/\.git$/, "").replace(/\/+$/, "");
}

export function blocklistTerms(env) {
  const terms = [];
  for (const name of STORE_VARS) {
    const value = storeBase(env[name]);
    if (value) terms.push({ label: name, value });
  }
  (env.PUSH_BLOCKLIST ?? "")
    .split("|")
    .forEach((value, index) => {
      if (value) terms.push({ label: `PUSH_BLOCKLIST term ${index + 1}`, value });
    });
  return terms;
}

/**
 * Labels of the terms `text` contains. Labels only, never values —
 * and never positions, because "line 41" beside a label invites
 * printing line 41.
 */
export function scanText(text, terms) {
  return terms.filter((term) => text.includes(term.value)).map((term) => term.label);
}

/**
 * The shell fragment that expands a labeled term WITHOUT printing it.
 *
 * Handed out in reasons so the model can locate a hit with grep while
 * the value itself stays in the environment end to end.
 */
export function shellRef(label) {
  const match = /^PUSH_BLOCKLIST term (\d+)$/.exec(label);
  if (match) return `"$(printf %s "$PUSH_BLOCKLIST" | cut -d'|' -f${match[1]})"`;
  return `"$${label}"`;
}

/**
 * `text` with every store URL value replaced by `«store»` (skills#242).
 *
 * The log is append-only,
 * so an old event that links a store file by its full URL would make every render fail check 7 forever.
 * Masking at render time keeps the page clean; check 7 still scans the page and catches a value this misses.
 */
export function maskStoreUrls(text, env) {
  let out = text;
  for (const name of STORE_VARS) {
    const value = storeBase(env[name]);
    if (value) out = out.split(value).join("«store»");
  }
  return out;
}
