// The org's one shortcode map, read from the file `SHORTCODE_MAP` names
// (pandoscope/pandoscope#61, skills#287). Header contract: `../ledger.mjs`.
//
// The map is shortcode → repository, flat or `{forge, patterns, repos}`.
// Who provides the file is the session setup's business, not the ledger's.
// The store carries no map of its own, and a store map beside the
// configured one is a second source, which fails.

import fs from "node:fs";
import path from "node:path";
import process from "node:process";

import { LedgerError } from "../core.mjs";

/** The variable that names the shortcode map's file. */
export const SHORTCODE_MAP = "SHORTCODE_MAP";

/** The maps a store has carried. Either one beside the configured map is a second source. */
export const STORE_MAPS = [path.join("config", "shortcodes.json"), "repo-codes.json"];

/**
 * Read the org's shortcode map from the file `SHORTCODE_MAP` names.
 *
 * @param {string} root the store
 * @param {Record<string, string | undefined>} [env] where `SHORTCODE_MAP` is read
 * @returns {{config: object | null, file: string | null, note: string | null}}
 *   `config` is the map with its `_`-keys (such as `_comment`) left out,
 *   and `file` the path it was read from;
 *   with `SHORTCODE_MAP` unset, `config` and `file` are null
 *   and `note` says that no shortcode map is configured.
 * @throws {LedgerError} when a map is configured and the store holds a map
 *   of its own (checked before the configured file is read),
 *   and when the configured file is missing, does not parse or is not a JSON object;
 *   each message names the file.
 */
export function readShortcodeMap(root, env = process.env) {
  const configured = env[SHORTCODE_MAP];
  if (!configured) {
    // DECISION:FALLBACK: SHORTCODE_MAP is unset.
    // Missing: the org's shortcode map.
    // In its place: every reader works as it does without a map
    // (the response check reports unconfigured, the views show plain repository names).
    // Told: `note`, which the response check returns as its detail and render prints.
    // Test: "is absent with SHORTCODE_MAP unset, and the note names the variable" in test_shortcodes.mjs.
    return {
      config: null,
      file: null,
      note: `no shortcode map is configured: ${SHORTCODE_MAP} is unset, so no shortcode map was read`,
    };
  }
  const file = path.resolve(configured);
  const second = STORE_MAPS.filter((rel) => fs.existsSync(path.join(root, rel)));
  if (second.length) {
    throw new LedgerError(
      `the store holds a second shortcode map beside ${file}: ${second.join(", ")}. ` +
        `The map ${SHORTCODE_MAP} names is the one source (pandoscope/pandoscope#61); remove the store's.`,
    );
  }
  let data;
  try {
    data = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    throw new LedgerError(`cannot read the shortcode map ${file} (${SHORTCODE_MAP}): ${error}`);
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new LedgerError(`the shortcode map ${file} (${SHORTCODE_MAP}) is not an object`);
  }
  const plain = (map) => Object.fromEntries(Object.entries(map).filter(([key]) => !key.startsWith("_")));
  const config = data.repos ? { ...plain(data), repos: plain(data.repos) } : plain(data);
  return { config, file, note: null };
}

/** Repository → shortcode, for the views' labels; empty without a map. */
export function codesOf(config) {
  if (!config) return {};
  const repos = config.repos ?? config;
  return Object.fromEntries(Object.entries(repos).map(([short, repo]) => [repo, short]));
}
