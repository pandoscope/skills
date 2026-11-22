// The review driver's staged session (skills#195, skills#292).
//
// The Stop path is staged with real clones and bare origins,
// and walked through every criterion in the order the driver names them.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { bashVerdict, findingsProblems } from "../../../original/thread-ledger/review/policy.mjs";
import { DISPATCH, DRIVER, OLD_ORDER_ID, ORDER, ORDER_ID, ORDER_REF, PROMPT, RESULT, RUN, fire, ghRead, issueRead, origins, placeOrder, refs, resultFor, sessionFor, sh, stage, tip, writeResult } from "./fixtures.mjs";

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
    assert.ok(stop.err.includes(`not complete until the result file ${s.result} exists`), stop.err);
  });

  // #297: the GitHub read tools are retired; a session reads its tickets with `gh api`.
  it("names the gh api read of each unread ticket in the tickets-read reason", () => {
    const s = stage();
    fs.writeFileSync(s.order, `${ORDER}  - pandoscope/waybill#1\n`);
    const stop = fire(s, { hook_event_name: "Stop" });
    assert.equal(stop.code, 2);
    assert.ok(stop.err.includes("gh api repos/pandoscope/waybill/issues/1"), stop.err);
    assert.doesNotMatch(stop.err, /issue read tool/);
    assert.deepEqual(bashVerdict("gh api repos/pandoscope/waybill/issues/1", RUN), { allow: true });
  });

  it("gets past tickets-read on a transcript that reads every ticket through gh api", () => {
    const s = stage();
    fs.writeFileSync(s.order, `${ORDER}  - pandoscope/waybill#1\n`);
    fs.writeFileSync(
      s.transcript,
      `${JSON.stringify({ type: "user", message: { role: "user", content: DISPATCH } })}\n` +
        ghRead("g1", "pandoscope", "skills", 195) +
        ghRead("g2", "pandoscope", "waybill", 1),
    );
    const allowed = fire(s, { hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command: "gh api repos/pandoscope/skills/issues/195" } });
    assert.equal(allowed.code, 0, allowed.err);
    const stop = fire(s, { hook_event_name: "Stop" });
    assert.equal(stop.code, 2);
    assert.doesNotMatch(stop.err, /every ticket the order names/);
    assert.ok(stop.err.includes(`not complete until the result file ${s.result} exists`), stop.err);
    writeResult(s, resultFor(s));
    const done = fire(s, { hook_event_name: "Stop" });
    assert.equal(done.code, 0, done.err);
    assert.match(done.err, /Review complete/);
  });

  it("denies at PreToolUse, logs it, and publishes once the criteria hold", () => {
    const s = stage();
    const denied = fire(s, { hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command: "python3 -m pytest" } });
    assert.equal(denied.code, 2);
    assert.match(denied.err, /python3.*not a read command/);
    assert.match(denied.err, /The denial is logged/);
    const allowed = fire(s, { hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command: "git diff" } });
    assert.equal(allowed.code, 0);
    const write = fire(s, { hook_event_name: "PreToolUse", tool_name: "Write", tool_input: { file_path: s.result } });
    assert.equal(write.code, 0, write.err);

    let stop = fire(s, { hook_event_name: "Stop" });
    assert.equal(stop.code, 2);
    assert.ok(stop.err.includes(`not complete until the result file ${s.result} exists`), stop.err);
    assert.ok(stop.err.includes(`order_id ("${ORDER_ID}")`), stop.err);

    writeResult(s, { ...resultFor(s), findings: "no" });
    stop = fire(s, { hook_event_name: "Stop" });
    assert.equal(stop.code, 2);
    assert.match(stop.err, /`findings` must be an array/);

    writeResult(s, resultFor(s));
    stop = fire(s, { hook_event_name: "Stop" });
    assert.equal(stop.code, 0, stop.err);
    assert.match(stop.err, /Review complete/);
    // The denials and the trace stay in the session (#292).
    const config = path.join(s.home, ".claude");
    const denials = fs.readFileSync(path.join(config, "review-driver.jsonl"), "utf8").split("\n").filter((l) => l.includes('"event":"deny"'));
    assert.equal(denials.length, 1, "one denial");
    assert.match(denials[0], /python3/);
    const trace = JSON.parse(fs.readFileSync(path.join(config, "review-trace.json"), "utf8"));
    assert.equal(trace.calls[0].arg, "git diff");
    assert.equal(trace.usage["claude-sonnet"].input, 10);
  });

  it("releases a guarded Stop whose reason was already delivered", () => {
    const s = stage();
    assert.equal(fire(s, { hook_event_name: "Stop" }).code, 2);
    const again = fire(s, { hook_event_name: "Stop", stop_hook_active: true });
    assert.equal(again.code, 0);
    assert.match(again.err, /released INCOMPLETE — result-written/);
  });

  it("reports a session its order makes a review", () => {
    const s = stage();
    const r = spawnSync("node", [DRIVER, "--is-review"], {
      input: JSON.stringify({ transcript_path: s.transcript }),
      encoding: "utf8",
      env: { ...process.env, HEARTBEAT_REPO_ROOT: s.repos, CCR_TRIGGER_HEAD_REF: s.ref },
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
    fs.writeFileSync(s.order, `id: ${ORDER_ID}\nrole: implementer\n`);
    assert.equal(fire(s, { hook_event_name: "Stop" }).code, 0);
    const r = spawnSync("node", [DRIVER, "--is-review"], {
      input: JSON.stringify({ transcript_path: s.transcript }),
      encoding: "utf8",
      env: { ...process.env, HEARTBEAT_REPO_ROOT: s.repos, CCR_TRIGGER_HEAD_REF: "" },
    });
    assert.equal(r.status, 1);
  });

});

