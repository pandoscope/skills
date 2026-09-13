// The review-session policy — what a review session may call, and
// what its findings file must look like.
//
// Pure functions over the hook's inputs, so the katas can assert on
// verdicts without staging a session. The entry point that reads
// stdin, logs and exits is `../review-driver.mjs`.
//
// The policy is an ALLOWLIST. The driver lab (skills#130) measured
// that a refusal naming the unmet criterion is followed, and that a
// check followed must not be wrong; X8 (skills#41) measured that the
// smallest tier runs code when told in prose not to. A denylist of the
// ways to run code is a list the next detour is not on, so what is
// allowed is enumerated and everything else is refused with the rule.

// ------------------------------------------------------------ marker

// The routine's saved prompt is the session's first user message, and
// the only thing the hooks can read that was stored ahead of the run.
// `PANDO-REVIEW: <pass> tier=<tier>` on its own line makes the session
// a review session; nothing else does.
const MARKER = /^PANDO-REVIEW:\s*([a-z0-9-]+)\s+tier=([a-z0-9-]+)\s*$/m;

/** The review run a transcript's first user message declares, or null. */
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
 * `why` is the reason the model reads. It names the rule and the
 * allowed alternative, never a bare "denied" — a refusal without the
 * criterion is what a model routes around.
 */
