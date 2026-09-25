// The review-session policy — what a review session may call,
// and what its findings file must look like.
//
// Pure functions over the hook's inputs,
// so the katas can assert on verdicts without staging a session.
// The entry point that reads stdin, logs and exits is `../review-driver.mjs`.
//
// The policy is an ALLOWLIST.
// The driver lab (skills#130) measured that a refusal naming the unmet criterion is followed,
// and that a check followed must not be wrong;
// X8 (skills#41) measured that the smallest tier runs code when told in prose not to.
// A denylist of the ways to run code is a list the next detour is not on,
// so what is allowed is enumerated and everything else is refused with the rule.

/**
 * @typedef {object} ReviewRun
 * @property {string} pass       the review pass, e.g. spec-fidelity
 * @property {string} modelTier  the model tier the routine runs
 * @property {string} dir        the review directory, relative to the clone
 * @property {string} findings   the findings file, relative to the clone
 * @property {RegExp} branch     the review branch, capturing the PR number
 * @property {string} branchForm the branch as the reason spells it
 */
/** @typedef {{ allow: true } | { allow: false, why: string }} Verdict */

// ------------------------------------------------------------- order

// The order that fired the session, read as a review run
// (SKILL.md, "Review sessions").
const NAME = /^[a-z0-9-]+$/;

/**
 * @param {string} pass
 * @param {string} modelTier
 * @returns {ReviewRun}
 */
function runFor(pass, modelTier) {
  return {
    pass,
    modelTier,
    // Relative to the clone of the reviewed repository — the only directory the session may write,
    // and the one the collector reads.
    dir: `reviews/${pass}-${modelTier}`,
    findings: `reviews/${pass}-${modelTier}/findings.json`,
    branch: new RegExp(`^claude/review-${pass}-${modelTier}-pr(\\d+)$`),
    branchForm: `claude/review-${pass}-${modelTier}-pr<n>`,
  };
}

/**
 * The review run a waybill order declares, or null:
 * the order names `role: reviewer` with its `pass` and `model_tier`.
 * @param {string} orderText the order file, YAML
 * @returns {ReviewRun | null}
 */
