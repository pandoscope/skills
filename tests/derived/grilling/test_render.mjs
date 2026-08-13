// Tests for the grilling renderer CLI (derived/grilling/render/render.ts).
// The CLI is the public interface: every test drives it end to end.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from "node:fs";
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
 * Run the renderer CLI on a context file.
 *
 * @param {string} contextPath - Path to the decision-context JSON file.
 * @returns {{status: number, stderr: string, outDir: string}} Exit code,
 *   captured stderr, and the fresh output directory used.
 */
function render(contextPath) {
  const outDir = mkdtempSync(join(tmpdir(), "grilling-render-"));
  try {
    execFileSync(
      process.execPath,
      ["--experimental-strip-types", "--disable-warning=ExperimentalWarning", RENDER_TS, contextPath, "--out", outDir],
      { encoding: "utf8" },
    );
    return { status: 0, stderr: "", outDir };
  } catch (e) {
    return { status: e.status ?? 1, stderr: String(e.stderr ?? ""), outDir };
  }
}

/**
 * Extract the injected decision-context JSON from rendered artifact HTML.
 *
 * @param {string} html - Contents of question.html.
 * @returns {string} The raw JSON text inside the data script tag.
 */
function embeddedJson(html) {
  const m = html.match(/<script type="application\/json" id="decision-context">([\s\S]*?)<\/script>/);
  assert.ok(m, "question.html carries no decision-context data script tag");
  return m[1];
}

/**
 * Write a decision-context object to a temp file.
 *
 * @param {object} ctx - The context to serialize.
 * @returns {string} Path of the written JSON file.
 */
function contextFile(ctx) {
  const dir = mkdtempSync(join(tmpdir(), "grilling-ctx-"));
  const path = join(dir, "context.json");
  writeFileSync(path, JSON.stringify(ctx));
  return path;
}

/** A minimal valid cold context to mutate in validation tests. */
function validContext() {
  return JSON.parse(readFileSync(join(FIXTURES, "valid-cold.json"), "utf8"));
}

test("rejects contexts violating the schema, naming the offending field", () => {
  const cases = [
    ["question", (ctx) => delete ctx.question, /question/],
    ["version", (ctx) => (ctx.version = 2), /version.*2/],
    ["empty options", (ctx) => (ctx.options = []), /options/],
    ["too many options", (ctx) => (ctx.options = Array(4).fill(ctx.options[0])), /options/],
    ["unknown kind", (ctx) => (ctx.options[0].kind = "maybe"), /kind.*maybe/],
    ["missing lineage", (ctx) => delete ctx.lineage, /lineage/],
    [
      "cold contradicted by a usual slot",
      (ctx) => {
        ctx.options[0].kind = "usual";
        ctx.options[0].citesRules = ["prefer-boring-tech"];
      },
      /cold/,
    ],
    ["usual slot without cited rules", (ctx) => {
      ctx.lineage.cold = false;
      ctx.options[0].kind = "usual";
    }, /citesRules/],
    ["near-tie pointing at a missing slot", (ctx) => (ctx.nearTie = { slots: [1, 7], differsOn: "ops" }), /nearTie/],
  ];
  for (const [name, mutate, expected] of cases) {
    const ctx = validContext();
    mutate(ctx);
    const { status, stderr } = render(contextFile(ctx));
    assert.equal(status, 1, `${name}: expected rejection, got exit ${status}`);
    assert.match(stderr, expected, `${name}: error does not name the field/value`);
  }
});

test("script-closing sequences in context text cannot break out of the data tag", () => {
  const ctx = validContext();
  ctx.options[0].entails = 'renders literally: </script><script>alert("x")</script>';
  const { status, stderr, outDir } = render(contextFile(ctx));
  assert.equal(status, 0, `renderer failed: ${stderr}`);
  const html = readFileSync(join(outDir, "question.html"), "utf8");
  const raw = embeddedJson(html);
  assert.ok(!raw.includes("</script"), "injected JSON contains a literal script-closing sequence");
  assert.deepEqual(JSON.parse(raw), ctx, "escaped JSON must still round-trip to the input context");
});

test("text fallback carries lineage, near-tie, and the correction affordance", () => {
  const warm = render(join(FIXTURES, "valid-warm.json"));
  assert.equal(warm.status, 0, `renderer failed: ${warm.stderr}`);
  const md = readFileSync(join(warm.outDir, "question.md"), "utf8");
  assert.match(md, /recommended — matches your usual/, "merged slot badge missing");
  assert.match(md, /options 1\/2 roughly equivalent — differ on distribution overhead/, "near-tie note missing");
  assert.match(md, /^### Lineage$/m, "lineage section missing");
  assert.match(md, /tools-travel-with-their-skill — matched: renderer is skill-local tooling/, "matched rule missing from lineage");
  assert.match(md, /prefer-boring-tech — set aside: no technology choice at stake/, "set-aside rule missing from lineage");
  assert.match(md, /but actually because/, "correction affordance hint missing");

  const cold = render(join(FIXTURES, "valid-cold.json"));
  assert.equal(cold.status, 0, `renderer failed: ${cold.stderr}`);
  const coldMd = readFileSync(join(cold.outDir, "question.md"), "utf8");
  assert.match(coldMd, /Cold: no active preference rule applies/, "cold note missing from lineage");
});

test("valid context renders artifact html with injected JSON and a text fallback", () => {
  const fixture = join(FIXTURES, "valid-cold.json");
  const { status, stderr, outDir } = render(fixture);
  assert.equal(status, 0, `renderer failed: ${stderr}`);

  const html = readFileSync(join(outDir, "question.html"), "utf8");
  assert.deepEqual(
    JSON.parse(embeddedJson(html)),
    JSON.parse(readFileSync(fixture, "utf8")),
    "injected JSON must round-trip to the input context",
  );

  assert.ok(existsSync(join(outDir, "question.md")), "text fallback question.md missing");
  const md = readFileSync(join(outDir, "question.md"), "utf8");
  assert.match(md, /Which database backs the session store\?/);
  assert.match(md, /^1\. \*\*Postgres\*\*/m, "slot 1 line missing");
  assert.match(md, /^2\. \*\*SQLite\*\*/m, "slot 2 line missing");
  assert.match(md, /^3\. \*\*Free text\*\*/m, "renderer must append the free-text slot itself");
});
