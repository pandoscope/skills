// The review driver's policy katas (skills#195).
//
// Policy verdicts are asserted on wording, not only on allow/deny:
// the reason is what the model acts on,
// and a refusal without the rule and the alternative is what a model routes around.
// The staged session is in test_session.mjs.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import {
  bashVerdict,
  findingsProblems,
  orderRun,
  orderTickets,
  ticketsRead,
  toolVerdict,
} from "../../../original/thread-ledger/review/policy.mjs";
import { HERE, ORDER, ORDER_FILE, ORDER_ID, ORDER_REF, RESULT, RUN, WAYBILL, issueRead } from "./fixtures.mjs";

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
  // #292: a review writes the result file, and no findings file is left to name.
  it("denies sed -i naming the result file, not a findings file", () => {
    const v = bashVerdict("sed -i 's/a/b/' src/x.py", RUN);
    if (v.allow) assert.fail("sed -i should be denied");
    assert.doesNotMatch(v.why, /findings file/);
    assert.ok(v.why.includes(RESULT), v.why);
  });
  it("reads a quoted sed or awk script before allowing it", () => {
    allow("sed -n '10,20p' src/x.py");
    allow("sed -n -e 1p -e '$p' src/x.py");
    allow("sed -n '/^def /,/^$/p' src/x.py");
    allow("sed 's/a/b/g' src/x.py | head");
    allow("awk '{print $1}' src/x.py");
    deny("sed -n '1e id' src/x.py", "sed", "read forms");
    deny("sed 's/a/b/e' src/x.py", "sed", "read forms");
    deny("sed -n 'w out.txt' src/x.py", "sed", "read forms");
    deny("sed -n '1{e id\n}' src/x.py", "sed", "read forms");
    deny("sed -f edit.sed src/x.py", "sed -f");
    deny("awk 'BEGIN{system(\"id\")}'", "awk", "system");
    deny("awk '{print | \"sh\"}' src/x.py", "awk");
  });
  it("allows awk only as a print-only script given inline", () => {
    allow("awk -F: '$3 > 5 {print $1}' src/x.py");
    allow("awk 'NR==1 || /def/ {print NR\": \"$0}' src/x.py");
    deny("awk '{print > f}' src/x.py", "awk", "print-only");
    deny("awk '{printf \"%s\", $0 > out}' src/x.py", "awk", "print-only");
    deny("awk '{\"date\" | getline d}' src/x.py", "awk", "print-only");
    deny("awk 'BEGIN{print ENVIRON[\"GH_TOKEN\"]}'", "awk", "print-only");
    deny("awk -f prog.awk src/x.py", "awk -f");
    deny("awk -i inplace '{print}' src/x.py", "awk -i");
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
  it("denies every git write; the driver publishes the findings", () => {
    deny("git switch -c claude/review-spec-fidelity-sonnet-pr143", "driver commits and pushes");
    deny("git checkout main", "driver commits and pushes");
    deny("git add reviews/spec-fidelity-sonnet", "driver commits and pushes");
    deny("git commit -m 'chore(review): findings'", "driver commits and pushes");
    deny("git push -u origin claude/review-spec-fidelity-sonnet-pr143 2>&1 | tail -5", "driver commits and pushes");
    deny("git reset --hard", "not a read subcommand");
    deny("git branch -D main", "writes");
    deny("git -c core.hooksPath=/dev/null commit -m x", "git -c");
    deny(`git -C ${WAYBILL} commit -m x`, "driver commits and pushes");
    deny(`git -C ${WAYBILL} push origin HEAD:${ORDER_REF}`, "driver commits and pushes");
    deny("git stash push", "writes the working tree");
    deny("git stash", "writes the working tree");
    allow("git stash list");
    deny("git tag v9", "creates a tag");
    allow("git tag -l");
  });
});

