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
 * @property {string} tier       the model tier the routine runs
 * @property {string} dir        the review directory, relative to the clone
 * @property {string} findings   the findings file, relative to the clone
 * @property {RegExp} branch     the review branch, capturing the PR number
 * @property {string} branchForm the branch as the reason spells it
 */
/** @typedef {{ allow: true } | { allow: false, why: string }} Verdict */

// ------------------------------------------------------------ marker

// The routine's saved prompt is the session's first user message, and
// the only thing the hooks can read that was stored ahead of the run.
// `PANDO-REVIEW: <pass> tier=<tier>` on its own line makes the session
// a review session; nothing else does.
const MARKER = /^PANDO-REVIEW:\s*([a-z0-9-]+)\s+tier=([a-z0-9-]+)\s*$/m;

/**
 * The review run a transcript's first user message declares, or null.
 * @param {string} transcriptText
 * @returns {ReviewRun | null}
 */
export function reviewRun(transcriptText) {
  const first = firstUserText(transcriptText);
  const m = first ? MARKER.exec(first) : null;
  if (!m) return null;
  const [, pass, tier] = m;
  return {
    pass,
    tier,
    // Relative to the clone of the reviewed repository — the only
    // directory the session may write, and the one the collector reads.
    dir: `reviews/${pass}-${tier}`,
    findings: `reviews/${pass}-${tier}/findings.json`,
    branch: new RegExp(`^claude/review-${pass}-${tier}-pr(\\d+)$`),
    branchForm: `claude/review-${pass}-${tier}-pr<n>`,
  };
}

/**
 * @param {string | null | undefined} text
 * @returns {string | null}
 */
function firstUserText(text) {
  for (const line of (text ?? "").split("\n")) {
    let d;
    try {
      d = JSON.parse(line);
    } catch {
      continue;
    }
    if (d?.type !== "user" || !d.message) continue;
    const c = d.message.content;
    if (typeof c === "string") return c;
    if (Array.isArray(c)) {
      const blocks = c.filter((b) => b?.type === "text").map((b) => b.text);
      if (blocks.length) return blocks.join("\n");
    }
    // A tool_result user turn is not the prompt; keep looking.
  }
  return null;
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
  "Agent",
  "Task",
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
  for (const segment of segments(body)) {
    const words = tokens(segment);
    if (!words.length) continue;
    const [cmd, ...args] = words;
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
    if (cmd === "find" && args.some((a) => /^-(exec|execdir|ok|okdir|delete|fprint|fls)/.test(a))) {
      return deny("`find` with -exec, -ok or -delete executes or removes. List only.");
    }
    if (cmd === "awk" && args.some((a) => /system\s*\(|\|\s*"|>\s*"/.test(a))) {
      return deny("`awk` with system() or an output pipe executes or writes. Print only.");
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
 * Whether a path is the review directory or lies inside it — by path
 * segment, so `reviews/<pass>-<tier>-other/x` is outside.
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

/** @param {string} text @returns {string} */
function dropQuoted(text) {
  return text.replace(/'[^']*'/g, "''").replace(/"(?:[^"\\]|\\.)*"/g, '""');
}

/** @param {string} body @returns {string[]} */
function segments(body) {
  // Subshells and substitutions are commands too: a `$(python ...)`
  // inside an allowed command is still python running.
  return dropQuoted(body)
    .replace(/\$\(/g, "; ")
    .replace(/`/g, "; ")
    .replace(/[()]/g, " ")
    .split(/&&|\|\||;|\||\n/);
}

/** @param {string} segment @returns {string[]} */
function tokens(segment) {
  const words = segment.trim().split(/\s+/).filter(Boolean);
  // Leading VAR=value assignments and the empty quotes dropQuoted left.
  while (words.length && (/^[A-Za-z_][A-Za-z0-9_]*=/.test(words[0]) || words[0] === "''" || words[0] === '""')) {
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

const TIERS = new Set(["hard", "judgment"]);
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
    return ["the file is not a JSON object with pr, head, pass, tier and findings"];
  }
  const d = /** @type {Record<string, unknown>} */ (doc);
  if (typeof d.pr !== "string" || !PR.test(d.pr)) out.push("`pr` must be `owner/repo#n`");
  if (typeof d.head !== "string" || !/^[0-9a-f]{7,40}$/.test(d.head)) {
    out.push("`head` must be the PR head commit sha that was reviewed");
  }
  if (d.pass !== run.pass) out.push(`\`pass\` must be \`${run.pass}\``);
  if (d.tier !== run.tier) out.push(`\`tier\` must be \`${run.tier}\``);
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
    if (typeof f.tier !== "string" || !TIERS.has(f.tier)) out.push(`${at}.tier must be hard or judgment`);
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
