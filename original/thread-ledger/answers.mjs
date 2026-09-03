// The session answers file — what the composer measured and what the
// spawner passed (skills#179 §3, skills#181 item 1).
//
// `REINSET_ANSWERS` names the file the composer writes on SessionStart
// and again on the first prompt; the compose hook exports the default
// path before the composer has run, so "named and absent" is the
// ordinary state of a session's first Stop and reads as nothing, not
// as an error. The file is YAML written by PyYAML's safe_dump, so the
// reader covers that dialect and no more: block maps, block sequences,
// flow `[]` and `{}`, plain and quoted scalars.

/**
 * The answers file named by `REINSET_ANSWERS`, or null when none is
 * named or the named file does not exist.
 *
 * Returns `{ path, answers }` on a readable file and `{ path, error }`
 * when the file exists but cannot be read as YAML — a torn file is a
 * finding, not a silent absence.
 */
export function readAnswers(env = process.env) {
  throw new Error("not implemented");
}

/** Parse the PyYAML safe_dump dialect into plain objects. */
export function parseYaml(text) {
  throw new Error("not implemented");
}
