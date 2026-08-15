// Tests for the grilling renderer CLI (derived/grilling/render/render.ts).
// The CLI is the public interface: every test drives it end to end.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, cpSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const RENDER_TS = join(HERE, "../../../derived/grilling/render/render.ts");
const FIXTURES = join(HERE, "fixtures");

// Strict expected-failure helper for node:test (no built-in xfail):
// the test PASSES only while its body fails; an unexpectedly passing
// body fails the suite, same contract as vitest's test.fails.
const red = {
  fails(name, fn) {
    test(name, async () => {
      try {
        await fn();
      } catch {
        return;
      }
      throw new Error("red test unexpectedly passed — implement the behavior and unmark");
    });
  },
};

/**
 * Run the renderer CLI on a session file.
 *
 * @param {string} sessionPath - Path to the grilling-session JSON file.
 * @returns {{status: number, stderr: string, outDir: string}} Exit code,
 *   captured stderr, and the fresh output directory used.
 */
function render(sessionPath) {
  const outDir = mkdtempSync(join(tmpdir(), "grilling-render-"));
  try {
    execFileSync(
      process.execPath,
      ["--experimental-strip-types", "--disable-warning=ExperimentalWarning", RENDER_TS, sessionPath, "--out", outDir],
      { encoding: "utf8" },
    );
    return { status: 0, stderr: "", outDir };
  } catch (e) {
    return { status: e.status ?? 1, stderr: String(e.stderr ?? ""), outDir };
  }
}

/**
 * Extract the injected session JSON from rendered artifact HTML.
 *
 * @param {string} html - Contents of session.html.
 * @returns {string} The raw JSON text inside the data script tag.
 */
function embeddedJson(html) {
  const m = html.match(/<script type="application\/json" id="decision-context">([\s\S]*?)<\/script>/);
  assert.ok(m, "session.html carries no decision-context data script tag");
  return m[1];
}

/**
 * Write a grilling-session object to a temp file.
 *
 * @param {object} session - The session to serialize.
 * @returns {string} Path of the written JSON file.
 */
function sessionFile(session) {
  const dir = mkdtempSync(join(tmpdir(), "grilling-session-"));
  const path = join(dir, "session.json");
  writeFileSync(path, JSON.stringify(session));
  return path;
}

/** The valid session fixture, freshly parsed for mutation. */
function validSession() {
  return JSON.parse(readFileSync(join(FIXTURES, "session.json"), "utf8"));
}

