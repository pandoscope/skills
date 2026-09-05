// Reading positions out of a conversation transcript.
//
// The transcript is the only observer of where a turn began, how many
// messages preceded it, and what the principal will actually read. Pure
// and browser-safe: the caller supplies the text.

import { counter, stamp } from "./schema.mjs";

// ------------------------------------------------- transcript positions

/**
 * True for a message the principal actually typed.
 *
 * Tool results are recorded with `type: "user"` too and outnumber real
 * turns roughly six to one, so counting the type alone yields an index
 * that points nowhere in the conversation.
 */
export function isUserTurn(record) {
  if (record?.type !== "user") return false;
  const content = record.message?.content;
  if (typeof content === "string") return Boolean(content.trim());
  if (Array.isArray(content)) {
    return content.some((block) => block && typeof block === "object" && block.type === "text");
  }
  return false;
}


/**
 * The stamp of the newest user turn in `text` — where this turn began.
 *
 * Null when the transcript holds no user turn, so a caller distinguishes
 * "the turn started at T" from "there is no turn to bound".
 */
export function lastUserTurnAt(text) {
  let at = null;
  for (const line of String(text).split("\n")) {
    if (!line.trim()) continue;
    try {
      const record = JSON.parse(line);
      if (isUserTurn(record) && record.timestamp) at = record.timestamp;
    } catch {
      // A partial trailing line is not a turn.
    }
  }
  return at;
}


/**
 * User turns in `text`, the JSONL a transcript path holds.
 *
 * Takes the text rather than a path so this stays pure: the anchor
 * index, the heartbeat's turn boundary and the transcript renderer all
 * count the same way, and a second implementation would make one
 * reader's message 12 another reader's message 30.
 */
export function countUserTurns(text) {
  let count = 0;
  for (const line of String(text).split("\n")) {
    if (!line.trim()) continue;
    try {
      if (isUserTurn(JSON.parse(line))) count += 1;
    } catch {
      // A partial trailing line is not a turn.
    }
  }
  return count;
}


/**
 * What the transcript cost, and which model spent it.
 *
 * Cumulative across every assistant message, because each one is a
 * separate API call and each call is billed on its own — summing them
 * is the total, not a double count of one context.
 *
 * Deliberately raw. The interesting numbers are differences between two
 * points in time, but computing a difference at write time would
 * silently attribute one stretch of work to another the moment a
 * measurement point is missed; a monotone counter cannot. It also means
 * a change of mind about the metric does not invalidate what has
 * already been recorded.
 *
 * `model` is the newest one seen: a session can change model mid-run,
 * and what matters for a turn's verdict is who took that turn.
 */
export function transcriptUsage(text) {
  const total = { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 };
  let model = null;
  for (const line of String(text).split("\n")) {
    if (!line.trim()) continue;
    let record;
    try {
      record = JSON.parse(line);
    } catch {
      // A partial trailing line has no usage to count.
      continue;
    }
    if (record?.type !== "assistant") continue;
    const message = record.message ?? {};
    if (message.model) model = message.model;
    const usage = message.usage;
    if (!usage) continue;
    total.input += usage.input_tokens ?? 0;
    total.output += usage.output_tokens ?? 0;
    total.cacheRead += usage.cache_read_input_tokens ?? 0;
    total.cacheCreation += usage.cache_creation_input_tokens ?? 0;
  }
  return { model, ...total };
}


/**
 * The final assistant message's text in `text`, the transcript JSONL.
 *
 * The LAST message with a text block, not everything since the turn
 * began: the hygiene check reads what the principal will actually read,
 * and a correction written after a block has to be able to supersede
 * the message it corrects — scanning the whole turn would keep every
 * fixed mistake in view forever and the exercise could never pass.
 */
