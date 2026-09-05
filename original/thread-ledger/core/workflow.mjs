// Workflow classifiers — pure judgements over a branch name, a commit
// header, a tracker body.
//
// The rules are the org's own gates, read from each repo's
// `.github/reference-keywords.json` where they are data (the branch
// pattern, the canonical keywords, the forge's native ones) and from
// commitlint's config-conventional where they are fixed. Every
// classifier is measured against tests/original/reminder-heartbeat/
// test_forms.mjs, the forms its rule accepts, BEFORE it may refuse:
// the driver lab refused correct work three times over spellings the
// rule text allowed (skills#192, F7).
//
// Pure and browser-safe: no filesystem, no process. The caller reads
// the state; this module says what is wrong with it.

// ---------------------------------------------------------------- branch

/**
 * Why `branch` does not fit the ticket pattern, or null when it does.
 *
 * `pattern` is the keyword file's `branch_pattern`: a prefix whose
 * first group captures the dash-joined ticket tokens, each an optional
 * lowercase shortcode followed by the ticket number. A description
 * must follow the last token, so `claude/42` alone is not a branch.
 *
 * @param {string} branch the current branch name, or `HEAD` when detached
 * @param {string} pattern the keyword file's `branch_pattern`
 * @returns {string|null} the violation, or null when the branch fits
 */
export function branchViolation(branch, pattern) {
  const named = new RegExp(`^${pattern}`).exec(branch ?? "");
  if (!named) {
    return `\`${branch || "(detached)"}\` does not match \`claude/<code><ticket>[-<code><ticket>…]-<desc>\``;
  }
  const rest = branch.slice(named[0].length);
  if (!/^[a-z0-9][a-z0-9-]*$/.test(rest)) {
    return `\`${branch}\` carries no description after its ticket tokens`;
  }
  return null;
}

/**
 * The ticket numbers a pattern branch names, in branch order.
 *
 * The trailing digit run of every token: `sk130` and `130` both name
 * ticket 130. A branch outside the pattern names nothing.
 *
 * @param {string} branch the branch name
 * @param {string} pattern the keyword file's `branch_pattern`
 * @returns {string[]} ticket numbers as written
 */
export function branchTickets(branch, pattern) {
  const named = new RegExp(`^${pattern}`).exec(branch ?? "");
  if (!named) return [];
  return named[1]
    .split("-")
    .map((token) => /(\d+)$/.exec(token)?.[1])
    .filter(Boolean);
}

// --------------------------------------------------------------- headers

// config-conventional's type enum, the allow-list commitlint applies.
const TYPES = "build|chore|ci|docs|feat|fix|perf|refactor|revert|style|test";
const CONVENTIONAL = new RegExp(`^(${TYPES})(\\([^)]*\\))?!?: \\S`);

/**
 * Why a commit header fails the working-branch grammar, or null.
 *
 * Conventional headers pass. `fixup!` and `squash!` pass because they
 * are the fold mechanism the branch rules prescribe, and a git-made
 * `Revert "…"` passes because commitlint ignores it by configuration.
 * A `Merge` header on a working branch is the violation the linear
 * history rule names: working branches rebase, never merge in.
 *
 * @param {string} header the commit's subject line
 * @returns {string|null} the violation, or null when the header passes
 */
