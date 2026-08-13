// Tests for the grilling renderer CLI (derived/grilling/render/render.ts).
// The CLI is the public interface: every test drives it end to end.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
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

red.fails("valid context renders artifact html with injected JSON and a text fallback", () => {
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
