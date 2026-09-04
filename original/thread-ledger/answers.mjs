// The session answers file — what the composer measured and what the
// spawner passed (skills#179 §3, skills#181 item 1).
//
// `REINSET_ANSWERS` names the file the composer writes on SessionStart
// and again on the first prompt; the compose hook exports the default
// path before the composer has run, so "named and absent" is the
// ordinary state of a session's first Stop and reads as nothing, not
// as an error. The file is YAML written by PyYAML's safe_dump, so the
// reader covers that dialect and no more: block maps, block sequences,
// flow `[]` and `{}`, plain and quoted scalars. Anything wider is
// refused rather than guessed at — a reader that shrugs at a construct
// it does not know would read a role it did not read.

import fs from "node:fs";

/**
 * The answers file named by `REINSET_ANSWERS`, or null when none is
 * named or the named file does not exist.
 *
 * Returns `{ path, answers }` on a readable file and `{ path, error }`
 * when the file exists but cannot be read as YAML — a torn file is a
 * finding, not a silent absence.
 */
export function readAnswers(env = process.env) {
  const file = env.REINSET_ANSWERS || null;
  if (!file || !fs.existsSync(file)) return null;
  try {
    return { path: file, answers: parseYaml(fs.readFileSync(file, "utf8")) };
  } catch (err) {
    return { path: file, error: err.message };
  }
}

/** One scalar in safe_dump's plain or quoted style. */
function scalar(raw) {
  const text = raw.trim();
  if (text === "" || text === "null" || text === "~") return null;
  if (text === "true") return true;
  if (text === "false") return false;
  if (text === "[]") return [];
  if (text === "{}") return {};
  if (/^-?\d+$/.test(text)) return Number(text);
  if (/^-?\d+\.\d+$/.test(text)) return Number(text);
  if (text.startsWith("'")) {
    if (!text.endsWith("'") || text.length < 2) throw new Error(`unterminated quote: ${text}`);
    return text.slice(1, -1).replaceAll("''", "'");
  }
  if (text.startsWith('"')) {
    if (!text.endsWith('"') || text.length < 2) throw new Error(`unterminated quote: ${text}`);
    return JSON.parse(text);
  }
  if (text.startsWith("[") || text.startsWith("{")) {
    throw new Error(`unsupported flow collection: ${text}`);
  }
  return text;
}

/** Split `key: value` at the first colon that ends a key. */
function splitKey(text) {
  const at = text.indexOf(":");
  if (at < 1) throw new Error(`expected a key: ${text}`);
  const rest = text.slice(at + 1);
  if (rest !== "" && !rest.startsWith(" ")) throw new Error(`expected a key: ${text}`);
  return [text.slice(0, at).trim(), rest.trim()];
}

/** Parse the PyYAML safe_dump dialect into plain objects. */
export function parseYaml(text) {
  const lines = text
    .split("\n")
    .filter((line) => line.trim() && !line.trimStart().startsWith("#"))
    .map((line) => ({ indent: line.length - line.trimStart().length, text: line.trim() }));
  let at = 0;

  function block(indent) {
    if (at >= lines.length) return null;
    return lines[at].text.startsWith("- ") || lines[at].text === "-" ? sequence(indent) : mapping(indent);
  }

  function mapping(indent) {
    const out = {};
    while (at < lines.length && lines[at].indent === indent) {
      const line = lines[at];
      if (line.text.startsWith("- ")) break;
      const [key, rest] = splitKey(line.text);
      at += 1;
      if (rest === "") {
        const next = lines[at];
        // safe_dump puts a mapping's sequence at the SAME indent as
        // its key, and a nested mapping deeper.
        if (next && (next.indent > indent || (next.indent === indent && next.text.startsWith("- ")))) {
          out[key] = block(next.indent);
        } else {
          out[key] = null;
        }
      } else {
        out[key] = scalar(rest);
      }
      if (at < lines.length && lines[at].indent > indent) {
        throw new Error(`unexpected indent at: ${lines[at].text}`);
      }
    }
    return out;
  }

  function sequence(indent) {
    const out = [];
    while (at < lines.length && lines[at].indent === indent && lines[at].text.startsWith("-")) {
      const item = lines[at].text.slice(1).trim();
      if (item === "") {
        at += 1;
        out.push(lines[at] && lines[at].indent > indent ? block(lines[at].indent) : null);
        continue;
      }
      // `- key: value` opens a mapping whose further keys sit at the
      // item's own column; the first line is rewritten in place so the
      // mapping parser reads it like any other.
      const inner = indent + 2;
      if (/^[^'"\[{][^:]*:( |$)/.test(item)) {
        lines[at] = { indent: inner, text: item };
        out.push(mapping(inner));
        continue;
      }
      at += 1;
      out.push(scalar(item));
    }
    return out;
  }

  const doc = block(lines[0]?.indent ?? 0);
  if (at < lines.length) throw new Error(`unexpected indent at: ${lines[at].text}`);
  return doc ?? {};
}