export function orderRun(orderText) {
  /** @param {string} key */
  const field = (key) => {
    const m = new RegExp(`^${key}:[ \\t]*(.*)$`, "m").exec(orderText);
    return m ? m[1].replace(/\s+#.*$/, "").trim().replace(/^["']|["']$/g, "") : "";
  };
  const pass = field("pass");
  const modelTier = field("model_tier");
  if (field("role") !== "reviewer" || !NAME.test(pass) || !NAME.test(modelTier)) return null;
  return runFor(pass, modelTier);
}

// ------------------------------------------------------------- tools

const ALLOWED_TOOLS = new Set([
  "Read",
  "Glob",
  "Grep",
  "LS",
  "WebFetch",
  "WebSearch",
  "ToolSearch",
  "TaskCreate",
  "TaskUpdate",
  "TaskList",
  "TaskGet",
  "TodoWrite",
  "Skill",
  "ListSkills",
  "ReadNotifications",
  "AskUserQuestion",
]);

// A subagent is a hole in the allowlist, not a tool on it:
// nothing holds its calls to the read-only policy.
// The first real opus review found this (skills#195).
const SUBAGENTS = new Set(["Agent", "Task"]);

const FORGE_READ = /^mcp__github__(get_|list_|search_|pull_request_read$|issue_read$)/;
const EDITORS = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit"]);

/**
 * Verdict on one tool call: `{ allow: true }` or `{ allow: false, why }`.
 *
 * `why` is the reason the model reads.
 * It names the rule and the allowed alternative,
 * never a bare "denied" — a refusal without the criterion is what a model routes around.
 * @param {string} name
 * @param {Record<string, any> | undefined} input
 * @param {ReviewRun} run
 * @returns {Verdict}
 */
export function toolVerdict(name, input, run) {
  const target = input?.file_path ?? input?.path ?? input?.pattern ?? "";
  if (typeof target === "string" && target && namesSecret(target)) {
    return {
      allow: false,
      why: `${name} on ${target}: that path holds the session's own secrets. A review reads the repository, not the environment.`,
    };
  }
  if (SUBAGENTS.has(name)) {
    return {
      allow: false,
      why:
        `${name} spawns a session of its own that this review's policy does not reach, so ` +
        "nothing in it is read-only: it could run the code this review may not run. Read the change " +
        "yourself with Read, Grep and Glob.",
    };
  }
  if (ALLOWED_TOOLS.has(name) || FORGE_READ.test(name)) return { allow: true };
  if (EDITORS.has(name)) {
    const file = input?.file_path ?? input?.notebook_path ?? "";
    if (file.endsWith(`/${run.findings}`) || file === run.findings) return { allow: true };
    return {
      allow: false,
      why:
        `${name} on ${file || "(no path)"} is not allowed in a review session. ` +
        `The only file a review writes is ${run.findings} in the clone of the reviewed repository.`,
    };
  }
  if (name === "Bash") return bashVerdict(input?.command ?? "", run);
  if (/^mcp__github__/.test(name)) {
    return {
      allow: false,
      why:
        `${name} writes to the forge. A review session posts nothing: no comments, no reviews, ` +
        `no issues, no pull requests. Findings go to ${run.findings} and are pushed on ${run.branchForm}.`,
    };
  }
  return {
    allow: false,
    why: `${name} is not on the review session's tool list. Read the code with Read, Grep, Glob and read-only Bash; write only ${run.findings}.`,
  };
}

// -------------------------------------------------------------- bash

// What a reader runs.
// A command that can execute a program or edit in place is absent,
// or passes only the argument guards in bashVerdict.
// `env` and `printenv` are absent: they would print the session's tokens into a transcript.
const READ_COMMANDS = new Set([
  "cat", "head", "tail", "sed", "grep", "rg", "egrep", "fgrep", "find", "ls", "wc", "awk", "sort",
  "uniq", "cut", "tr", "diff", "tree", "stat", "file", "jq", "echo", "printf", "true", "false",
  "test", "[", "[[", "cd", "pwd", "which", "type", "basename", "dirname", "realpath", "readlink",
  "date", "column", "nl", "comm", "paste", "md5sum", "sha256sum", "expr", "seq", "tac", "rev",
  "fold", "fmt", "strings", "od", "hexdump", "xxd", "du", "df",
]);

// Where the session's own secrets live.
// `env` is denied above;
// these are the files that hold the same values,
// and reading them into a transcript is the same leak by another command.
// A repo's own `.claude/` directory is not matched — that is reviewable content.
const SECRET_PATH = /\/proc\/[^\s'"]*\/environ\b|\bsession\.env\b|(?:~|\$HOME|\$\{HOME\}|\/root|\/home\/[^/\s]+)\/\.claude\/|(?:^|[\s/'"])\.env(?:\.[\w-]+)?(?=$|[\s'"])/;

