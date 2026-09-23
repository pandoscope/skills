// The review driver's katas (skills#195).
//
// Policy verdicts are asserted on wording, not only on allow/deny:
// the reason is what the model acts on,
// and a refusal without the rule and the alternative is what a model routes around.
// The Stop path is staged with a real clone and a bare remote,
// and walked through every criterion in the order the driver names them.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  bashVerdict,
  findingsProblems,
  orderRun,
  orderTickets,
  ticketsRead,
  toolVerdict,
} from "../../../original/thread-ledger/review/policy.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DRIVER = path.join(HERE, "../../../original/thread-ledger/review-driver.mjs");

const PROMPT = "PANDO-REVIEW: spec-fidelity tier=sonnet\n\nReview the pull request named in the trigger.";
// Every kata session is dispatched by this order.
// The Routine's prompt, DISPATCH below, carries no data (skills#195, waybill#1).
const ORDER =
  "id: review-spec-fidelity-sonnet-pr143\nrole: reviewer\npass: spec-fidelity\ntier: sonnet\n" +
  "pull_request: pandoscope/meta#143\ntickets:\n  - pandoscope/skills#195\n";
const ORDER_REF = "order/review-spec-fidelity-sonnet-pr143";
const DISPATCH = "A waybill order dispatched this autonomous session. Read CLAUDE.md and follow it.";
const PARSED = orderRun(ORDER);
if (!PARSED) throw new Error("the kata order did not parse as a review run");
const RUN = PARSED;

describe("bash policy", () => {
  /** @param {string} cmd */
  const allow = (cmd) => assert.deepEqual(bashVerdict(cmd, RUN), { allow: true }, cmd);
  /** @param {string} cmd @param {...string} words */
  const deny = (cmd, ...words) => {
    const v = bashVerdict(cmd, RUN);
    if (v.allow) assert.fail(`${cmd} should be denied`);
    for (const w of words) assert.match(v.why, new RegExp(w), `${cmd}: ${v.why}`);
  };
  it("allows reading", () => {
    allow("cat src/refs.py | head -50");
    allow("git diff origin/main...HEAD --stat && git log --oneline -5");
    allow("grep -rn 'parse_ref' src/ | sort | uniq -c");
    allow("cd /home/user/meta && git fetch origin pull/143/head:refs/remotes/origin/pr-143");
    allow("git show HEAD:src/x.py 2>/dev/null | sed -n 1,40p");
    allow("find . -name '*.py' -not -path '*/node_modules/*'");
    allow("jq '.findings | length' reviews/spec-fidelity-sonnet/findings.json");
    allow("FOO=bar git -C /home/user/meta rev-parse HEAD");
    allow("ls > /dev/null");
  });
  it("denies running code, by first word, in pipelines and in substitutions", () => {
    deny("python3 -m pytest -q", "python3", "not a read command", "does not run it");
    deny("cat spec.md && python3 -c 'print(1)'", "python3");
    deny("echo $(node -e '1')", "node");
    deny("bash ./run.sh", "bash");
    deny("./reinset --help", "reinset");
    deny("git log | xargs rm", "xargs");
    deny("env | grep TOKEN", "env");
  });
  it("denies writes", () => {
    deny("echo hi > notes.txt", "writes a file");
    deny("cat <<EOF > findings.json\n{}\nEOF", "writes a file");
    deny("sed -i 's/a/b/' src/x.py", "sed -i");
    deny("find . -name '*.pyc' -delete", "-exec, -ok or -delete");
    deny("mkdir -p reviews/spec-fidelity-sonnet", "mkdir", "not a read command");
    deny("touch notes.txt", "touch");
  });
  it("denies reading the session's own secrets", () => {
    deny("cat /proc/self/environ", "session's own secrets");
    deny("cat ~/.claude/session.env", "session's own secrets");
    deny("grep TOKEN /root/.claude/settings.json", "session's own secrets");
    deny("cat .env", "session's own secrets");
    allow("cat .claude/settings.json");
    allow("grep -rn environment/ docs/");
    // The harness's own persisted tool results are content, not secrets:
    // refusing one cost the first haiku run its diff.
    allow("cat /root/.claude/projects/-home-user-x/tool-results/toolu_01.json");
    deny("cat /root/.claude/projects/-home-user-x/session.jsonl", "session's own secrets");
  });
  it("allows exactly the findings branch, add, commit and push", () => {
    allow("git switch -c claude/review-spec-fidelity-sonnet-pr143");
    allow("git checkout -b claude/review-spec-fidelity-sonnet-pr143");
    allow("git add reviews/spec-fidelity-sonnet && git commit -m 'chore(review): findings'");
    allow("git push -u origin claude/review-spec-fidelity-sonnet-pr143");
    // A trailing redirect is punctuation by the time the arguments are judged:
    // it must not read as a branch name.
    allow("git push -u origin claude/review-spec-fidelity-sonnet-pr143 2>&1 | tail -5");
    allow("git add reviews/spec-fidelity-sonnet && git commit -m 'x' && git push -u origin claude/review-spec-fidelity-sonnet-pr143 2>&1");
    deny("git switch -c claude/sk143-fix", "review branch", "claude/review-spec-fidelity-sonnet-pr<n>");
    deny("git checkout main", "review branch");
    deny("git add -A", "only stage reviews/spec-fidelity-sonnet/");
    deny("git add src/x.py reviews/spec-fidelity-sonnet/findings.json", "only stage");
    deny("git commit --amend --no-edit", "--amend");
    deny("git push --force origin claude/review-spec-fidelity-sonnet-pr143", "--force");
    deny("git push origin main", "names the review branch");
    deny("git reset --hard", "not a read subcommand");
    deny("git branch -D main", "writes");
    deny("git -c core.hooksPath=/dev/null commit -m x", "git -c");
    deny("git stash push", "writes the working tree");
    deny("git stash", "writes the working tree");
    allow("git stash list");
    deny("git tag v9", "creates a tag");
    allow("git tag -l");
    deny("git add reviews/spec-fidelity-sonnet-other/notes.txt", "only stage reviews/spec-fidelity-sonnet/");
    allow("git add ./reviews/spec-fidelity-sonnet/");
  });
});