export function lastAssistantText(text) {
  let last = null;
  for (const line of String(text).split("\n")) {
    if (!line.trim()) continue;
    let record;
    try {
      record = JSON.parse(line);
    } catch {
      continue;
    }
    if (record?.type !== "assistant") continue;
    const content = record.message?.content;
    if (!Array.isArray(content)) continue;
    const blocks = content.filter((b) => b?.type === "text" && b.text?.trim());
    if (blocks.length) last = blocks.map((b) => b.text).join("\n");
  }
  return last;
}


/**
 * `text` with fenced blocks and inline code removed.
 *
 * Code is quoted material, not prose: commit messages, ledger events
 * and command lines legitimately carry `owner/repo#n` and bare `#n`,
 * and a style check that reached into them would demand rewrites of
 * strings whose format is owned elsewhere.
 */
export function stripCode(text) {
  return String(text)
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`[^`\n]*`/g, " ");
}


/**
 * When a grilling was last invoked in the transcript, or null.
 *
 * Both invocation shapes count: the typed slash command (a user turn
 * carrying its `<command-name>`) and the Skill tool call. The stamp is
 * the LAST invocation — a session that grills twice owes records for
 * the later round too.
 */
export function grillingInvokedAt(text) {
  let at = null;
  for (const line of String(text).split("\n")) {
    if (!line.trim() || !line.includes("grill")) continue;
    let record;
    try {
      record = JSON.parse(line);
    } catch {
      continue;
    }
    const content = record?.message?.content;
    if (record?.type === "user") {
      const texts =
        typeof content === "string"
          ? [content]
          : Array.isArray(content)
            ? content.filter((b) => b?.type === "text").map((b) => b.text ?? "")
            : [];
      if (texts.some((t) => /<command-name>\/[\w-]*grill[\w-]*<\/command-name>/.test(t))) {
        at = record.timestamp ?? at;
      }
      continue;
    }
    if (record?.type !== "assistant" || !Array.isArray(content)) continue;
    for (const block of content) {
      if (block?.type !== "tool_use" || block.name !== "Skill") continue;
      if (/grill/.test(String(block.input?.skill ?? ""))) at = record.timestamp ?? at;
    }
  }
  return at;
}


// Tool calls that post a body the tracker renders. The name's tail is
// what the forge MCP tools share across servers; the fields are the
// ones those tools carry a rendered body in.
const TRACKER_WRITE =
  /(create_pull_request|update_pull_request|issue_write|add_issue_comment|add_reply_to_pull_request_comment|pull_request_review_write|create_issue)$/;

/**
 * Every tracker body the transcript shows posted since `since`.
 *
 * One entry per tool call carrying a body, with what the workflow
 * checks read off it: the tool, the repo, the body text and — for a PR
 * opened this turn — the head branch whose tickets the body owes.
 *
 * @param {string} text the transcript, one JSON record per line
 * @param {string|null} since ISO stamp; records before it are skipped
 * @returns {{tool: string, at: string|null, repo: string|null, body: string, head: string|null}[]}
 */
export function trackerWrites(text, since) {
  const boundary = since ? new Date(since).getTime() : null;
  const posted = [];
  for (const line of String(text).split("\n")) {
    if (!line.trim()) continue;
    let record;
    try {
      record = JSON.parse(line);
    } catch {
      continue;
    }
    if (record?.type !== "assistant") continue;
    if (boundary && record.timestamp && new Date(record.timestamp).getTime() < boundary) {
      continue;
    }
    const content = record.message?.content;
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      if (block?.type !== "tool_use" || !TRACKER_WRITE.test(block.name ?? "")) continue;
      const input = block.input ?? {};
      const body = input.body ?? input.text ?? null;
      if (typeof body !== "string") continue;
      const tool = String(block.name).replace(/^.*__/, "");
      posted.push({
        tool,
        at: record.timestamp ?? null,
        repo: input.owner && input.repo ? `${input.owner}/${input.repo}` : null,
        body,
        head: tool === "create_pull_request" && typeof input.head === "string" ? input.head : null,
      });
    }
  }
  return posted;
}
