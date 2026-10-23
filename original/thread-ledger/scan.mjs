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
export function blocklistTerms(env) {
  const terms = [];
  for (const name of ["SESSION_MEMORY_URL", "DECISION_MEMORY_URL", "EVIDENCE_MEMORY_URL"]) {
    if (env[name]) terms.push({ label: name, value: env[name] });
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
 * Replace every term in `value` with its label in square brackets.
 *
 * Strings, arrays and plain objects are walked, keys included,
 * and any other value passes through.
 * One pass over each string matches the longest term first,
 * so a label once written is never rewritten.
 *
 * @param {unknown} value  JSON-shaped data, e.g. ledger events
 * @param {{label: string, value: string}[]} terms  from `blocklistTerms`
 * @returns {unknown} a masked copy, or `value` itself when `terms` is empty
 */
export function maskTerms(value, terms) {
  if (!terms.length) return value;
  const ordered = [...terms].sort((a, b) => b.value.length - a.value.length);
  const labels = new Map(ordered.map((term) => [term.value, term.label]));
  const pattern = new RegExp(ordered.map((term) => escapeRegExp(term.value)).join("|"), "g");
  const maskString = (text) => text.replace(pattern, (match) => `[${labels.get(match)}]`);
  const walk = (node) => {
    if (typeof node === "string") return maskString(node);
    if (Array.isArray(node)) return node.map(walk);
    if (node && typeof node === "object") {
      return Object.fromEntries(
        Object.entries(node).map(([key, inner]) => [maskString(key), walk(inner)]),
      );
    }
    return node;
  };
  return walk(value);
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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