describe("tool policy", () => {
  it("allows reads and the findings file only", () => {
    assert.equal(toolVerdict("Read", { file_path: "/x" }, RUN).allow, true);
    assert.equal(toolVerdict("Read", { file_path: "/home/user/skills/.claude/settings.json" }, RUN).allow, true);
    assert.equal(toolVerdict("Read", { file_path: "/root/.claude/session.env" }, RUN).allow, false);
    assert.equal(
      toolVerdict("Read", { file_path: "/root/.claude/projects/-home-user-x/tool-results/toolu_01.json" }, RUN).allow,
      true,
    );
    assert.equal(toolVerdict("Grep", { pattern: "TOKEN", path: "/proc/self/environ" }, RUN).allow, false);
    assert.equal(toolVerdict("mcp__github__pull_request_read", {}, RUN).allow, true);
    assert.equal(toolVerdict("mcp__github__get_file_contents", {}, RUN).allow, true);
    assert.equal(toolVerdict("Write", { file_path: "/home/user/meta/reviews/spec-fidelity-sonnet/findings.json" }, RUN).allow, true);
    const v = toolVerdict("Write", { file_path: "/home/user/meta/src/x.py" }, RUN);
    if (v.allow) assert.fail("a write outside the review directory should be denied");
    assert.match(v.why, /only file a review writes is reviews\/spec-fidelity-sonnet\/findings.json/);
  });
  it("denies forge writes and everything unlisted, naming the alternative", () => {
    for (const name of ["mcp__github__add_issue_comment", "mcp__github__pull_request_review_write", "mcp__github__create_pull_request", "mcp__github__push_files"]) {
      const v = toolVerdict(name, {}, RUN);
      if (v.allow) assert.fail(`${name} should be denied`);
      assert.match(v.why, /posts nothing/);
    }
    const v = toolVerdict("Artifact", {}, RUN);
    if (v.allow) assert.fail("Artifact should be denied");
    assert.match(v.why, /not on the review session's tool list/);
  });
  it("denies subagents, which the policy does not reach", () => {
    for (const name of ["Agent", "Task"]) {
      const v = toolVerdict(name, { prompt: "run the tests" }, RUN);
      if (v.allow) assert.fail(`${name} should be denied`);
      assert.match(v.why, /policy does not reach/);
      assert.match(v.why, /could run the code this review may not run/);
    }
    // The task list is not a subagent: it spawns nothing.
    assert.equal(toolVerdict("TaskCreate", {}, RUN).allow, true);
    assert.equal(toolVerdict("TodoWrite", {}, RUN).allow, true);
  });
});

describe("findings contract", () => {
  const good = {
    pr: "pandoscope/meta#143",
    head: "22056ce0",
    pass: "spec-fidelity",
    tier: "sonnet",
    findings: [{ file: "src/x.py", line: 3, rule: "The parser accepts owner/repo!n references.", input: "owner/repo!7", tier: "hard", confidence: 80, finding: "Bang references raise." }],
  };
  it("accepts the contract and an empty findings array", () => {
    assert.deepEqual(findingsProblems(good, RUN), []);
    assert.deepEqual(findingsProblems({ ...good, findings: [] }, RUN), []);
  });
  it("names every missing field", () => {
    const p = findingsProblems({ ...good, pr: "143", head: "x", tier: "opus", findings: [{}] }, RUN);
    assert.match(p.join("\n"), /`pr` must be `owner\/repo#n`/);
    assert.match(p.join("\n"), /`head` must be/);
    assert.match(p.join("\n"), /`tier` must be `sonnet`/);
    assert.match(p.join("\n"), /findings\[0\]\.rule must quote/);
    assert.match(p.join("\n"), /findings\[0\]\.tier must be hard or judgment/);
    assert.match(findingsProblems([], RUN)[0], /not a JSON object/);
  });
});

// ------------------------------------------------------------ staged

/** @param {string} cwd @param {...string} args */
function sh(cwd, ...args) {
  const r = spawnSync(args[0], args.slice(1), { cwd, encoding: "utf8" });
  assert.equal(r.status, 0, `${args.join(" ")}\n${r.stderr}`);
  return r.stdout.trim();
}

function stage() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "review-driver-"));
  const home = path.join(root, "home");
  const remote = path.join(root, "remote.git");
  const clone = path.join(root, "repos", "meta");
  fs.mkdirSync(home, { recursive: true });
  fs.mkdirSync(clone, { recursive: true });
  sh(root, "git", "init", "-q", "--bare", remote);
  sh(clone, "git", "init", "-q", "-b", "main");
  sh(clone, "git", "config", "user.email", "kata@example.test");
  sh(clone, "git", "config", "user.name", "kata");
  sh(clone, "git", "config", "commit.gpgsign", "false");
  fs.writeFileSync(path.join(clone, "README.md"), "seed\n");
  sh(clone, "git", "add", "-A");
  sh(clone, "git", "commit", "-q", "-m", "chore: seed");
  sh(clone, "git", "remote", "add", "origin", remote);
  sh(clone, "git", "push", "-q", "-u", "origin", "main");
  const transcript = path.join(root, "transcript.jsonl");
  fs.writeFileSync(
    transcript,
    `${JSON.stringify({ type: "user", message: { role: "user", content: DISPATCH } })}\n` +
      `${JSON.stringify({ type: "assistant", timestamp: "t", message: { role: "assistant", model: "claude-sonnet", usage: { input_tokens: 10, output_tokens: 5 }, content: [{ type: "tool_use", name: "Bash", input: { command: "git diff" } }] } })}\n`,
  );
  fs.appendFileSync(transcript, issueRead("r0", "pandoscope", "skills", 195));
  const orders = path.join(root, "repos", "waybill", "orders");
  fs.mkdirSync(orders, { recursive: true });
  const order = path.join(orders, "review-spec-fidelity-sonnet-pr143.yml");
  fs.writeFileSync(order, ORDER);
  return { root, home, clone, transcript, order };
}

