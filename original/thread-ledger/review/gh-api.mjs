// The `gh api` calls a review session may make (skills#297).
//
// The GitHub read tools are retired, so a review reads the forge with `gh api`.
// Decision 165 allows a GET of a fixed set of REST paths below repos/<owner>/<repo>/
// and no other call: no flag that sets a method, a field or a body.
// A pipe out of the call is judged as its own command by the bash policy.
//
// Pure functions over the words after `gh`, quotes removed.

// A GitHub login holds letters, digits and hyphens; a repository name also dots and underscores,
// but `.` and `..` would climb out of the repository.
const OWNER = String.raw`[A-Za-z0-9-]+`;
const REPO = String.raw`(?!\.\.?/)[A-Za-z0-9_.-]+`;
const QUERY = String.raw`(?:\?[A-Za-z0-9_=&%.,+-]*)?`;
const BELOW = String.raw`issues/(\d+)(/comments)?|pulls/\d+(?:/(?:files|comments|reviews))?|commits/[0-9a-f]{7,40}/check-runs`;
const ALLOWED_PATH = new RegExp(String.raw`^/?repos/(${OWNER})/(${REPO})/(?:${BELOW})${QUERY}$`);

// Flags that shape the output and take a value, and those that take none.
const VALUED = new Set(["--jq", "-q", "--template", "-t", "--hostname"]);
const SWITCHES = new Set(["--paginate", "--slurp", "--include", "-i", "--silent"]);

const METHOD = /^(-X|--method)/;
const FIELD = /^(-[fF]|--field|--raw-field)/;
const INPUT = /^--input/;

/** The calls a review makes, as the reason names them. */
export const GH_READS =
  "A review reads a ticket with `gh api repos/<owner>/<repo>/issues/<n>`. " +
  "It may also GET issues/<n>/comments, pulls/<n>, pulls/<n>/files, pulls/<n>/comments, pulls/<n>/reviews " +
  "and commits/<sha>/check-runs below repos/<owner>/<repo>/, " +
  `with ${[...VALUED, ...SWITCHES].join(", ")} and no other flag.`;

/**
 * The one path of a `gh api` call and the reason it is refused, from the words after `gh api`.
 * @param {string[]} args the words after `gh api`, quotes removed
 * @returns {{ path: string | null, why: string | null }} the path when the call has exactly one;
 *   `why` names the first flag or path outside decision 165, null when the call is allowed
 */
function judge(args) {
  /** @type {string[]} */
  const paths = [];
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i];
    const flag = a.split("=")[0];
    if (METHOD.test(a)) return { path: null, why: `\`gh api ${flag}\` sets the method; a review makes GET calls only.` };
    if (FIELD.test(a)) return { path: null, why: `\`gh api ${flag}\` sets a field, which makes the call a write.` };
    if (INPUT.test(a)) return { path: null, why: `\`gh api ${flag}\` sends a body, which makes the call a write.` };
    if (VALUED.has(flag)) {
      if (!a.includes("=")) i += 1;
      continue;
    }
    if (SWITCHES.has(a)) continue;
    if (a.startsWith("-")) return { path: null, why: `\`gh api ${flag}\` is outside the read flags.` };
    paths.push(a);
  }
  if (paths.length !== 1) {
    return { path: null, why: `\`gh api\` takes one path; this call names ${paths.length}.` };
  }
  if (!ALLOWED_PATH.test(paths[0])) {
    return { path: paths[0], why: `\`${paths[0]}\` is outside the paths a review reads.` };
  }
  return { path: paths[0], why: null };
}

/**
 * Why a `gh` call is refused, or null when it is one decision 165 allows.
 * @param {string[]} args the words after `gh`, quotes removed
 * @returns {string | null} the reason, naming the calls a review has
 */
export function ghWhy(args) {
  if (args[0] !== "api") {
    const sub = args[0] ? `gh ${args[0]}` : "gh";
    return `\`${sub}\` is not a read a review makes. ${GH_READS}`;
  }
  const { why } = judge(args.slice(1));
  return why ? `${why} ${GH_READS}` : null;
}

/**
 * The ticket an allowed `gh api` call reads, as `owner/repo#n`, lowercase.
 * Only `issues/<n>` reads the ticket; its comments are not the ticket.
 * @param {string[]} args the words after `gh`, quotes removed
 * @returns {string | null} null for any other call, and for a call {@link ghWhy} refuses
 */
export function ghTicket(args) {
  if (args[0] !== "api") return null;
  const { path, why } = judge(args.slice(1));
  if (why || !path) return null;
  const m = /** @type {RegExpExecArray} */ (ALLOWED_PATH.exec(path));
  const [, owner, repo, n, comments] = m;
  if (!n || comments) return null;
  return `${owner}/${repo}#${n}`.toLowerCase();
}
