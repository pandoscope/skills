// The check over the response the principal will actually read.
//
// The only check whose subject is the prose rather than the work: the
// reference style, the thread naming and the footer contract are what
// make a turn's output legible to the next reader. Header contract:
// `../heartbeat.mjs`.

import fs from "node:fs";
import path from "node:path";

import { OPENING, knownPrs, refViolations, stripCode } from "../core.mjs";
import { observedThreads } from "../context.mjs";
import { localFile } from "../paths.mjs";

/**
 * Check 6 — the response follows the reference style, and a corrected
 * response actually contains its corrections (#99).
 *
 * The style: tickets and PRs in prose are linked shortcode refs
 * (`XXX#n` tickets, `XXX!n` PRs), a thread opened this turn is
 * announced as `new thread: <slug>`, and every thread the summary
 * declares is named in the prose that discusses it. Code spans are
 * quoted material and exempt.
 *
 * The exercise is the point: a block names the canonical forms and the
 * re-fire requires them PRESENT in the rewritten response — deleting
 * the offending refs silences the scanner while learning nothing, so
 * deletion does not pass. Pending expectations live in a state file
 * keyed by session and message; a stale key is dropped unread, because
 * holding one turn to another turn's homework grades the wrong student.
 */
export function checkResponseHygiene(ctx) {
  if (!ctx.turnStart) {
    return { verdict: "unconfigured", detail: "no turn boundary to measure against" };
  }
  const mapFile = path.join(ctx.root, "config", "shortcodes.json");
  let shortcodes = null;
  try {
    shortcodes = JSON.parse(fs.readFileSync(mapFile, "utf8"));
  } catch {
    // Absent and unreadable land together: either way no map was
    // consulted, and "never looked" must not read as "clean".
    return {
      verdict: "unconfigured",
      detail: `no shortcode map at ${mapFile} — the response was not examined`,
    };
  }
  const response = ctx.assistantText ?? "";
  if (!response.trim()) {
    return { verdict: "pass", detail: "no response text to examine" };
  }
  const prose = stripCode(response);
  const violations = refViolations(prose, shortcodes, knownPrs(ctx.events));

  // Threads owed a name in prose: announced when opened this turn,
  // stated when observed with an event this turn (skills#153 — the
  // observation replaced the declaration). Matching is on the raw
  // response — backticks around a slug are style, not evasion.
  const start = ctx.turnStart.getTime();
  const openedNow = ctx.events
    .filter((event) => event.anchor?.session === ctx.session)
    .filter((event) => event.at && new Date(event.at).getTime() >= start)
    .filter((event) => OPENING.includes(event.ev))
    .map((event) => event.thread);
  const naming = [];
  for (const slug of new Set(openedNow)) {
    if (!new RegExp(`new thread:\\s*\`?${slug}\`?`, "i").test(response)) {
      naming.push({ slug, expected: `new thread: ${slug}` });
    }
  }
  for (const slug of observedThreads(ctx)) {
    if (openedNow.includes(slug)) continue;
    if (!response.includes(slug)) naming.push({ slug, expected: slug });
  }

  // Preflight reports and repairs notation; the correction exercise is
  // the Stop hook's pedagogy. A preflight that assigned or graded
  // homework would turn the linter into the gate it is explicitly not.
  if (ctx.preflight) {
    if (!violations.length && !naming.length) {
      return { verdict: "pass", detail: "response follows the reference style" };
    }
    return {
      verdict: "fail",
      detail: `${violations.length + naming.length} style violations in the draft`,
      reason: [
        ...violations.map((v) => `  ${v.token} — ${v.why}${v.canonical ? ` → ${v.canonical}` : ""}`),
        ...naming.map((n) => `  ${n.slug} — write: ${n.expected}`),
      ].join("\n"),
    };
  }

  // The pending exercise, before any new homework is assigned.
  const pendingFile = localFile("hygiene-corrections.json");
  let pending = null;
  try {
    pending = JSON.parse(fs.readFileSync(pendingFile, "utf8"));
  } catch {
    pending = null;
  }
  if (pending && (pending.session !== ctx.session || pending.msg !== ctx.msg)) {
    fs.rmSync(pendingFile, { force: true });
    pending = null;
  }
  if (pending) {
    const absent = (pending.expected ?? []).filter((s) => !response.includes(s));
    if (!absent.length && !violations.length && !naming.length) {
      fs.rmSync(pendingFile, { force: true });
      return { verdict: "pass", detail: "correction exercise completed" };
    }
    if (absent.length) {
      return {
        verdict: "fail",
        detail: `${absent.length} assigned corrections missing from the response`,
        reason: [
          "The turn is not complete until the corrected forms appear in the " +
            "response — removing the wrong refs is not writing the right " +
            "ones. Still missing, verbatim:",
          "",
          ...absent.map((s) => `  ${s}`),
        ].join("\n"),
      };
    }
  }

  if (!violations.length && !naming.length) {
    return { verdict: "pass", detail: "response follows the reference style" };
  }

  // New homework: every derivable canonical form, assigned and stored
  // so the re-fire can hold the rewrite to it.
  const expected = [
    ...violations.filter((v) => v.canonical).map((v) => v.canonical),
    ...naming.map((n) => n.expected),
  ];
  fs.mkdirSync(path.dirname(pendingFile), { recursive: true });
  fs.writeFileSync(
    pendingFile,
    JSON.stringify({ session: ctx.session, msg: ctx.msg, expected }, null, 2),
    "utf8",
  );
  const lines = [
    ...violations.map((v) => `  ${v.token} — ${v.why}${v.canonical ? ` → ${v.canonical}` : ""}`),
    ...naming.map((n) =>
      n.expected.startsWith("new thread:")
        ? `  ${n.slug} — opened this turn and never announced → write: ${n.expected}`
        : `  ${n.slug} — declared but never named in the response → state it by name`,
    ),
  ];
  return {
    verdict: "fail",
    detail: `${violations.length + naming.length} style violations in the response`,
    reason: [
      "The turn is not complete until the response follows the reference " +
        "style: linked shortcode refs (XXX#n tickets, XXX!n PRs), threads " +
        "named in prose. Rewrite your response and write each correction " +
        "out in full — the corrected forms must appear, verbatim:",
      "",
      ...lines,
    ].join("\n"),
  };
}
