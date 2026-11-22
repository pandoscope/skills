// The review policy's `gh api` katas (skills#297).
//
// The GitHub read tools are retired, so a review reads the forge with `gh api`:
// a GET of a fixed set of REST paths, and the ticket reads among them count for the Stop check.

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { bashVerdict, ticketsRead } from "../../../original/thread-ledger/review/policy.mjs";
import { RUN, bashCall, ghRead, issueRead } from "./fixtures.mjs";

// #297: the GitHub read tools are retired, and `gh api` is how a review reads the forge.
// Decision 165 allows a GET of seven REST paths below repos/<owner>/<repo>/ and nothing else.
describe("gh api reads", () => {
  /** @param {string} cmd */
  const allow = (cmd) => assert.deepEqual(bashVerdict(cmd, RUN), { allow: true }, cmd);
  /** @param {string} cmd @param {...string} words */
  const deny = (cmd, ...words) => {
    const v = bashVerdict(cmd, RUN);
    if (v.allow) assert.fail(`${cmd} should be denied`);
    for (const w of words) assert.match(v.why, new RegExp(w), `${cmd}: ${v.why}`);
  };
  it("allows a ticket read", () => {
    allow("gh api repos/pandoscope/skills/issues/297");
  });
  it("allows a GET of every path in the allowed set", () => {
    for (const p of [
      "issues/297",
      "issues/297/comments",
      "pulls/129",
      "pulls/129/files",
      "pulls/129/comments",
      "pulls/129/reviews",
      "commits/244259373a2300f03d4eb1d9236a795dd2bdda4b/check-runs",
      "commits/2442593/check-runs",
    ]) {
      allow(`gh api repos/pandoscope/waybill/${p}`);
      allow(`gh api /repos/pandoscope/waybill/${p}`);
    }
  });
  it("allows a query string, output flags and a pipe into a read command", () => {
    allow("gh api 'repos/pandoscope/waybill/pulls/129/files?per_page=100&page=1'");
    allow("gh api repos/pandoscope/skills/issues/297 --jq '{title,body}'");
    allow("gh api -q .body repos/pandoscope/skills/issues/297");
    allow("gh api --paginate repos/pandoscope/skills/issues/297/comments");
    allow("gh api --hostname github.com repos/pandoscope/waybill/pulls/129");
    allow("gh api repos/pandoscope/skills/issues/297 | jq -r .body | head -40");
  });
  it("denies a call that sets a method, with -X, --method or another method", () => {
    deny("gh api -X POST repos/pandoscope/skills/issues/297/comments", "sets the method", "GET");
    deny("gh api -XPATCH repos/pandoscope/skills/issues/297", "sets the method");
    deny("gh api --method DELETE repos/pandoscope/skills/issues/297", "sets the method");
    deny("gh api --method=PUT repos/pandoscope/skills/pulls/1", "sets the method");
    deny("gh api -X GET repos/pandoscope/skills/issues/297", "sets the method");
  });
  it("denies a call that sets a field, with -f or -F", () => {
    deny("gh api repos/pandoscope/skills/issues/297 -f state=closed", "sets a field");
    deny("gh api repos/pandoscope/skills/issues/297 -F state=closed", "sets a field");
    deny("gh api repos/pandoscope/skills/issues/297 --field state=closed", "sets a field");
    deny("gh api repos/pandoscope/skills/issues/297 --raw-field body=x", "sets a field");
    deny("gh api repos/pandoscope/skills/issues/297 -fstate=closed", "sets a field");
  });
  it("denies a call that sends a body, with --input", () => {
    deny("gh api repos/pandoscope/skills/issues/297 --input body.json", "sends a body");
    deny("gh api repos/pandoscope/skills/issues/297 --input=-", "sends a body");
  });
  it("denies a flag outside the read flags", () => {
    deny("gh api -H 'X-HTTP-Method-Override: DELETE' repos/pandoscope/skills/issues/297", "-H");
    deny("gh api --preview x repos/pandoscope/skills/issues/297", "--preview");
  });
  it("denies a path outside the allowed set", () => {
    for (const p of [
      "repos/pandoscope/skills/issues",
      "repos/pandoscope/skills/issues/297/labels",
      "repos/pandoscope/skills/issues/comments/5",
      "repos/pandoscope/skills/pulls/1/merge",
      "repos/pandoscope/skills/contents/README.md",
      "repos/pandoscope/skills/actions/runs/1/logs",
      "repos/pandoscope/skills/commits/HEAD/check-runs",
      "repos/{owner}/{repo}/issues/297",
      "repos/pandoscope/skills/issues/297/../../pulls/1/merge",
      "graphql",
      "user",
    ]) {
      deny(`gh api ${p}`, "outside the paths", "issues/<n>");
    }
    deny("gh api repos/pandoscope/skills/issues/1 repos/pandoscope/skills/pulls/1/merge", "one path");
    deny("gh api", "one path");
  });
  it("denies every other gh command", () => {
    deny("gh pr view 1", "gh api");
    deny("gh issue view 297", "gh api");
    deny("gh auth token", "gh api");
    deny("gh", "gh api");
  });
  it("denies a pipe into a command that is not allowed", () => {
    deny("gh api repos/pandoscope/skills/issues/297 | sh", "`sh` is not a read command");
    deny("gh api repos/pandoscope/skills/issues/297 | xargs rm", "xargs");
  });
  it("names the command a review reads a ticket with when it denies a gh call", () => {
    for (const cmd of ["gh issue view 297", "gh api -X POST repos/a/b/issues/1", "gh api user"]) {
      const v = bashVerdict(cmd, RUN);
      if (v.allow) assert.fail(`${cmd} should be denied`);
      assert.ok(v.why.includes("gh api repos/<owner>/<repo>/issues/<n>"), v.why);
    }
  });
});

