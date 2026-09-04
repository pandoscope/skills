// Checks over what the session was already told.
//
// Both read state the hook itself wrote on an earlier turn, so a
// reminder that went unheard is visible rather than repeated forever.
// Header contract: `../heartbeat.mjs`.

import fs from "node:fs";
import path from "node:path";

import { localFile } from "../paths.mjs";

/**
 * Check 10 — completed work with a PR leaves a kata behind. Remind-once.
 *
 * The trigger is mechanical (a `completed` event carrying `--pr`
 * landed this turn); the adequacy of a kata is not, and a hook that
 * pretended otherwise would block on a judgement it cannot make. So
 * this check reminds exactly once per thread — the fresh-incident
 * moment is when a kata is cheap to write — and afterwards records
 * only the claim. The delivered set is hook-owned local state, keyed
 * by session and thread.
 */
export function checkKataReminder(ctx) {
  if (!ctx.turnStart) {
    return { verdict: "unconfigured", detail: "no turn boundary to measure against" };
  }
  const start = ctx.turnStart.getTime();
  const finished = ctx.events
    .filter((event) => event.anchor?.session === ctx.session || event.by)
    .filter((event) => event.at && new Date(event.at).getTime() >= start)
    .filter((event) => event.ev === "completed" && event.pr);
  if (!finished.length) {
    return { verdict: "pass", detail: "nothing completed with a PR this turn" };
  }
  const file = localFile("kata-reminders.json");
  let delivered = {};
  try {
    delivered = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    delivered = {};
  }
  const fresh = finished.filter((event) => !delivered[`${ctx.session}/${event.thread}`]);
  if (!fresh.length) {
    return {
      verdict: "pass",
      detail: `kata reminder already delivered for ${finished
        .map((event) => event.thread)
        .join(", ")} — adequacy stays a claim`,
    };
  }
  // Marked delivered at FIRING: remind-once means once, whatever the
  // model does with it — a reminder that re-fires until obeyed is a
  // blocking check wearing a softer name.
  for (const event of fresh) delivered[`${ctx.session}/${event.thread}`] = event.pr;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(delivered, null, 2), "utf8");
  const [first] = fresh;
  return {
    verdict: "fail",
    detail: `completed with a PR and no kata prompt yet: ${fresh
      .map((event) => event.thread)
      .join(", ")}`,
    reason: [
      `${first.thread} completed with ${first.pr} this turn. A kata ` +
        "freezes the incident while it is fresh — the corpus is this " +
        "org's own failure catalogue, and a case not written down now " +
        "is reconstructed later or lost. Write the kata, or note in the " +
        "thread why none is owed. This reminder fires once and will not " +
        "block again.",
    ].join("\n"),
  };
}

/**
 * Check 11 — a question-shaped close is a blocked thread. Observe-only.
 *
 * The detector is imperfect by admission: a final message ending in a
 * question USUALLY means the turn is waiting on the principal, and a
 * wait not captured as a `blocked` event is invisible to the next
 * session. Imperfect detectors do not block (ruling A2) — this one
 * logs what it sees, and the compliance data decides whether it ever
 * earns a voice.
 */
export function checkBlockedCaptured(ctx) {
  if (!ctx.turnStart) {
    return { verdict: "unconfigured", detail: "no turn boundary to measure against" };
  }
  const text = (ctx.assistantText ?? "").trimEnd();
  if (!text.endsWith("?")) {
    return { verdict: "pass", detail: "the close is not question-shaped" };
  }
  const start = ctx.turnStart.getTime();
  const blocked = ctx.events
    .filter((event) => event.anchor?.session === ctx.session)
    .filter((event) => event.at && new Date(event.at).getTime() >= start)
    .some((event) => event.ev === "blocked");
  return {
    verdict: "pass",
    detail: blocked
      ? "question-shaped close and a blocked event captured"
      : "question-shaped close and no blocked event — observing, not blocking",
  };
}