// The reviewer runs no git steps (#224), and the driver publishes the result
// on the order's branch in the waybill, never in the reviewed repository (#292).
describe("driver publishes", () => {
  it("pushes no branch and no commit to the reviewed repository", () => {
    const s = stage();
    const before = refs(s.origins.meta);
    const head = sh(s.clone, "git", "rev-parse", "HEAD");
    writeResult(s, resultFor(s));
    const stop = fire(s, { hook_event_name: "Stop" });
    assert.equal(stop.code, 0, stop.err);
    assert.equal(refs(s.origins.meta), before);
    assert.equal(sh(s.clone, "git", "rev-parse", "HEAD"), head);
    assert.equal(sh(s.clone, "git", "status", "--porcelain"), "");
  });
  it("lands one commit on the order's branch that adds only the result file", () => {
    const s = stage();
    const before = tip(s.origins.waybill, s.ref);
    writeResult(s, resultFor(s));
    const stop = fire(s, { hook_event_name: "Stop" });
    assert.equal(stop.code, 0, stop.err);
    const after = tip(s.origins.waybill, s.ref);
    assert.equal(sh(s.waybill, "git", "fetch", "-q", "origin"), "");
    assert.equal(sh(s.waybill, "git", "rev-list", "--count", `${before}..${after}`), "1");
    assert.equal(sh(s.waybill, "git", "diff", "--name-status", before, after), `A\tresults/${ORDER_ID}.json`);
    assert.equal(sh(s.waybill, "git", "log", "-1", "--format=%s", after), `result: ${ORDER_ID}`);
    // A second Stop finds the result landed and makes no second commit.
    assert.equal(fire(s, { hook_event_name: "Stop" }).code, 0);
    assert.equal(tip(s.origins.waybill, s.ref), after);
  });
  it("pushes one JSON object that names the order and holds the findings, valid against the schema", () => {
    const s = stage();
    const finding = { file: "src/x.py", line: 3, rule: "The parser accepts owner/repo!n references.", input: "owner/repo!7", finding_basis: "decided", confidence: 80, finding: "Bang references raise." };
    writeResult(s, { ...resultFor(s), findings: [finding] });
    assert.equal(fire(s, { hook_event_name: "Stop" }).code, 0);
    sh(s.waybill, "git", "fetch", "-q", "origin");
    const doc = JSON.parse(sh(s.waybill, "git", "show", `origin/${s.ref}:results/${ORDER_ID}.json`));
    assert.equal(doc.order_id, ORDER_ID);
    assert.deepEqual(doc.findings, [finding]);
    assert.deepEqual(findingsProblems(doc, RUN), []);
  });
  it("pushes no file with the session's tool calls", () => {
    const s = stage();
    fire(s, { hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command: "python3 -m pytest" } });
    writeResult(s, resultFor(s));
    assert.equal(fire(s, { hook_event_name: "Stop" }).code, 0);
    const tree = sh(s.waybill, "git", "ls-tree", "-r", "--name-only", tip(s.origins.waybill, s.ref)).split("\n");
    assert.deepEqual(tree.sort(), ["AGENTS.md", `orders/${ORDER_ID}.yml`, `results/${ORDER_ID}.json`]);
    for (const remote of [s.origins.meta, s.origins.waybill]) {
      const all = sh(path.dirname(remote), "git", "--git-dir", remote, "log", "--all", "--name-only", "--format=");
      assert.doesNotMatch(all, /trace\.json|driver\.jsonl/);
    }
  });
  it("lands the results of two orders with the same pass and model tier on one pull request, each on its own order's branch", () => {
    const o = origins();
    const second = "review_spec-fidelity_sonnet_meta143_2";
    placeOrder(o, ORDER_ID);
    placeOrder(o, second);
    for (const id of [ORDER_ID, second]) {
      const s = sessionFor(o, id);
      writeResult(s, resultFor(s));
      const stop = fire(s, { hook_event_name: "Stop" });
      assert.equal(stop.code, 0, `${id}: ${stop.err}`);
    }
    for (const [id, other] of [[ORDER_ID, second], [second, ORDER_ID]]) {
      const tree = sh(o.root, "git", "--git-dir", o.waybill, "ls-tree", "-r", "--name-only", `refs/heads/order/${id}`);
      assert.match(tree, new RegExp(`results/${id}\\.json`));
      assert.doesNotMatch(tree, new RegExp(`results/${other}\\.json`));
    }
  });
  // #295: the order's id is the order file's base name and is never split,
  // so an id of either name form lands its result on its own order's branch.
  for (const id of ["review_spec-fidelity_opus_pando58_1", OLD_ORDER_ID]) {
    it(`lands the result of order ${id} on order/${id}`, () => {
      const o = origins();
      placeOrder(o, id);
      const s = sessionFor(o, id);
      const before = tip(o.waybill, `order/${id}`);
      writeResult(s, resultFor(s));
      const stop = fire(s, { hook_event_name: "Stop" });
      assert.equal(stop.code, 0, stop.err);
      const after = tip(o.waybill, `order/${id}`);
      assert.equal(sh(s.waybill, "git", "fetch", "-q", "origin"), "");
      assert.equal(sh(s.waybill, "git", "diff", "--name-status", before, after), `A\tresults/${id}.json`);
      assert.equal(JSON.parse(sh(s.waybill, "git", "show", `${after}:results/${id}.json`)).order_id, id);
    });
  }
  it("keeps the session from ending while the push fails, naming the waybill and the order's branch", () => {
    const s = stage();
    const hook = path.join(s.origins.waybill, "hooks", "pre-receive");
    fs.writeFileSync(hook, "#!/bin/sh\necho refused by the kata >&2\nexit 1\n", { mode: 0o755 });
    writeResult(s, resultFor(s));
    const stop = fire(s, { hook_event_name: "Stop" });
    assert.equal(stop.code, 2);
    assert.ok(stop.err.includes(`to ${s.ref} of the waybill`), stop.err);
    assert.ok(stop.err.includes(s.waybill), stop.err);
    assert.match(stop.err, /refused by the kata/);
    fs.rmSync(hook);
    const retry = fire(s, { hook_event_name: "Stop" });
    assert.equal(retry.code, 0, retry.err);
    const after = tip(s.origins.waybill, s.ref);
    assert.equal(sh(s.waybill, "git", "diff", "--name-status", `${after}~1`, after), `A\tresults/${ORDER_ID}.json`);
  });
  it("releases INCOMPLETE a guarded Stop whose push fails again, with no result on the order's branch", () => {
    const s = stage();
    const before = tip(s.origins.waybill, s.ref);
    fs.writeFileSync(path.join(s.origins.waybill, "hooks", "pre-receive"), "#!/bin/sh\nexit 1\n", { mode: 0o755 });
    writeResult(s, resultFor(s));
    assert.equal(fire(s, { hook_event_name: "Stop" }).code, 2);
    const again = fire(s, { hook_event_name: "Stop", stop_hook_active: true });
    assert.equal(again.code, 0);
    assert.match(again.err, /released INCOMPLETE — result-pushed/);
    assert.equal(tip(s.origins.waybill, s.ref), before);
  });
  it("lands one result commit when the result file changes between a refused push and the retry", () => {
    const s = stage();
    const before = tip(s.origins.waybill, s.ref);
    const hook = path.join(s.origins.waybill, "hooks", "pre-receive");
    fs.writeFileSync(hook, "#!/bin/sh\necho refused by the kata >&2\nexit 1\n", { mode: 0o755 });
    writeResult(s, resultFor(s));
    assert.equal(fire(s, { hook_event_name: "Stop" }).code, 2);
    fs.rmSync(hook);
    const finding = { file: "src/x.py", line: 3, rule: "The parser accepts owner/repo!n references.", input: "owner/repo!7", finding_basis: "decided", confidence: 80, finding: "Bang references raise." };
    writeResult(s, { ...resultFor(s), findings: [finding] });
    const retry = fire(s, { hook_event_name: "Stop", stop_hook_active: true });
    assert.equal(retry.code, 0, retry.err);
    const after = tip(s.origins.waybill, s.ref);
    sh(s.waybill, "git", "fetch", "-q", "origin");
    assert.equal(sh(s.waybill, "git", "rev-list", "--count", `${before}..${after}`), "1");
    assert.equal(sh(s.waybill, "git", "diff", "--name-status", before, after), `A\tresults/${ORDER_ID}.json`);
    assert.deepEqual(JSON.parse(sh(s.waybill, "git", "show", `${after}:results/${ORDER_ID}.json`)).findings, [finding]);
  });
  it("denies the reviewer every git write", () => {
    for (const cmd of [
      "git switch -c claude/review-spec-fidelity-sonnet-pr143",
      "git add reviews/spec-fidelity-sonnet",
      "git commit -m x",
      "git push -u origin claude/review-spec-fidelity-sonnet-pr143",
    ]) {
      const v = bashVerdict(cmd, RUN);
      assert.equal(v.allow, false, cmd);
      assert.match(v.allow ? "" : v.why, /driver (commits|publishes)/, cmd);
    }
  });
  // #292: the reason names where the result goes, never a review branch.
  it("names the result file and the order's branch when it denies a git write", () => {
    const v = bashVerdict("git push", RUN);
    if (v.allow) assert.fail("git push should be denied");
    assert.ok(v.why.includes(`The driver commits and pushes ${RESULT} on ${ORDER_REF} at Stop`), v.why);
    assert.doesNotMatch(v.why, /claude\/review/);
  });
});

