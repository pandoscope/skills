/**
 * Grilling question renderer CLI.
 *
 * Usage:
 *   node --experimental-strip-types render.ts <context.json> --out <dir>
 *
 * Reads a decision-context JSON file, validates it against the version-1
 * schema (see decision-context.ts), and writes:
 *   <dir>/question.html — the pre-built template with the JSON injected
 *                         (artifact form; rendering happens client-side)
 *   <dir>/question.md   — the pure-text fallback
 *
 * Exits 0 on success. Exits 1 with a field-naming message on stderr when
 * the input violates the schema or cannot be read.
 */

/**
 * Entry point.
 *
 * @param argv - Process arguments after the script name:
 *   [contextPath, "--out", outDir].
 * @throws Error on invalid usage or invalid input.
 */
function main(argv: string[]): void {
  const [contextPath, outFlag, outDir] = argv;
  if (!contextPath || outFlag !== "--out" || !outDir) {
    throw new Error(`usage: render.ts <context.json> --out <dir> (got: ${JSON.stringify(argv)})`);
  }
  throw new Error(`NotImplementedError: render ${contextPath} into ${outDir}`);
}

try {
  main(process.argv.slice(2));
} catch (e) {
  console.error(String(e instanceof Error ? e.message : e));
  process.exit(1);
}