export function headerViolation(header) {
  const line = String(header ?? "");
  if (/^Merge\b/.test(line)) return `\`${line}\` is a merge commit on a working branch`;
  if (/^(fixup|squash)! /.test(line)) return null;
  if (/^Revert "/.test(line)) return null;
  if (CONVENTIONAL.test(line)) return null;
  return `\`${line}\` is not a conventional header (\`<type>(<scope>)?: <subject>\`)`;
}

// ---------------------------------------------------------------- bodies

// HTML the tracker renders rather than strips: a tag from this list is
// markup, anything else in angle brackets is a placeholder the API
// swallows on programmatic reads and edits.
const HTML_TAGS = new Set([
  "a", "b", "blockquote", "br", "code", "dd", "del", "details", "div", "dl", "dt", "em",
  "h1", "h2", "h3", "h4", "h5", "h6", "hr", "i", "img", "ins", "kbd", "li", "ol", "p",
  "pre", "s", "samp", "small", "span", "strong", "sub", "summary", "sup", "table",
  "tbody", "td", "tfoot", "th", "thead", "tr", "ul", "var",
]);

// A line the renderer already breaks on its own: list items, headings,
// tables, quotes, fences, HTML and blank lines never form a wrapped
// paragraph with their neighbours.
const NOT_PROSE = /^(\s*[-*+]\s|\s*\d+[.)]\s|#|\||>|\s*<|```|~~~)/;

/**
 * Everything wrong with a body a tracker would render.
 *
 * Four kinds, each with the evidence a reader can find in the body:
 *
 *   native-keyword    a forge closing keyword in a casing the gate does
 *                     not recognise, followed by a ticket ref — the
 *                     forge would act on it either way
 *   angle-placeholder `<word>` outside a code span that is not an HTML
 *                     tag — stripped as markup on programmatic reads
 *   hard-wrap         a run of prose lines outside a fence broken
 *                     mid-sentence, or three lines long — a wrap the
 *                     renderer breaks at random
 *   missing-ticket    a ticket the branch names that no canonical
 *                     keyword references (only when `tickets` is given)
 *
 * @param {string} body the tracker body as posted
 * @param {{allowed: object, github_native: string[]}} keywords the keyword file
 * @param {string[]} [tickets] ticket numbers the PR's branch names
 * @returns {{kind: string, evidence: string}[]} violations, in body order
 */
export function bodyViolations(body, keywords, tickets = []) {
  const found = [];
  const text = String(body ?? "");
  const allowed = Object.keys(keywords.allowed ?? {});
  const native = new Set((keywords.github_native ?? []).map((word) => word.toLowerCase()));
  const ref = "(?:[\\w.-]+\\/[\\w.-]+)?#\\d+";
  const prose = stripFences(text);

  for (const match of prose.matchAll(new RegExp(`\\b([A-Za-z]+) (${ref})`, "g"))) {
    const [whole, word] = match;
    if (allowed.includes(word)) continue;
    if (native.has(word.toLowerCase()) || allowed.includes(word.toUpperCase())) {
      found.push({ kind: "native-keyword", evidence: whole });
    }
  }

  for (const match of stripCodeSpans(prose).matchAll(/<([a-z][a-z0-9-]*)>/g)) {
    if (HTML_TAGS.has(match[1])) continue;
    found.push({ kind: "angle-placeholder", evidence: match[0] });
  }

  for (const paragraph of wrappedParagraphs(text)) {
    found.push({ kind: "hard-wrap", evidence: paragraph });
  }

  if (tickets.length && allowed.length) {
    const named = new Set();
    const canonical = new RegExp(`\\b(?:${allowed.join("|")}) (?:[\\w.-]+\\/[\\w.-]+)?#(\\d+)`, "g");
    for (const match of prose.matchAll(canonical)) named.add(match[1]);
    for (const ticket of tickets) {
      if (!named.has(ticket)) found.push({ kind: "missing-ticket", evidence: `#${ticket}` });
    }
  }
  return found;
}

/** The body with fenced blocks blanked, line count preserved. */
function stripFences(text) {
  const out = [];
  let fenced = false;
  for (const line of text.split("\n")) {
    if (/^\s*(```|~~~)/.test(line)) {
      fenced = !fenced;
      out.push("");
      continue;
    }
    out.push(fenced ? "" : line);
  }
  return out.join("\n");
}

/** Inline code blanked, so a quoted placeholder is not a finding. */
function stripCodeSpans(text) {
  return text.replace(/`[^`\n]*`/g, " ");
}

/**
 * The first line of every hard-wrapped paragraph in `text`.
 *
 * A run of consecutive prose lines outside a fence is wrapped when a
 * line boundary inside it falls mid-sentence — no terminal punctuation
 * before it, a lowercase letter after it — or when the run is three
 * lines or longer, which is a paragraph whatever its punctuation. Two
 * complete lines in a row (two keyword references, say) are what the
 * rule's "one paragraph per line" permits. List items, headings,
 * tables, quotes and HTML are the renderer's own line breaks and never
 * count.
 */
function wrappedParagraphs(text) {
  const wrapped = [];
  let run = [];
  const midSentence = (before, after) =>
    !/[.!?:;,)]$/.test(before.trim()) && /^[a-z]/.test(after.trim());
  const flush = () => {
    const broken = run.some((line, at) => at > 0 && midSentence(run[at - 1], line));
    if (run.length >= 3 || (run.length === 2 && broken)) wrapped.push(run[0].trim());
    run = [];
  };
  for (const line of stripFences(text).split("\n")) {
    if (line.trim() && !NOT_PROSE.test(line)) run.push(line);
    else flush();
  }
  flush();
  return wrapped;
}