// #297: a ticket read through `gh api` counts, beside the issue read tool.
describe("tickets read through gh api", () => {
  it("counts a gh api read of the ticket that succeeded, lowercase", () => {
    const text = ghRead("a", "Pandoscope", "Skills", 297) + bashCall("b", "gh api /repos/pandoscope/waybill/issues/1 --jq .body");
    assert.deepEqual([...ticketsRead(text)].sort(), ["pandoscope/skills#297", "pandoscope/waybill#1"]);
  });
  it("still counts a successful issue_read", () => {
    const text = ghRead("a", "pandoscope", "skills", 297) + issueRead("b", "pandoscope", "meta", 52);
    assert.deepEqual([...ticketsRead(text)].sort(), ["pandoscope/meta#52", "pandoscope/skills#297"]);
  });
  it("counts every read of a command whose calls must all succeed", () => {
    const text = bashCall("a", "cd /home/user && gh api repos/pandoscope/skills/issues/297 && gh api 'repos/pandoscope/meta/issues/52?x=1'");
    assert.deepEqual([...ticketsRead(text)].sort(), ["pandoscope/meta#52", "pandoscope/skills#297"]);
  });
  it("does not count a failed gh api call", () => {
    assert.deepEqual([...ticketsRead(ghRead("a", "pandoscope", "skills", 297, true))], []);
  });
  // A command's exit is its last pipeline's, and a pipeline's is its last command's:
  // a read whose failure would not reach the result is not known to have succeeded.
  it("does not count a read whose failure the command's exit would hide", () => {
    for (const cmd of [
      "gh api repos/pandoscope/skills/issues/297 | jq -r .body",
      "gh api repos/pandoscope/skills/issues/297; true",
      "gh api repos/pandoscope/skills/issues/297 || true",
      "true || gh api repos/pandoscope/skills/issues/297",
      "gh api repos/pandoscope/skills/issues/297 & wait",
      "echo $(gh api repos/pandoscope/skills/issues/297)",
      "echo `gh api repos/pandoscope/skills/issues/297`",
    ]) {
      assert.deepEqual([...ticketsRead(bashCall("a", cmd))], [], cmd);
    }
  });
  it("counts a read that a stderr redirect or a sequence before it leaves in charge of the exit", () => {
    for (const cmd of [
      "gh api repos/pandoscope/skills/issues/297 2>&1",
      "cd /home/user; gh api repos/pandoscope/skills/issues/297",
      "echo start | gh api repos/pandoscope/skills/issues/297",
    ]) {
      assert.deepEqual([...ticketsRead(bashCall("a", cmd))], ["pandoscope/skills#297"], cmd);
    }
  });
  it("does not count a path other than the ticket's, or a call the policy denies", () => {
    for (const cmd of [
      "gh api repos/pandoscope/skills/issues/297/comments",
      "gh api repos/pandoscope/skills/pulls/297",
      "gh api -X PATCH repos/pandoscope/skills/issues/297",
      "gh api repos/pandoscope/skills/issues/297 -f state=open",
      "gh issue view 297 -R pandoscope/skills",
      "echo gh api repos/pandoscope/skills/issues/297",
    ]) {
      assert.deepEqual([...ticketsRead(bashCall("a", cmd))], [], cmd);
    }
  });
});