test("valid session renders artifact html with injected JSON and a text fallback", () => {
  const fixture = join(FIXTURES, "session.json");
  const { status, stderr, outDir } = render(fixture);
  assert.equal(status, 0, `renderer failed: ${stderr}`);

  const html = readFileSync(join(outDir, "session.html"), "utf8");
  assert.deepEqual(
    JSON.parse(embeddedJson(html)),
    JSON.parse(readFileSync(fixture, "utf8")),
    "injected JSON must round-trip to the input session",
  );

  const md = readFileSync(join(outDir, "session.md"), "utf8");
  assert.match(md, /^## S1Q1 — Which database backs the session store\?$/m, "SxQy question heading missing");
  assert.match(md, /^## S1Q2 — Where does the grilling renderer live\?$/m, "second question missing");
  assert.match(md, /^A1\. \*\*Postgres\*\*/m, "A-numbered slot line missing");
  assert.match(md, /^A3\. \*\*Something else…\*\*/m, "renderer must append the free-text slot itself, labeled Something else…");
});

test("every slot carries at least one compact tag", () => {
  const { status, stderr, outDir } = render(join(FIXTURES, "session.json"));
  assert.equal(status, 0, `renderer failed: ${stderr}`);
  const md = readFileSync(join(outDir, "session.md"), "utf8");
  assert.match(md, /\(matches 1, my pick\)/, "merged slot must tag matches count and my pick");
  assert.match(md, /\(my pick, cold\)/, "cold pick must tag my pick and cold");
  assert.match(md, /\(wildcard, if single-writer stays guaranteed\)/, "wildcard tag missing");
  assert.match(md, /\(alternative, if other skills need the renderer too\)/, "untagged runner-up must tag alternative");
  assert.match(md, /\*\*Something else…\*\* \(free text\)/, "free-text slot label must not duplicate its tag");
  assert.doesNotMatch(md, /prediction — |recommendation — /, "verbose badge wording must be gone");
  assert.match(md, /"N, BAB …"/, "answer hint must offer the BAB shorthand");
});

red.fails("matched preferences become footnote refs resolving to ranked lineage entries", () => {
  const { status, stderr, outDir } = render(join(FIXTURES, "session.json"));
  assert.equal(status, 0, `renderer failed: ${stderr}`);
  const md = readFileSync(join(outDir, "session.md"), "utf8");
  assert.match(md, /ships to consumers via skills update, no extra install \[1\]/, "footnote marker missing after entails");
  assert.match(
    md,
    /\[1\] \[tools-travel-with-their-skill\]\([^)]+\) \(rank 1, weight 67%\) — matched: renderer is skill-local tooling/,
    "footnote entry must carry rank, ROC weight, and the lineage disposition",
  );
  assert.doesNotMatch(md, /`tools-travel-with-their-skill`/, "full rule text must no longer be inlined in the prose");
});

test("options carry normalized scores with a per-contribution breakdown", () => {
  const { status, stderr, outDir } = render(join(FIXTURES, "session.json"));
  assert.equal(status, 0, `renderer failed: ${stderr}`);
  const md = readFileSync(join(outDir, "session.md"), "utf8");
  // S1Q2: A1 matches rank-1 pref (ROC weight 0.75); A2 has agentScore 0.3
  // capped by the top weight (0.3 * 0.75) -> 77% vs 23%.
  assert.match(md, /score 77% \(tools-travel-with-their-skill 77%\)/, "preference-driven score missing");
  assert.match(md, /score 23% \(my judgment 23%\)/, "agent-judgment score missing");
  // S1Q1 (cold): agent scores only, 0.6 vs 0.2 -> 75% / 25%.
  assert.match(md, /score 75% \(my judgment 75%\)/, "cold agent score missing");
  assert.match(md, /proposed preference: a renderer used by two skills graduates to its own package/, "proposed preference missing");
  // S1Q3: noneScore 0.3 is the only contribution, so the free-text slot
  // carries the full residual "none of the listed answers fit" score.
  assert.match(
    md,
    /\*\*Something else…\*\* \(free text\) — custom choice or custom rejection reasoning — score 100% \(my judgment 100%\)/,
    "noneScore must score the free-text slot",
  );
});

red.fails("preference doc links render in the lineage footnotes", () => {
  const { status, stderr, outDir } = render(join(FIXTURES, "session.json"));
  assert.equal(status, 0, `renderer failed: ${stderr}`);
  const md = readFileSync(join(outDir, "session.md"), "utf8");
  assert.match(
    md,
    /\[1\] \[tools-travel-with-their-skill\]\(https:\/\/github\.com\/pandoscope\/decision-memory\/blob\/main\/proposals\/tools-travel-with-their-skill\.md\) \(rank 1, weight 67%\)/,
    "footnote must link the preference's promotion doc when a link is recorded",
  );
});

test("answer state is displayed: chosen free text with rejection reasons, and skips", () => {
  const { status, stderr, outDir } = render(join(FIXTURES, "session.json"));
  assert.equal(status, 0, `renderer failed: ${stderr}`);
  const md = readFileSync(join(outDir, "session.md"), "utf8");
  assert.match(md, /S1Q1A3: DuckDB, we already embed it elsewhere/, "free-text ruling missing");
  assert.match(md, /Rejected: single-writer stays guaranteed/, "rejection reason missing");
  assert.match(md, /S1Q3: skipped/, "skip state missing");
  assert.match(md, /Disconfirmed: prefer-boring-tech/, "disconfirmed-rule display missing");
});

test("rejects sessions violating the schema, naming the offending field", () => {
  const cases = [
    ["version 1 document", (s) => (s.version = 1), /version.*1/],
    ["missing session number", (s) => delete s.session, /session/],
    ["empty questions", (s) => (s.questions = []), /questions/],
    ["duplicate seq", (s) => (s.questions[1].seq = 1), /seq/],
    ["missing question text", (s) => delete s.questions[0].question, /questions\[0\].question/],
    ["unknown kind", (s) => (s.questions[0].options[0].kind = "maybe"), /questions\[0\].options\[0\].kind.*maybe/],
    ["missing lineage", (s) => delete s.questions[0].lineage, /questions\[0\].lineage/],
    [
      "cold contradicted by a usual slot",
      (s) => {
        s.questions[0].options[0].kind = "usual";
        s.questions[0].options[0].matches = ["prefer-boring-tech"];
      },
      /cold/,
    ],
    [
      "usual slot without matched preferences",
      (s) => {
        s.questions[0].lineage.cold = false;
        s.questions[0].options[0].kind = "usual";
      },
      /matches/,
    ],
    [
      "cold question with a matching option",
      (s) => (s.questions[0].options[1].matches = ["prefer-boring-tech"]),
      /cold/,
    ],
    [
      "wildcard citing matches",
      (s) => {
        s.questions[1].options[1].kind = "wildcard";
        s.questions[1].options[1].matches = ["prefer-boring-tech"];
      },
      /wildcard/,
    ],
    [
      "match naming an unknown preference",
      (s) => (s.questions[1].options[0].matches = ["no-such-preference"]),
      /matches.*no-such-preference/,
    ],
    [
      "second prediction-role slot",
      (s) => {
        s.questions[1].options[1].kind = "usual";
        s.questions[1].options[1].matches = ["prefer-boring-tech"];
      },
      /prediction/,
    ],
    [
      "disconfirming an unknown preference",
      (s) => (s.questions[0].answer.disconfirmedPreferences = ["no-such-rule"]),
      /disconfirmedPreferences.*no-such-rule/,
    ],
    [
      "agent score out of range",
      (s) => (s.questions[0].options[0].agentScore = 1.5),
      /agentScore.*1\.5/,
    ],
    [
      "near-tie pointing at a missing slot",
      (s) => (s.questions[0].nearTie = { slots: [1, 7], differsOn: "ops" }),
      /nearTie/,
    ],
    ["chosen slot out of range", (s) => (s.questions[0].answer.chosen = 9), /chosen.*9/],
    ["unknown field (typo'd ifClause)", (s) => (s.questions[0].options[1].ifclause = "typo"), /ifclause/],
    ["unknown top-level field", (s) => (s.decider = "me"), /decider/],
    [
      "skipped answer carrying a choice",
      (s) => (s.questions[2].answer = { skipped: true, chosen: 1 }),
      /skipped.*chosen|chosen.*skipped/,
    ],
    [
      "free-text slot chosen without the text",
      (s) => delete s.questions[0].answer.freeText,
      /freeText/,
    ],
    [
      "orphaned freeText on a listed slot",
      (s) => (s.questions[0].answer.chosen = 1),
      /freeText/,
    ],
    ["near-tie of a slot with itself", (s) => (s.questions[1].nearTie = { slots: [1, 1], differsOn: "x" }), /nearTie/],
    ["seq gap", (s) => (s.questions[2].seq = 5), /seq.*3/],
    [
      "prediction-role slot not in slot 1",
      (s) => s.questions[1].options.reverse(),
      /slot 1/,
    ],
    [
      "wildcard without an if-clause",
      (s) => delete s.questions[0].options[1].ifClause,
      /ifClause/,
    ],
    [
      "duplicate option labels",
      (s) => (s.questions[0].options[1].label = "Postgres"),
      /label.*Postgres/,
    ],
    [
      "duplicate matches entries",
      (s) => (s.questions[1].options[0].matches = ["tools-travel-with-their-skill", "tools-travel-with-their-skill"]),
      /matches/,
    ],
    ["duplicate preferences", (s) => s.preferences.push("prefer-boring-tech"), /preferences/],
    [
      "unbalanced backticks in entails",
      (s) => (s.questions[0].options[0].entails = "reuse `ops tooling"),
      /backtick/,
    ],
    [
      "considered rule outside the active set",
      (s) => (s.questions[0].lineage.rulesConsidered[0].name = "ghost-rule"),
      /rulesConsidered.*ghost-rule/,
    ],
    ["noneScore out of range", (s) => (s.questions[0].noneScore = 1.5), /noneScore.*1\.5/],
    [
      "preference doc for an unknown preference",
      (s) => (s.preferenceDocs = { "ghost-rule": "https://example.com" }),
      /preferenceDocs.*ghost-rule/,
    ],
    [
      "matched preference missing from rulesConsidered",
      (s) => (s.questions[1].lineage.rulesConsidered = []),
      /rulesConsidered/,
    ],
  ];
  for (const [name, mutate, expected] of cases) {
    const session = validSession();
    mutate(session);
    const { status, stderr } = render(sessionFile(session));
    assert.equal(status, 1, `${name}: expected rejection, got exit ${status}`);
    assert.match(stderr, expected, `${name}: error does not name the field/value`);
  }
});

// Guard, not a red-cycle behavior: template.html is generated (declared
// managed duplication); this pins it to a rebuild of its sources.
test("committed template.html is the build output of its sources", () => {
  const renderDir = dirname(RENDER_TS);
  const tmp = mkdtempSync(join(tmpdir(), "grilling-template-check-"));
  cpSync(renderDir, tmp, { recursive: true });
  execFileSync(
    process.execPath,
    ["--experimental-strip-types", "--disable-warning=ExperimentalWarning", join(tmp, "build.ts")],
    { encoding: "utf8" },
  );
  assert.equal(
    readFileSync(join(renderDir, "template.html"), "utf8"),
    readFileSync(join(tmp, "template.html"), "utf8"),
    "template.html is stale — rebuild via make grilling-template",
  );
});