// The harness persists a large tool result to a file under the config directory
// and hands back its path;
// reading it is how the session gets the content it just asked for.
// Measured on the first haiku run (skills#195):
// the rule above refused one of those,
// the review carried on from a truncated `head -200` of the diff and reported nothing.
// A check that is followed must not be wrong (skills#130),
// so the one readable subtree is carved out —
// transcripts and the config files themselves stay refused.
const HARNESS_CONTENT = /\/\.claude\/projects\/[^\s'"]*\/tool-results\//;

/** @param {string} text @returns {boolean} */
export function namesSecret(text) {
  if (HARNESS_CONTENT.test(text)) return false;
  return SECRET_PATH.test(text);
}

const GIT_READ = new Set([
  "diff", "log", "show", "fetch", "ls-files", "ls-tree", "ls-remote", "grep", "cat-file",
  "rev-parse", "status", "merge-base", "blame", "name-rev", "describe", "rev-list", "shortlog",
  "diff-tree", "for-each-ref", "show-ref", "check-ignore", "var", "count-objects", "branch",
  "remote", "config", "worktree", "version", "help",
]);

// Sub-flags that turn a read subcommand into a write.
/** @type {Record<string, RegExp>} */
const GIT_WRITE_FLAGS = {
  branch: /^-(m|M|d|D|c|C|f|-move|-copy|-delete|-force|-set-upstream-to|u)$|^--(edit-description|unset-upstream)$/,
  remote: /^(add|remove|rm|rename|set-url|set-head|set-branches|prune|update)$/,
  config: /^(--unset|--unset-all|--add|--replace-all|--edit|-e|--rename-section|--remove-section)$/,
  worktree: /^(add|remove|prune|move|lock|unlock|repair)$/,
  fetch: /^(--prune|-p|--prune-tags|-P)$/,
};

/**
 * Verdict on a Bash command under the read-only policy.
 * @param {string} command
 * @param {ReviewRun} run
 * @returns {Verdict}
 */
export function bashVerdict(command, run) {
  /** @param {string} why @returns {Verdict} */
  const deny = (why) => ({ allow: false, why: `Bash \`${trim(command)}\`: ${why}` });
  if (namesSecret(command)) {
    return deny("that path holds the session's own secrets. A review reads the repository, not the environment.");
  }
  const body = stripHeredocs(command);
  const redirect = findRedirect(body);
  if (redirect) return deny(`\`${redirect}\` writes a file. A review session redirects to /dev/null only.`);
  /** @type {string[]} */
  const quoted = [];
  for (const segment of segments(body, quoted)) {
    const marked = tokens(segment, quoted);
    if (!marked.length) continue;
    const [cmd, ...args] = marked.map((w) => blankQuoted(w, quoted));
    // sed and awk read their script from a quoted argument.
    const script = marked.slice(1).map((w) => unquote(w, quoted));
    if (cmd === "git") {
      const why = gitWhy(args, run);
      if (why) return deny(why);
      continue;
    }
    if (!READ_COMMANDS.has(cmd)) {
      return deny(
        `\`${cmd}\` is not a read command. A ${run.pass} review reads the code and does not run it: ` +
          "no python, node, test runner, shell script or pipeline that executes.",
      );
    }
    if (cmd === "sed" && args.some((a) => /^-i/.test(a) || a === "--in-place")) {
      return deny("`sed -i` edits in place. Read with sed; write only the findings file.");
    }
    if (cmd === "sed") {
      const why = sedWhy(script);
      if (why) return deny(why);
    }
    if (cmd === "find" && args.some((a) => /^-(exec|execdir|ok|okdir|delete|fprint|fls)/.test(a))) {
      return deny("`find` with -exec, -ok or -delete executes or removes. List only.");
    }
    if (cmd === "awk" && script.some((a) => /system\s*\(|\|\s*"|"\s*\|(?!\|)|\|&|>\s*"/.test(a))) {
      return deny("`awk` with system() or a pipe executes, and one with an output redirect writes. Print only.");
    }
  }
  return { allow: true };
}

/**
 * @param {string[]} args
 * @param {ReviewRun} run
 * @returns {string | null}
 */
function gitWhy(args, run) {
  const a = [...args];
  while (a.length && /^-/.test(a[0])) {
    if (a[0] === "-C") {
      a.splice(0, 2);
      continue;
    }
    if (a[0] === "-c" || /^--git-dir|^--work-tree|^--exec-path/.test(a[0])) {
      return "`git -c` and repository overrides change how git behaves; call git plainly.";
    }
    a.shift();
  }
  const [sub, ...rest] = a;
  if (!sub) return null;
  const nonFlags = rest.filter((x) => !x.startsWith("-"));
  if (GIT_READ.has(sub)) {
    const write = GIT_WRITE_FLAGS[sub];
    if (write && rest.some((x) => write.test(x))) {
      return `\`git ${sub} ${rest.join(" ")}\` writes. Read subcommands only, plus the findings commit and push.`;
    }
    if (sub === "fetch" && rest.some((x) => /^--(force|refmap)$|^-f$|^\+/.test(x))) {
      return "`git fetch` with --force or a + refspec overwrites refs. Fetch plainly.";
    }
    return null;
  }
  // Bare `git stash` is a push and `git tag <name>` creates one:
  // the read forms are the listing ones, and only those pass.
  if (sub === "stash") {
    if (rest[0] === "list" || rest[0] === "show") return null;
    return "`git stash` writes the working tree; `git stash list` and `git stash show` are the read forms.";
  }
  if (sub === "tag") {
    if (!nonFlags.length || rest.some((x) => x === "-l" || x === "--list")) return null;
    return "`git tag <name>` creates a tag; `git tag` and `git tag -l` are the read forms.";
  }
  if (sub === "switch" || sub === "checkout") {
    const flag = rest.findIndex((x) => x === "-c" || x === "-b" || x === "--create");
    if (flag > -1 && run.branch.test(rest[flag + 1] ?? "")) return null;
    return (
      `\`git ${sub}\` may only create the review branch: git switch -c ${run.branchForm}. ` +
      "The clone stays at the checkout the session started on otherwise."
    );
  }
  if (sub === "add") {
    if (nonFlags.length && nonFlags.every((p) => insideReviewDir(p, run))) return null;
    return `\`git add\` may only stage ${run.dir}/. Nothing else in the clone changes.`;
  }
  if (sub === "commit") {
    if (rest.some((x) => /^--amend|^-a$|^--all$|^--no-verify|^-n$/.test(x))) {
      return "`git commit` without --amend, -a or --no-verify: commit what `git add` staged.";
    }
    return null;
  }
  if (sub === "push") {
    if (rest.some((x) => /^-f$|^--force|^--delete|^-d$|^--mirror|^--all$|:/.test(x))) {
      return "`git push` without --force, --delete or a refspec: push the review branch only.";
    }
    const named = nonFlags.filter((x) => x !== "origin");
    if (named.length && named.every((b) => run.branch.test(b))) return null;
    return `\`git push\` names the review branch: git push -u origin ${run.branchForm}.`;
  }
  return `\`git ${sub}\` is not a read subcommand. Allowed: ${[...GIT_READ].slice(0, 8).join(", ")}, …, plus switch -c, add, commit and push for the findings.`;
}

/**
 * Whether a path is the review directory or lies inside it — by path segment,
 * so `reviews/<pass>-<model_tier>-other/x` is outside.
 * @param {string} p
 * @param {ReviewRun} run
 */
function insideReviewDir(p, run) {
  const clean = p.replace(/^\.\//, "").replace(/\/+$/, "");
  return clean === run.dir || clean.startsWith(`${run.dir}/`) || clean.endsWith(`/${run.dir}`) || clean.includes(`/${run.dir}/`);
}

// ----------------------------------------------------------- parsing

/** @param {string} cmd @returns {string} */
function stripHeredocs(cmd) {
  // A heredoc body is data, not commands — unless it feeds a program,
  // and the program is judged by its own first word.
  // The opener line survives: a redirect after the tag is still a write.
  return cmd.replace(/<<-?\s*'?(\w+)'?([^\n]*)\n[\s\S]*?\n\1\s*(?=\n|$)/g, "<<HEREDOC$2");
}

/** @param {string} body @returns {string | null} */
function findRedirect(body) {
  const text = dropQuoted(body);
  const re = /(\d?)(>>?|&>)(&?)\s*(\S*)/g;
  let m;
  while ((m = re.exec(text))) {
    const [, , op, amp, target] = m;
    if (amp) continue; // 2>&1, >&2
    if (op === "&>") return `${op}${target}`;
    if (target === "/dev/null") continue;
    return `${op} ${target}`.trim();
  }
  return null;
}

// sed's read forms:
// line and pattern ranges with p, d, q, = or l,
// and s/// without the e and w flags.
const SED_ADDR = String.raw`(?:\d+|\$|/(?:[^/\\]|\\.)*/)`;
const SED_CMD =
  String.raw`\s*(?:${SED_ADDR}(?:\s*,\s*${SED_ADDR})?)?\s*!?\s*` +
  String.raw`(?:[pdq=l]|s/(?:[^/\\]|\\.)*/(?:[^/\\]|\\.)*/[gpiIm0-9]*)\s*`;
const SED_SCRIPT = new RegExp(`^${SED_CMD}(?:;${SED_CMD})*;?$`);

/**
 * Why a sed call leaves the read forms, or null when it stays in them.
 * @param {string[]} args the arguments with quotes removed
 * @returns {string | null}
 */
function sedWhy(args) {
  /** @type {string[]} */
  const scripts = [];
  let explicit = false;
  let first = null;
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i];
    if (a === "-f" || a.startsWith("--file")) {
      return "`sed -f` runs a script this policy cannot read. Pass the script inline.";
    }
    if (a === "-e" || a === "--expression") {
      scripts.push(args[i + 1] ?? "");
      explicit = true;
      i += 1;
    } else if (a.startsWith("--expression=")) {
      scripts.push(a.slice("--expression=".length));
      explicit = true;
    } else if (first === null && !a.startsWith("-")) {
      first = a;
    }
  }
  if (!explicit && first !== null) scripts.push(first);
  const bad = scripts.find((s) => !SED_SCRIPT.test(s));
  if (bad === undefined) return null;
  return (
    `\`sed '${bad}'\` is outside the read forms: line and pattern ranges with p, d, q, = or l, ` +
    "and s/// without the e or w flag. Print a range with sed -n 'A,Bp'."
  );
}

/** @param {string} text @returns {string} */
function dropQuoted(text) {
  return text.replace(/'[^']*'/g, "''").replace(/"(?:[^"\\]|\\.)*"/g, '""');
}

/**
 * The command's segments, with each quoted string replaced by a marker that indexes `quoted`,
 * so a check can still read the quoted text.
 * @param {string} body
 * @param {string[]} quoted collects the quoted strings, quotes included
 * @returns {string[]}
 */
function segments(body, quoted) {
  // Subshells and substitutions are commands too:
  // a `$(python ...)` inside an allowed command is still python running.
  const mark = (/** @type {string} */ q) => `\u0001${quoted.push(q) - 1}\u0002`;
  return body
    .replace(/'[^']*'|"(?:[^"\\]|\\.)*"/g, mark)
    .replace(/\$\(/g, "; ")
    .replace(/`/g, "; ")
    .replace(/[()]/g, " ")
    .split(/&&|\|\||;|\||\n/);
}

const MARKER = /\u0001(\d+)\u0002/g;

/**
 * A word with each quoted string blanked to '' or "",
 * as the checks other than sed's and awk's expect.
 * @param {string} word @param {string[]} quoted @returns {string}
 */
function blankQuoted(word, quoted) {
  return word.replace(MARKER, (_, i) => (quoted[Number(i)][0] === "'" ? "''" : '""'));
}

/**
 * A word with each quoted string restored without its quotes.
 * @param {string} word @param {string[]} quoted @returns {string}
 */
function unquote(word, quoted) {
  return word.replace(MARKER, (_, i) => quoted[Number(i)].slice(1, -1));
}

/** @param {string} segment @param {string[]} quoted @returns {string[]} */
function tokens(segment, quoted) {
  // Redirects were judged by findRedirect over the whole command;
  // what is left of one here is punctuation,
  // and leaving it in made `git push … 2>&1` read as a push naming a branch called "2>&1"
  // (measured, skills#195).
  const words = segment
    .replace(/\d?(?:>>?|&>)&?\s*\S*/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  // Leading `VAR=value` assignments, and the empty quotes that dropQuoted left.
  while (words.length && (/^[A-Za-z_][A-Za-z0-9_]*=/.test(words[0]) || /^['"]{2}$/.test(blankQuoted(words[0], quoted)))) {
    words.shift();
  }
  if (words[0] === "<<HEREDOC") return [];
  if (words[0]?.startsWith("<<")) words.shift();
  return words;
}

/** @param {string} command @returns {string} */
function trim(command) {
  const one = command.replace(/\s+/g, " ").trim();
  return one.length > 80 ? `${one.slice(0, 77)}…` : one;
}

// ---------------------------------------------------------- findings

const BASES = new Set(["decided", "judged"]);
const PR = /^[\w.-]+\/[\w.-]+#(\d+)$/;

/**
 * Problems with a parsed findings file, in field order; empty when valid.
 *
 * The contract is X8's finding shape (skills#41) under a header that
 * names what was reviewed: the collector and the falsifier need the
 * PR and the head commit, and a finding without a verbatim rule
 * sentence is not a finding.
 * @param {unknown} doc
 * @param {ReviewRun} run
 * @returns {string[]}
 */
export function findingsProblems(doc, run) {
  /** @type {string[]} */
  const out = [];
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) {
    return ["the file is not a JSON object with pr, head, pass, model_tier and findings"];
  }
  const d = /** @type {Record<string, unknown>} */ (doc);
  if (typeof d.pr !== "string" || !PR.test(d.pr)) out.push("`pr` must be `owner/repo#n`");
  if (typeof d.head !== "string" || !/^[0-9a-f]{7,40}$/.test(d.head)) {
    out.push("`head` must be the PR head commit sha that was reviewed");
  }
  if (d.pass !== run.pass) out.push(`\`pass\` must be \`${run.pass}\``);
  if (d.model_tier !== run.modelTier) out.push(`\`model_tier\` must be \`${run.modelTier}\``);
  if (!Array.isArray(d.findings)) {
    out.push("`findings` must be an array, empty when nothing was found");
    return out;
  }
  /** @type {unknown[]} */ (d.findings).forEach((entry, i) => {
    const at = `findings[${i}]`;
    if (!entry || typeof entry !== "object") return out.push(`${at} is not an object`);
    const f = /** @type {Record<string, unknown>} */ (entry);
    if (typeof f.file !== "string" || !f.file) out.push(`${at}.file must name the file in the PR`);
    if (!Number.isInteger(f.line)) out.push(`${at}.line must be an integer`);
    if (typeof f.rule !== "string" || f.rule.trim().length < 10) {
      out.push(`${at}.rule must quote the ticket or spec sentence verbatim`);
    }
    if (typeof f.input !== "string" || !f.input) out.push(`${at}.input must name the input that shows the departure`);
    if (typeof f.finding_basis !== "string" || !BASES.has(f.finding_basis)) {
      out.push(`${at}.finding_basis must be decided or judged`);
    }
    if (typeof f.confidence !== "number" || f.confidence < 0 || f.confidence > 100) {
      out.push(`${at}.confidence must be 0 to 100`);
    }
    if (typeof f.finding !== "string" || !f.finding) out.push(`${at}.finding must be one sentence`);
  });
  return out;
}

/**
 * The PR number a valid findings document names.
 * @param {unknown} doc
 * @returns {number | null}
 */
export function prNumber(doc) {
  const pr = doc && typeof doc === "object" ? /** @type {Record<string, unknown>} */ (doc).pr : null;
  const m = PR.exec(typeof pr === "string" ? pr : "");
  return m ? Number(m[1]) : null;
}

// ------------------------------------------------------------ tickets

/**
 * The tickets a waybill order names, as `owner/repo#n`, lowercase.
 * Reads only the order's `tickets` key.
 * @param {string} orderText the order file, YAML
 * @returns {string[]}
 */
export function orderTickets(orderText) {
  const lines = orderText.split("\n");
  const at = lines.findIndex((l) => /^tickets:/.test(l));
  if (at < 0) return [];
  const bare = (/** @type {string} */ v) =>
    v.replace(/\s+#.*$/, "").trim().replace(/^["']|["']$/g, "").toLowerCase();
  const inline = lines[at].slice("tickets:".length).trim();
  if (inline.startsWith("[")) {
    return inline
      .replace(/^\[|\].*$/g, "")
      .split(",")
      .map(bare)
      .filter(Boolean);
  }
  /** @type {string[]} */
  const out = [];
  for (const line of lines.slice(at + 1)) {
    const m = /^\s+-\s+(.+)$/.exec(line);
    if (!m) break;
    out.push(bare(m[1]));
  }
  return out;
}

/**
 * The tickets the session read, from its transcript:
 * every issue read call whose result came back without an error, as `owner/repo#n`, lowercase.
 * @param {string} transcriptText
 * @returns {Set<string>}
 */
export function ticketsRead(transcriptText) {
  /** @type {Map<string, string>} */
  const calls = new Map();
  /** @type {Set<string>} */
  const read = new Set();
  for (const line of transcriptText.split("\n")) {
    let d;
    try {
      d = JSON.parse(line);
    } catch {
      continue;
    }
    const content = d?.message?.content;
    if (!Array.isArray(content)) continue;
    for (const b of content) {
      if (b?.type === "tool_use" && /(^|__)issue_read$/.test(b.name ?? "")) {
        const i = b.input ?? {};
        if ((i.method ?? "get") !== "get" || !i.owner || !i.repo || !i.issue_number) continue;
        calls.set(b.id, `${i.owner}/${i.repo}#${i.issue_number}`.toLowerCase());
      }
      if (b?.type === "tool_result" && calls.has(b.tool_use_id) && b.is_error !== true) {
        read.add(/** @type {string} */ (calls.get(b.tool_use_id)));
      }
    }
  }
  return read;
}