/**
 * @param {ReturnType<typeof stage>} s
 * @param {Record<string, unknown>} input
 * @param {Record<string, string>} [env]
 */
function fire(s, input, env = {}) {
  const r = spawnSync("node", [DRIVER], {
    input: JSON.stringify({ transcript_path: s.transcript, session_id: "kata", ...input }),
    encoding: "utf8",
    env: { ...process.env, HOME: s.home, CLAUDE_CONFIG_DIR: path.join(s.home, ".claude"), HEARTBEAT_REPO_ROOT: path.join(s.root, "repos"), CCR_TRIGGER_HEAD_REF: ORDER_REF, ...env },
  });
  return { code: r.status, err: r.stderr ?? "" };
}

/**
 * One issue read call and its result, as the transcript records them.
 * @param {string} id @param {string} owner @param {string} repo @param {number} n @param {boolean} [error]
 */
function issueRead(id, owner, repo, n, error = false) {
  return (
    `${JSON.stringify({ type: "assistant", message: { role: "assistant", model: "m", content: [{ type: "tool_use", id, name: "mcp__github__issue_read", input: { method: "get", owner, repo, issue_number: n } }] } })}\n` +
    `${JSON.stringify({ type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: id, is_error: error, content: [{ type: "text", text: "{\"number\":1}" }] }] } })}\n`
  );
}

