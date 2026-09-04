// The same heartbeat, run as a linter before the turn ends (skills#126).
//
// Invoked as a tool call — `node heartbeat.mjs --preflight --draft
// <file> [--fix]` — it runs every check against observed state with the
// draft standing in for the response, prints every verdict, and exits 1
// when anything would fail. It never seals, never blocks, and never
// writes ledger events, summaries, or waivers: preflight reports, the
// agent does the work. `--fix` is the one write it owns, and it edits
// notation only — refs to their canonical linked forms, commit hashes
// to commit links — in the draft file and nowhere else.
//
// Header contract: `heartbeat.mjs`.

import fs from "node:fs";
import path from "node:path";
import process from "node:process";

import { knownPrs, refViolations, stripCode } from "./core.mjs";
import { CHECKS } from "./checks/index.mjs";
import { context, gitOrNull } from "./context.mjs";
import { logCompliance } from "./compliance.mjs";

/** The shortcode map the store carries, or null when it carries none. */
function readShortcodes(root) {
  try {
    return JSON.parse(fs.readFileSync(path.join(root, "config", "shortcodes.json"), "utf8"));
  } catch {
    return null;
  }
}

function escapeRe(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Resolve a commit hash across the session's clones.
 *
 * The formulation ruled on skills#126: unique hit → a link to that
 * repo's commit page, built from the same shortcode map every other
 * link uses; anything else → leave the token and report why. The map,
 * not the clone's remote URL, names the repo — origin URLs come in
 * shapes (ssh, local mirrors) that no link should be derived from.
 */
function resolveHash(clones, config, hash) {
  const hits = clones.filter(
    (repo) => gitOrNull(repo.path, "cat-file", "-e", `${hash}^{commit}`) !== null,
  );
  if (hits.length === 0) return { why: "resolves in no clone" };
  if (hits.length > 1) return { why: `ambiguous — resolves in ${hits.length} clones` };
  const [repo] = hits;
  const repos = config.repos ?? config;
  const fullName = Object.values(repos).find((name) => name.split("/").pop() === repo.name);
  if (!fullName) return { why: `no shortcode maps to clone ${repo.name}` };
  const full = gitOrNull(repo.path, "rev-parse", `${hash}^{commit}`);
  const base = config.forge ?? "https://github.com";
  return { link: `[${repo.name}@${hash}](${base}/${fullName}/commit/${full})` };
}

/**
 * Lint the draft's notation, optionally repairing it.
 *
 * Fenced blocks are quoted material and stay untouched; existing
 * markdown links are already spoken for. Inline code is scanned for
 * commit hashes ONLY — prose habitually backticks a hash, so for this
 * one rule the code-span exemption would be the escape hatch rather
 * than the protection (skills#126, 2026-08-20 incident) — while ref
 * style inside inline code stays exempt as everywhere else.
 */
function lintDraft(text, ctx, config, fix) {
  const findings = [];
  const violations = refViolations(stripCode(text), config, knownPrs(ctx.events)).filter(
    (violation) => violation.canonical,
  );
  const fixRefs = (piece) => {
    let out = piece;
    for (const violation of violations) {
      out = out.replace(
        new RegExp(`(?<![\\w\\[/])${escapeRe(violation.token)}(?![\\w\\]])`, "g"),
        violation.canonical,
      );
    }
    return out;
  };
  const scanHashes = (piece) =>
    piece.replace(/(`?)\b([0-9a-f]{7,40})\b(`?)/g, (whole, open, hash, close) => {
      if (!/[a-f]/.test(hash) || open !== close) return whole;
      const resolved = resolveHash(ctx.clones, config, hash);
      if (!resolved.link) {
        findings.push({ token: hash, why: resolved.why });
        return whole;
      }
      if (!fix) {
        findings.push({ token: hash, why: `bare commit hash → ${resolved.link}` });
        return whole;
      }
      return resolved.link;
    });
  const out = text
    .split(/(```[\s\S]*?```)/)
    .map((block, fence) => {
      if (fence % 2) return block;
      return block
        .split(/(\[[^\]\n]*\]\([^()\s]*\))/)
        .map((part, link) => {
          if (link % 2) return part;
          return scanHashes(fix ? fixRefs(part) : part);
        })
        .join("");
    })
    .join("");
  return { text: out, findings, changed: out !== text };
}

/** Run every check advisorily against the draft. Returns the exit code. */
export function preflight(input, opts) {
  const ctx = context(input);
  ctx.preflight = true;
  const config = readShortcodes(ctx.root);
  const findings = [];
  if (opts.draft) {
    let draftText = fs.readFileSync(opts.draft, "utf8");
    if (config) {
      const linted = lintDraft(draftText, ctx, config, Boolean(opts.fix));
      findings.push(...linted.findings);
      if (opts.fix && linted.changed) {
        fs.writeFileSync(opts.draft, linted.text, "utf8");
        draftText = linted.text;
      }
    }
    ctx.assistantText = draftText;
  }
  const verdicts = CHECKS.map((entry) => ({ check: entry.check, ...entry.run(ctx) }));
  const failed = verdicts.filter((verdict) => verdict.verdict === "fail");
  for (const verdict of verdicts) {
    process.stdout.write(`${verdict.verdict.padEnd(12)} ${verdict.check} — ${verdict.detail}\n`);
  }
  for (const verdict of failed) {
    if (verdict.reason) process.stdout.write(`\n${verdict.check}:\n${verdict.reason}\n`);
  }
  for (const finding of findings) {
    process.stdout.write(`\ncommit-ref: ${finding.token} — ${finding.why}\n`);
  }
  logCompliance(
    ctx,
    verdicts.map(({ check, verdict, detail }) => ({ check, verdict, detail })),
    "preflight",
    failed[0]?.check ?? null,
  );
  return failed.length || findings.length ? 1 : 0;
}