export function toolVerdict(name, input, run) {
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

// What a reader runs. Anything that executes a program, edits a file
// in place, or prints the environment is absent on purpose: `env` and
// `printenv` would print the session's tokens into a transcript.
const READ_COMMANDS = new Set([
  "cat", "head", "tail", "sed", "grep", "rg", "egrep", "fgrep", "find", "ls", "wc", "awk", "sort",
  "uniq", "cut", "tr", "diff", "tree", "stat", "file", "jq", "echo", "printf", "true", "false",
  "test", "[", "[[", "cd", "pwd", "which", "type", "basename", "dirname", "realpath", "readlink",
  "date", "column", "nl", "comm", "paste", "md5sum", "sha256sum", "expr", "seq", "tac", "rev",
  "fold", "fmt", "strings", "od", "hexdump", "xxd", "du", "df", "mkdir", "touch",
]);

const GIT_READ = new Set([
  "diff", "log", "show", "fetch", "ls-files", "ls-tree", "ls-remote", "grep", "cat-file",
  "rev-parse", "status", "merge-base", "blame", "name-rev", "describe", "rev-list", "shortlog",
  "diff-tree", "for-each-ref", "show-ref", "check-ignore", "var", "count-objects", "branch",
  "remote", "config", "worktree", "stash", "tag", "version", "help",
]);

// Sub-flags that turn a read subcommand into a write.
const GIT_WRITE_FLAGS = {
  branch: /^-(m|M|d|D|c|C|f|-move|-copy|-delete|-force|-set-upstream-to|u)$|^--(edit-description|unset-upstream)$/,
  remote: /^(add|remove|rm|rename|set-url|set-head|set-branches|prune|update)$/,
  config: /^(--unset|--unset-all|--add|--replace-all|--edit|-e|--rename-section|--remove-section)$/,
  worktree: /^(add|remove|prune|move|lock|unlock|repair)$/,
  stash: /^(push|save|pop|apply|drop|clear|create|store|branch)$/,
  tag: /^(-a|-d|-f|-s|-m|-F|--delete|--force)$/,
  fetch: /^(--prune|-p|--prune-tags|-P)$/,
};

/** Verdict on a Bash command under the read-only policy. */
export function bashVerdict(command, run) {
  const deny = (why) => ({ allow: false, why: `Bash \`${trim(command)}\`: ${why}` });
  let body = stripHeredocs(command);
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
        `\`${cmd}\` is not a read command. A spec-fidelity review reads the code and does not run it: ` +
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
    if (cmd === "mkdir" || cmd === "touch") {
      if (!args.filter((a) => !a.startsWith("-")).every((a) => a.endsWith(run.dir) || a.endsWith(run.findings))) {
        return deny(`\`${cmd}\` outside ${run.dir}. The review directory is the only path a review creates.`);
      }
    }
  }
  return { allow: true };
}

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
  if (sub === "switch" || sub === "checkout") {
    const flag = rest.findIndex((x) => x === "-c" || x === "-b" || x === "--create");
    if (flag > -1 && run.branch.test(rest[flag + 1] ?? "")) return null;
    return (
      `\`git ${sub}\` may only create the review branch: git switch -c ${run.branchForm}. ` +
      "The clone stays at the checkout the session started on otherwise."
    );
  }
  if (sub === "add") {
    if (nonFlags.length && nonFlags.every((p) => p.includes(run.dir))) return null;
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

// ----------------------------------------------------------- parsing

function stripHeredocs(cmd) {
  // A heredoc body is data, not commands — unless it feeds a program,
  // and the program is judged by its own first word.
  // The opener line survives: a redirect after the tag is still a write.
  return cmd.replace(/<<-?\s*'?(\w+)'?([^\n]*)\n[\s\S]*?\n\1\s*(?=\n|$)/g, "<<HEREDOC$2");
}

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

function dropQuoted(text) {
  return text.replace(/'[^']*'/g, "''").replace(/"(?:[^"\\]|\\.)*"/g, '""');
}

function segments(body) {
  // Subshells and substitutions are commands too: a `$(python ...)`
  // inside an allowed command is still python running.
  return dropQuoted(body)
    .replace(/\$\(/g, "; ")
    .replace(/`/g, "; ")
    .replace(/[()]/g, " ")
    .split(/&&|\|\||;|\||\n/);
}

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

function trim(command) {
  const one = command.replace(/\s+/g, " ").trim();
  return one.length > 80 ? `${one.slice(0, 77)}…` : one;
}

// ---------------------------------------------------------- findings

const TIERS = new Set(["hard", "judgment"]);
const PR = /^[\w.-]+\/[\w.-]+#(\d+)$/;

/**
 * Problems with a parsed findings file, worst first; empty when valid.
 *
 * The contract is X8's finding shape (skills#41) under a header that
 * names what was reviewed: the collector and the falsifier need the
 * PR and the head commit, and a finding without a verbatim rule
 * sentence is not a finding.
 */
export function findingsProblems(doc, run) {
  const out = [];
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) {
    return ["the file is not a JSON object with pr, head, pass, tier and findings"];
  }
  if (typeof doc.pr !== "string" || !PR.test(doc.pr)) out.push("`pr` must be `owner/repo#n`");
  if (typeof doc.head !== "string" || !/^[0-9a-f]{7,40}$/.test(doc.head)) {
    out.push("`head` must be the PR head commit sha that was reviewed");
  }
  if (doc.pass !== run.pass) out.push(`\`pass\` must be \`${run.pass}\``);
  if (doc.tier !== run.tier) out.push(`\`tier\` must be \`${run.tier}\``);
  if (!Array.isArray(doc.findings)) {
    out.push("`findings` must be an array, empty when nothing was found");
    return out;
  }
  doc.findings.forEach((f, i) => {
    const at = `findings[${i}]`;
    if (!f || typeof f !== "object") return out.push(`${at} is not an object`);
    if (typeof f.file !== "string" || !f.file) out.push(`${at}.file must name the file in the PR`);
    if (!Number.isInteger(f.line)) out.push(`${at}.line must be an integer`);
    if (typeof f.rule !== "string" || f.rule.trim().length < 10) {
      out.push(`${at}.rule must quote the ticket or spec sentence verbatim`);
    }
    if (typeof f.input !== "string" || !f.input) out.push(`${at}.input must name the input that shows the departure`);
    if (!TIERS.has(f.tier)) out.push(`${at}.tier must be hard or judgment`);
    if (typeof f.confidence !== "number" || f.confidence < 0 || f.confidence > 100) {
      out.push(`${at}.confidence must be 0 to 100`);
    }
    if (typeof f.finding !== "string" || !f.finding) out.push(`${at}.finding must be one sentence`);
  });
  return out;
}

/** The PR number a valid findings document names. */
export function prNumber(doc) {
  const m = PR.exec(doc?.pr ?? "");
  return m ? Number(m[1]) : null;
}