// #292: whatever a denial refuses, it names where a review's output goes.
describe("every denial", () => {
  const tools = /** @type {[string, Record<string, any>][]} */ ([
    ["Write", { file_path: "/tmp/notes.md" }],
    ["Edit", { file_path: "/home/user/meta/src/x.py" }],
    ["NotebookEdit", { notebook_path: "/home/user/meta/x.ipynb" }],
    ["Read", { file_path: "/root/.claude/session.env" }],
    ["Agent", { prompt: "run the tests" }],
    ["Artifact", {}],
    ["mcp__github__add_issue_comment", {}],
  ]);
  const commands = [
    "python3 x.py",
    "echo hi > notes.txt",
    "cat /proc/self/environ",
    "sed -i 's/a/b/' src/x.py",
    "sed 's/a/b/w out' src/x.py",
    "sed -f script.sed src/x.py",
    "awk '{ system(\"id\") }' src/x.py",
    "awk -f prog.awk src/x.py",
    "find . -delete",
    "git push",
    "git branch -D main",
    "git config --unset user.name",
    "git reset --hard",
    "git -c core.hooksPath=/dev/null log",
    "git fetch --force origin main",
    "git stash",
    "git tag v9",
  ];
  it("names the result file and the order's branch, never a review branch", () => {
    const denials = [
      ...tools.map(([name, input]) => ({ call: name, v: toolVerdict(name, input, RUN) })),
      ...commands.map((cmd) => ({ call: cmd, v: toolVerdict("Bash", { command: cmd }, RUN) })),
    ];
    for (const { call, v } of denials) {
      if (v.allow) assert.fail(`${call} should be denied`);
      assert.ok(v.why.includes(RESULT), `${call}: ${v.why}`);
      assert.ok(v.why.includes(ORDER_REF), `${call}: ${v.why}`);
      assert.doesNotMatch(v.why, /claude\/review|findings file/, call);
    }
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
  });
  // #292: the result file in the waybill is the one file a review session writes.
  it("allows writing the result file and no other file", () => {
    assert.equal(toolVerdict("Write", { file_path: RESULT }, RUN).allow, true);
    assert.equal(toolVerdict("Edit", { file_path: RESULT }, RUN).allow, true);
    for (const file of [
      "/home/user/meta/reviews/spec-fidelity-sonnet/findings.json",
      "/home/user/meta/src/x.py",
      `/home/user/meta/results/${ORDER_ID}.json`,
      `${WAYBILL}/orders/${ORDER_ID}.yml`,
      `${WAYBILL}/results/review_spec-fidelity_sonnet_meta143_2.json`,
      `${WAYBILL}/results/${ORDER_ID}.json.bak`,
    ]) {
      const v = toolVerdict("Write", { file_path: file }, RUN);
      if (v.allow) assert.fail(`a write to ${file} should be denied`);
      assert.ok(v.why.includes(`The only file a review writes is ${RESULT}`), v.why);
    }
  });
  it("denies forge writes and everything unlisted, naming the alternative", () => {
    for (const name of ["mcp__github__add_issue_comment", "mcp__github__pull_request_review_write", "mcp__github__create_pull_request", "mcp__github__push_files"]) {
      const v = toolVerdict(name, {}, RUN);
      if (v.allow) assert.fail(`${name} should be denied`);
      assert.match(v.why, /posts nothing/);
      assert.ok(v.why.includes(`the driver pushes it on ${ORDER_REF} of the waybill`), v.why);
      assert.doesNotMatch(v.why, /claude\/review/);
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

describe("result contract", () => {
  const good = {
    order_id: ORDER_ID,
    pr: "pandoscope/meta#143",
    head: "22056ce0",
    pass: "spec-fidelity",
    model_tier: "sonnet",
    findings: [{ file: "src/x.py", line: 3, rule: "The parser accepts owner/repo!n references.", input: "owner/repo!7", finding_basis: "decided", confidence: 80, finding: "Bang references raise." }],
  };
  it("accepts the contract and an empty findings array", () => {
    assert.deepEqual(findingsProblems(good, RUN), []);
    assert.deepEqual(findingsProblems({ ...good, findings: [] }, RUN), []);
  });
  it("names every missing field", () => {
    const p = findingsProblems({ ...good, pr: "143", head: "x", model_tier: "opus", findings: [{}] }, RUN);
    assert.match(p.join("\n"), /`pr` must be the pull request, as `owner\/repo#n`/);
    assert.match(p.join("\n"), /`head` must be/);
    assert.match(p.join("\n"), /`model_tier` must be `sonnet`/);
    assert.match(p.join("\n"), /`findings\[0\]\.rule` is missing: the sentence the finding violates/);
    assert.match(p.join("\n"), /`findings\[0\]\.finding_basis` is missing/);
    assert.match(findingsProblems([], RUN)[0], /`the file` must be/);
  });
  // #292: the result names the order it answers.
  it("requires the order's id", () => {
    const { order_id: _, ...without } = good;
    assert.match(findingsProblems(without, RUN).join("\n"), /`order_id` is missing/);
    const foreign = findingsProblems({ ...good, order_id: "review_spec-fidelity_sonnet_meta143_2" }, RUN);
    assert.ok(foreign.includes(`\`order_id\` must be \`${ORDER_ID}\``), foreign.join("\n"));
  });
  // #295: pandoscope 0.5.0 names an order with underscores between its parts;
  // the orders placed before keep their hyphens.
  const opusRun = (/** @type {string} */ id) => {
    const order = `id: ${id}\nrole: reviewer\npass: spec-fidelity\nmodel_tier: opus\n`;
    return /** @type {NonNullable<ReturnType<typeof orderRun>>} */ (orderRun(order, `${WAYBILL}/orders/${id}.yml`));
  };
  const NEW_FORM = "review_spec-fidelity_opus_pando58_1";
  const OLD_FORM = "review-spec-fidelity-opus-pando58-1";
  it("takes an order id of the new form, for an order of that name", () => {
    assert.deepEqual(findingsProblems({ ...good, order_id: NEW_FORM, model_tier: "opus" }, opusRun(NEW_FORM)), []);
  });
  it("takes an order id of the old form, for an order of that name", () => {
    assert.deepEqual(findingsProblems({ ...good, order_id: OLD_FORM, model_tier: "opus" }, opusRun(OLD_FORM)), []);
  });
  it("refuses an order id that differs from the order's only in its separators", () => {
    for (const [id, order] of [[OLD_FORM, NEW_FORM], [NEW_FORM, OLD_FORM]]) {
      const p = findingsProblems({ ...good, order_id: id, model_tier: "opus" }, opusRun(order));
      assert.deepEqual(p, [`\`order_id\` must be \`${order}\``], `${id} for ${order}`);
    }
  });
  // #292: #278 adds the session id, the setup report and the end state to the same object.
  it("accepts a top-level field the contract does not name yet", () => {
    assert.deepEqual(findingsProblems({ ...good, session_id: "s", state: "incomplete" }, RUN), []);
  });
});

describe("order run", () => {
  it("reads pass and model tier from a reviewer order", () => {
    const r = orderRun(ORDER, ORDER_FILE);
    assert.equal(r?.pass, "spec-fidelity");
    assert.equal(r?.modelTier, "sonnet");
  });
  // #292: the result lies beside the order, and travels on the order's branch.
  it("names the order, its branch, the waybill and the result file beside the order", () => {
    assert.equal(RUN.orderId, ORDER_ID);
    assert.equal(RUN.orderBranch, ORDER_REF);
    assert.equal(RUN.waybill, WAYBILL);
    assert.equal(RUN.result, RESULT);
  });
  it("is null for another role, or a reviewer order without pass or model tier", () => {
    assert.equal(orderRun("id: x\nrole: implementer\npull_request: pandoscope/meta#1\n", ORDER_FILE), null);
    assert.equal(orderRun("id: x\nrole: reviewer\nmodel_tier: sonnet\n", ORDER_FILE), null);
    assert.equal(orderRun("id: x\nrole: reviewer\npass: Spec Fidelity\nmodel_tier: sonnet\n", ORDER_FILE), null);
    assert.equal(orderRun("", ORDER_FILE), null);
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

// `tier` alone was ambiguous next to a finding's grade;
// the order and the findings file name the model tier `model_tier`, snake case like `pull_request`.
describe("model tier", () => {
  const order = "id: x\nrole: reviewer\npass: spec-fidelity\nmodel_tier: opus\n";
  it("is read from the order's model_tier", () => {
    assert.equal(orderRun(order, ORDER_FILE)?.modelTier, "opus");
    assert.equal(orderRun("id: x\nrole: reviewer\npass: spec-fidelity\ntier: opus\n", ORDER_FILE), null);
  });
  it("is the findings file's model_tier", () => {
    const run = /** @type {NonNullable<ReturnType<typeof orderRun>>} */ (orderRun(order, ORDER_FILE));
    const doc = { order_id: ORDER_ID, pr: "pandoscope/meta#1", head: "22056ce0", pass: "spec-fidelity", model_tier: "opus", findings: [] };
    assert.deepEqual(findingsProblems(doc, run), []);
    assert.match(findingsProblems({ ...doc, model_tier: "sonnet" }, run).join("\n"), /`model_tier` must be `opus`/);
  });
});

// One schema defines the findings contract (#225). The driver validates
// against it, and the composer renders it into the pass file.
describe("findings schema", () => {
  const file = path.join(HERE, "../../../original/thread-ledger/review/findings.schema.json");
  const good = {
    order_id: ORDER_ID,
    pr: "pandoscope/meta#143",
    head: "22056ce0",
    pass: "spec-fidelity",
    model_tier: "sonnet",
    findings: [{ file: "src/x.py", line: 3, rule: "The parser accepts owner/repo!n references.", input: "owner/repo!7", finding_basis: "decided", confidence: 80, finding: "Bang references raise." }],
  };
  it("is a JSON schema that describes every field", () => {
    const schema = JSON.parse(fs.readFileSync(file, "utf8"));
    assert.equal(schema.$schema, "https://json-schema.org/draft/2020-12/schema");
    const finding = schema.properties.findings.items;
    for (const s of [schema, finding]) {
      for (const [key, prop] of Object.entries(s.properties)) assert.ok(prop.description, key);
    }
  });
  it("rejects a field the schema does not name", () => {
    const extra = { ...good, findings: [{ ...good.findings[0], severity: "high" }] };
    assert.match(findingsProblems(extra, RUN).join("\n"), /severity/);
  });
});

// #292: the documents describe the result on the order's branch, and none the old review branch.
describe("documentation", () => {
  const repo = path.join(HERE, "../../..");
  const REVIEW_BRANCH = /claude\/review-(<pass>|\$\{)|\breview branch\b|reviews\/(<pass>|\{\{|\$\{|spec-fidelity|prose)|\bfindings\.json\b/i;
  it("says nowhere outside the katas that findings travel on a review branch of the reviewed repository", () => {
    const listed = spawnSync("git", ["-C", repo, "ls-files", "-z"], { encoding: "utf8" });
    assert.equal(listed.status, 0, listed.stderr);
    const files = listed.stdout.split("\0").filter((f) => f && !f.startsWith("tests/"));
    /** @type {string[]} */
    const hits = [];
    for (const f of files) {
      // A tracked symlink, such as .claude/skills, points at files this list already holds.
      if (!fs.lstatSync(path.join(repo, f)).isFile()) continue;
      const text = fs.readFileSync(path.join(repo, f), "utf8");
      text.split("\n").forEach((line, i) => {
        if (REVIEW_BRANCH.test(line)) hits.push(`${f}:${i + 1}: ${line.trim()}`);
      });
    }
    assert.deepEqual(hits, []);
  });
  it("SKILL.md describes the result file on the order's branch", () => {
    const skill = fs.readFileSync(path.join(repo, "original/thread-ledger/SKILL.md"), "utf8");
    assert.ok(skill.includes("`results/<order id>.json`"), "names the result file");
    assert.ok(skill.includes("`order/<order id>`"), "names the order's branch");
    assert.ok(skill.includes("pushes nothing to the reviewed repository"), "says the reviewed repository gets nothing");
  });
  // A guarded Stop whose push fails again is released (the staged session's
  // "releases a guarded Stop whose reason was already delivered"); SKILL.md says so.
  it("SKILL.md says a push that keeps failing releases the session INCOMPLETE", () => {
    const skill = fs.readFileSync(path.join(repo, "original/thread-ledger/SKILL.md"), "utf8");
    assert.doesNotMatch(skill, /until the push has landed/);
    assert.match(skill, /push fails again[^.]*released INCOMPLETE/);
  });
  it("every pass file sends the reviewer's output to the result file in the clone of the waybill", () => {
    for (const pass of ["spec-fidelity", "prose"]) {
      const text = fs.readFileSync(path.join(repo, `original/thread-ledger/review/${pass}.md`), "utf8");
      assert.ok(text.includes("`results/<order id>.json` in the clone of the waybill"), pass);
      assert.ok(text.includes("`order_id`"), pass);
    }
  });
});