describe("order run", () => {
  it("reads pass and tier from a reviewer order", () => {
    const r = orderRun(ORDER);
    assert.equal(r?.pass, "spec-fidelity");
    assert.equal(r?.tier, "sonnet");
    assert.equal(r?.findings, "reviews/spec-fidelity-sonnet/findings.json");
    assert.equal(r?.branchForm, "claude/review-spec-fidelity-sonnet-pr<n>");
  });
  it("is null for another role, or a reviewer order without pass or tier", () => {
    assert.equal(orderRun("id: x\nrole: implementer\npull_request: pandoscope/meta#1\n"), null);
    assert.equal(orderRun("id: x\nrole: reviewer\ntier: sonnet\n"), null);
    assert.equal(orderRun("id: x\nrole: reviewer\npass: Spec Fidelity\ntier: sonnet\n"), null);
    assert.equal(orderRun(""), null);
  });
});

describe("order tickets", () => {
  it("reads the tickets list in block and flow form, lowercase", () => {
    assert.deepEqual(
      orderTickets("id: x\nrole: reviewer\ntickets:\n  - pandoscope/skills#195\n  - 'Pandoscope/Waybill#1'  # the order\npass: spec-fidelity\n"),
      ["pandoscope/skills#195", "pandoscope/waybill#1"],
    );
    assert.deepEqual(orderTickets("tickets: [pandoscope/skills#195, \"pandoscope/meta#52\"]\n"), [
      "pandoscope/skills#195",
      "pandoscope/meta#52",
    ]);
    assert.deepEqual(orderTickets("id: x\ntickets: []\n"), []);
    assert.deepEqual(orderTickets("id: x\n"), []);
  });
  it("counts a ticket read only when its issue read result came back clean", () => {
    const text =
      issueRead("a", "pandoscope", "skills", 195) +
      issueRead("b", "Pandoscope", "Meta", 52) +
      issueRead("c", "pandoscope", "waybill", 1, true) +
      `${JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", id: "d", name: "mcp__github__issue_read", input: { method: "get_comments", owner: "pandoscope", repo: "ghx", issue_number: 3 } }] } })}\n`;
    assert.deepEqual([...ticketsRead(text)].sort(), ["pandoscope/meta#52", "pandoscope/skills#195"]);
  });
});

