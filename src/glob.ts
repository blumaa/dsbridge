/* Path patterns, without a dependency.
 *
 * `*` stops at a separator and `**` crosses them, as everywhere else. The one
 * thing worth stating: a pattern that names a directory matches everything
 * under it, so `ignore: ["vendor/bundle"]` keeps meaning what it meant before
 * any of this was a glob.
 */

const ESCAPE = /[.+^${}()|[\]\\]/g;

const segment = (part: string) =>
  part.replace(ESCAPE, "\\$&").replace(/\*/g, "[^/]*").replace(/\?/g, "[^/]");

function source(pattern: string): string {
  const parts = pattern.split("/");
  return parts
    .map((part, i) => {
      const last = i === parts.length - 1;
      if (part === "**") return last ? ".*" : "(?:[^/]*/)*";
      return last ? segment(part) : `${segment(part)}/`;
    })
    .join("");
}

/** A pattern as a matcher for one repo-relative, forward-slashed path. */
export const globToRegExp = (pattern: string): RegExp => new RegExp(`^(?:${source(pattern)})(?:/.*)?$`);

/** True when any of the patterns claims the path; an empty list claims none. */
export function anyGlob(patterns: readonly string[]): (path: string) => boolean {
  const matchers = patterns.map(globToRegExp);
  return (path) => matchers.some((matcher) => matcher.test(path));
}