// #297: the driver always publishes a result.
// A run released with a completion check unmet pushes a result that says so,
// names the check and lists the calls the policy denied.
describe("a review released incomplete", () => {
  /** @param {ReturnType<typeof stage>} s */
  const pushed = (s) => {
    sh(s.waybill, "git", "fetch", "-q", "origin");
    return JSON.parse(sh(s.waybill, "git", "show", `origin/${s.ref}:results/${s.id}.json`));
  };
  const finding = { file: "src/x.py", line: 3, rule: "The parser accepts owner/repo!n references.", input: "owner/repo!7", finding_basis: "decided", confidence: 80, finding: "Bang references raise." };
  /** @type {[string, (s: ReturnType<typeof stage>) => string | null][]} */
  const cases = [
    [
      "tickets-read",
      (s) => {
        fs.writeFileSync(s.order, `${ORDER}  - pandoscope/waybill#1\n`);
        const text = JSON.stringify({ ...resultFor(s), findings: [finding] });
        fs.mkdirSync(path.dirname(s.result), { recursive: true });
        fs.writeFileSync(s.result, text);
        return text;
      },
    ],
    ["result-written", () => null],
    [
      "result-valid",
      (s) => {
        fs.mkdirSync(path.dirname(s.result), { recursive: true });
        fs.writeFileSync(s.result, "{ not json");
        return "{ not json";
      },
    ],
  ];
  for (const [check, unmet] of cases) {
    it(`pushes a result that says the review did not complete, when ${check} stays unmet up to the loop guard`, () => {
      const s = stage();
      const before = tip(s.origins.waybill, s.ref);
      const written = unmet(s);
      assert.equal(fire(s, { hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command: "python3 -m pytest" } }).code, 2);
      const first = fire(s, { hook_event_name: "Stop" });
      assert.equal(first.code, 2);
      const released = fire(s, { hook_event_name: "Stop", stop_hook_active: true });
      assert.equal(released.code, 0, released.err);
      assert.match(released.err, new RegExp(`released INCOMPLETE — ${check}`));
      assert.ok(released.err.includes(`pushed on ${s.ref} of the waybill`), released.err);
      const after = tip(s.origins.waybill, s.ref);
      assert.equal(sh(s.waybill, "git", "rev-list", "--count", `${before}..${after}`), "1");
      assert.equal(sh(s.waybill, "git", "diff", "--name-status", before, after), `A\tresults/${ORDER_ID}.json`);
      const doc = pushed(s);
      assert.equal(doc.order_id, ORDER_ID);
      assert.equal(doc.state, "incomplete");
      assert.equal(doc.unmet.check, check);
      assert.equal(typeof doc.unmet.detail, "string");
      assert.equal(doc.denied.length, 1);
      assert.equal(doc.denied[0].tool, "Bash");
      assert.match(doc.denied[0].arg, /python3 -m pytest/);
      assert.match(doc.denied[0].why, /not a read command/);
      assert.equal(doc.reviewer_file, written);
      // Not to be taken for a completed review with no findings:
      // no findings array, and the contract refuses it.
      assert.equal("findings" in doc, false);
      assert.notDeepEqual(findingsProblems(doc, RUN), []);
    });
  }
  it("names the tickets-read detail in the pushed result", () => {
    const s = stage();
    fs.writeFileSync(s.order, `${ORDER}  - pandoscope/waybill#1\n`);
    assert.equal(fire(s, { hook_event_name: "Stop" }).code, 2);
    assert.equal(fire(s, { hook_event_name: "Stop", stop_hook_active: true }).code, 0);
    assert.match(pushed(s).unmet.detail, /pandoscope\/waybill#1/);
    assert.deepEqual(pushed(s).denied, []);
  });
  it("lists only this session's denials", () => {
    const s = stage();
    fire(s, { hook_event_name: "PreToolUse", session_id: "other", tool_name: "Bash", tool_input: { command: "python3 other.py" } });
    fire(s, { hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command: "python3 mine.py" } });
    assert.equal(fire(s, { hook_event_name: "Stop" }).code, 2);
    assert.equal(fire(s, { hook_event_name: "Stop", stop_hook_active: true }).code, 0);
    const denied = pushed(s).denied;
    assert.equal(denied.length, 1);
    assert.match(denied[0].arg, /mine\.py/);
  });
  it("says so when the push of the incomplete result does not land either", () => {
    const s = stage();
    const before = tip(s.origins.waybill, s.ref);
    fs.writeFileSync(path.join(s.origins.waybill, "hooks", "pre-receive"), "#!/bin/sh\necho refused by the kata >&2\nexit 1\n", { mode: 0o755 });
    assert.equal(fire(s, { hook_event_name: "Stop" }).code, 2);
    const released = fire(s, { hook_event_name: "Stop", stop_hook_active: true });
    assert.equal(released.code, 0);
    assert.match(released.err, /released INCOMPLETE — result-written/);
    assert.match(released.err, /incomplete result did not land/);
    assert.match(released.err, /refused by the kata/);
    assert.equal(tip(s.origins.waybill, s.ref), before);
  });
});