describe("staged session", () => {
  it("blocks Stop until every ticket in the order was read", () => {
    const s = stage();
    fs.writeFileSync(s.order, `${ORDER}  - pandoscope/waybill#1\n`);
    let stop = fire(s, { hook_event_name: "Stop" });
    assert.equal(stop.code, 2);
    assert.match(stop.err, /not complete until every ticket the order names was read/);
    assert.match(stop.err, /pandoscope\/waybill#1/);
    assert.doesNotMatch(stop.err, /pandoscope\/skills#195/);
    fs.appendFileSync(s.transcript, issueRead("r2", "pandoscope", "waybill", 1));
    stop = fire(s, { hook_event_name: "Stop" });
    assert.equal(stop.code, 2);
    assert.match(stop.err, /not complete until reviews\/spec-fidelity-sonnet\/findings.json exists/);
  });

  it("denies at PreToolUse, logs it, and walks the Stop criteria to completion", () => {
    const s = stage();
    const denied = fire(s, { hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command: "python3 -m pytest" } });
    assert.equal(denied.code, 2);
    assert.match(denied.err, /python3.*not a read command/);
    assert.match(denied.err, /The denial is logged/);
    const allowed = fire(s, { hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command: "git diff" } });
    assert.equal(allowed.code, 0);

    let stop = fire(s, { hook_event_name: "Stop" });
    assert.equal(stop.code, 2);
    assert.match(stop.err, /not complete until reviews\/spec-fidelity-sonnet\/findings.json exists/);

    const dir = path.join(s.clone, "reviews", "spec-fidelity-sonnet");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "findings.json"), JSON.stringify({ pr: "pandoscope/meta#143", head: "22056ce0", pass: "spec-fidelity", tier: "sonnet", findings: "no" }));
    stop = fire(s, { hook_event_name: "Stop" });
    assert.equal(stop.code, 2);
    assert.match(stop.err, /`findings` must be an array/);

    fs.writeFileSync(path.join(dir, "findings.json"), JSON.stringify({ pr: "pandoscope/meta#143", head: "22056ce0", pass: "spec-fidelity", tier: "sonnet", findings: [] }));
    stop = fire(s, { hook_event_name: "Stop" });
    assert.equal(stop.code, 2);
    assert.match(stop.err, /git -C \S+ switch -c claude\/review-spec-fidelity-sonnet-pr143/);
    assert.ok(fs.existsSync(path.join(dir, "trace.json")), "trace written once the findings validate");
    assert.ok(fs.existsSync(path.join(dir, "driver.jsonl")), "denial log written beside the findings");
    const denials = fs.readFileSync(path.join(dir, "driver.jsonl"), "utf8").trim().split("\n");
    assert.equal(denials.length, 1, "one denial, and only denials");
    assert.match(denials[0], /"event":"deny"/);
    assert.match(denials[0], /python3/);
    const trace = JSON.parse(fs.readFileSync(path.join(dir, "trace.json"), "utf8"));
    assert.equal(trace.calls[0].arg, "git diff");
    assert.equal(trace.usage["claude-sonnet"].input, 10);

    sh(s.clone, "git", "switch", "-q", "-c", "claude/review-spec-fidelity-sonnet-pr143");
    stop = fire(s, { hook_event_name: "Stop" });
    assert.equal(stop.code, 2);
    assert.match(stop.err, /git -C \S+ add reviews\/spec-fidelity-sonnet && git -C \S+ commit -m "chore\(review\)/);

    sh(s.clone, "git", "add", "reviews/spec-fidelity-sonnet");
    sh(s.clone, "git", "commit", "-q", "-m", "chore(review): spec-fidelity sonnet findings for pr143");
    stop = fire(s, { hook_event_name: "Stop" });
    assert.equal(stop.code, 2);
    assert.match(stop.err, /git -C \S+ push -u origin claude\/review-spec-fidelity-sonnet-pr143/);

    sh(s.clone, "git", "push", "-q", "-u", "origin", "claude/review-spec-fidelity-sonnet-pr143");
    stop = fire(s, { hook_event_name: "Stop" });
    assert.equal(stop.code, 0, stop.err);
    assert.match(stop.err, /Review complete/);
  });

  it("releases a guarded Stop whose reason was already delivered", () => {
    const s = stage();
    assert.equal(fire(s, { hook_event_name: "Stop" }).code, 2);
    const again = fire(s, { hook_event_name: "Stop", stop_hook_active: true });
    assert.equal(again.code, 0);
    assert.match(again.err, /released INCOMPLETE — findings-written/);
  });

  it("reports a session its order makes a review", () => {
    const s = stage();
    const r = spawnSync("node", [DRIVER, "--is-review"], {
      input: JSON.stringify({ transcript_path: s.transcript }),
      encoding: "utf8",
      env: { ...process.env, HEARTBEAT_REPO_ROOT: path.join(s.root, "repos"), CCR_TRIGGER_HEAD_REF: ORDER_REF },
    });
    assert.equal(r.status, 0);
  });

  it("ignores a PANDO-REVIEW prompt line: the order is the only receiver", () => {
    const s = stage();
    fs.writeFileSync(s.transcript, `${JSON.stringify({ type: "user", message: { content: PROMPT } })}\n`);
    const none = { CCR_TRIGGER_HEAD_REF: "" };
    assert.equal(fire(s, { hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command: "python3 x.py" } }, none).code, 0);
    assert.equal(fire(s, { hook_event_name: "Stop" }, none).code, 0);
  });

  it("leaves a session without a reviewer order alone", () => {
    const s = stage();
    const none = { CCR_TRIGGER_HEAD_REF: "" };
    assert.equal(fire(s, { hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command: "python3 x.py" } }, none).code, 0);
    assert.equal(fire(s, { hook_event_name: "Stop" }, none).code, 0);
    fs.writeFileSync(s.order, "id: review-spec-fidelity-sonnet-pr143\nrole: implementer\n");
    assert.equal(fire(s, { hook_event_name: "Stop" }).code, 0);
    const r = spawnSync("node", [DRIVER, "--is-review"], {
      input: JSON.stringify({ transcript_path: s.transcript }),
      encoding: "utf8",
      env: { ...process.env, HEARTBEAT_REPO_ROOT: path.join(s.root, "repos"), CCR_TRIGGER_HEAD_REF: "" },
    });
    assert.equal(r.status, 1);
  });

});
