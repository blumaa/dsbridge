/* What the app installed, worked out from the app alone.
 *
 * Nothing here is configured and nothing here is named. A tool that looked for
 * one particular package would answer for one particular design system, so the
 * design system is found by shape: among the dependencies that publish a
 * stylesheet, the one that *declares* custom properties is the tokens, and the
 * one that only spends them is the components built on top of them. Both halves
 * are read from the copy on disk, because what the app renders is the copy it
 * installed and not whatever this tool was written knowing.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { declarationsIn } from "./css/parse.js";
import { expandImports, inferPrefix } from "./graph.js";
import { globToRegExp } from "./glob.js";
import { componentsIn, typesEntry } from "./system.js";
import { findSources, findStylesheets } from "./sources.js";

/** The tokens half: a stylesheet, and how much of the contract it states. */
export type Tokens = { id: string; stylesheet: string; declares: number };

/** The components half, when the system ships one. */
export type Components = {
  id: string;
  names: string[];
  /** Its own stylesheet, where it publishes one: the pairs the system writes
      about itself live in there, and a brand re-points what they resolve to. */
  stylesheet?: string;
};

export type Discovery = {
  /** The app the answer is about. */
  root: string;
  tokens: Tokens;
  components?: Components;
  /** The namespace every token shares, read off the stylesheet. */
  prefix: string;
  /** The app's own stylesheets and TypeScript components. */
  stylesheets: string[];
  sources: string[];
};

const manifestOf = (dir: string): Record<string, unknown> | undefined => {
  const path = join(dir, "package.json");
  if (!existsSync(path)) return undefined;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
  } catch {
    return undefined;
  }
};

const DEPENDENCIES = ["dependencies", "devDependencies", "peerDependencies"];

/** What a manifest says the package installed. */
function dependencyNames(manifest: Record<string, unknown>): string[] {
  const fields = DEPENDENCIES.map((field) => (manifest[field] ?? {}) as Record<string, string>);
  return [...new Set(fields.flatMap((field) => Object.keys(field)))];
}

/** The globs a monorepo root declares, npm and pnpm alike. */
function workspaceGlobs(root: string, manifest: Record<string, unknown>): string[] {
  const declared = manifest["workspaces"];
  const npm = Array.isArray(declared)
    ? (declared as string[])
    : ((declared as { packages?: string[] } | undefined)?.packages ?? []);
  const yaml = join(root, "pnpm-workspace.yaml");
  /* Only the `packages:` list, and only its plain entries: a workspace file is
     the one place a YAML parser would be a dependency, and this is all of it
     that names a directory. */
  const pnpm = existsSync(yaml)
    ? [...readFileSync(yaml, "utf8").matchAll(/^\s*-\s*["']?([^"'\s#]+)["']?\s*$/gm)].map((m) => m[1]!)
    : [];
  return [...new Set([...npm, ...pnpm])].filter((glob) => !glob.startsWith("!"));
}

/** The package directories a monorepo's globs actually name, on this disk. */
export function workspaceMembers(root: string): string[] {
  const at = resolve(root);
  const manifest = manifestOf(at);
  if (manifest === undefined) return [];
  const out: string[] = [];
  for (const glob of workspaceGlobs(at, manifest)) {
    const matches = globToRegExp(glob);
    /* Walk only as deep as the pattern has segments: a glob is a shape, not a
       search, and an app's own `node_modules` is not a workspace member. */
    const depth = glob.split("/").length;
    const walk = (dir: string, level: number) => {
      for (const entry of readdirSync(dir)) {
        if (entry === "node_modules" || entry.startsWith(".")) continue;
        const path = join(dir, entry);
        if (!statSync(path).isDirectory()) continue;
        if (matches.test(relative(at, path))) out.push(path);
        else if (level < depth) walk(path, level + 1);
      }
    };
    walk(at, 1);
  }
  return [...new Set(out)].sort();
}

/* A package as the app has it on disk.
 *
 * Read from `node_modules` rather than through Node's own resolution, and that
 * is not a shortcut: a package states in `exports` which of its files may be
 * imported, and `@mond-design-system/tokens` lists five stylesheets and no
 * `package.json`. Resolving `<id>/package.json` throws for every package that
 * does what the specification recommends, which is how a design system that was
 * plainly installed gets reported as missing. The directory is the thing that
 * exists; the map inside it says where its files are. */
type Installed = { id: string; dir: string; manifest: Record<string, unknown> };

/** Every dependency of every directory, once each, as it sits on disk. */
function installed(dirs: string[]): Installed[] {
  const byName = new Map<string, Installed>();
  for (const from of dirs) {
    const manifest = manifestOf(from);
    if (manifest === undefined) continue;
    for (const id of dependencyNames(manifest)) {
      if (byName.has(id)) continue;
      /* npm and yarn write the directory; pnpm links it. Both answer here. */
      const dir = join(from, "node_modules", ...id.split("/"));
      const declared = manifestOf(dir);
      if (declared !== undefined) byName.set(id, { id, dir, manifest: declared });
    }
  }
  return [...byName.values()];
}

/** Every path an `exports` map points at, however deeply it nests. */
function exported(value: unknown, out: [string, string][] = [], key = "."): [string, string][] {
  if (typeof value === "string") out.push([key, value]);
  else if (value !== null && typeof value === "object") {
    for (const [inner, next] of Object.entries(value as Record<string, unknown>)) {
      exported(next, out, inner.startsWith(".") ? inner : key);
    }
  }
  return out;
}

/** Conventional names, for a package that publishes its CSS without saying so. */
const USUAL = ["styles.css", "style.css", "index.css", "dist/styles.css", "dist/index.css"];

/**
 * The entry stylesheet a package publishes, if it publishes one.
 *
 * `./styles.css` first because that is what the ecosystem settled on, and
 * because a package that ships several — the tokens, the base, one file per
 * scale — means the one that imports the rest.
 */
function stylesheetOf(pkg: Installed): string | undefined {
  const map = exported(pkg.manifest["exports"]).filter(([, path]) => path.endsWith(".css"));
  const named = (key: string) => map.find(([k]) => k === key)?.[1];
  const style = typeof pkg.manifest["style"] === "string" ? (pkg.manifest["style"] as string) : undefined;
  const first = map.find(([key]) => !key.includes("*"))?.[1];
  const wanted = [named("./styles.css"), style, named("."), named("./index.css"), first, ...USUAL];
  for (const path of wanted) {
    if (path === undefined) continue;
    const full = resolve(pkg.dir, path);
    if (existsSync(full)) return full;
  }
  return undefined;
}

/** What a package states it exports, from the declaration file it ships. */
function componentNamesOf(pkg: Installed): string[] {
  const entry = typesEntry(JSON.stringify(pkg.manifest));
  if (entry === undefined) return [];
  const declaration = resolve(pkg.dir, entry);
  return existsSync(declaration) ? componentsIn(readFileSync(declaration, "utf8")) : [];
}

/**
 * The custom properties a stylesheet declares, imports and all.
 *
 * The count is what tells the two halves apart: a tokens package states the
 * contract, a components package spends it, and neither has to be named.
 */
function declaredTokens(entry: string): { count: number; names: string[] } {
  const names = expandImports(entry).flatMap((file) =>
    declarationsIn(readFileSync(file, "utf8"), file)
      .filter((d) => d.name.startsWith("--"))
      .map((d) => d.name),
  );
  return { count: new Set(names).size, names };
}

/** A dependency that publishes a stylesheet: a candidate, and nothing more yet. */
type Candidate = Installed & { stylesheet: string; declares: number; names: string[] };

const candidatesFrom = (packages: Installed[]): Candidate[] =>
  packages.flatMap((pkg) => {
    const stylesheet = stylesheetOf(pkg);
    if (stylesheet === undefined) return [];
    const { count, names } = declaredTokens(stylesheet);
    return [{ ...pkg, stylesheet, declares: count, names }];
  });

/** The scope a package name carries, for the packages that carry one. */
const scopeOf = (id: string): string | undefined => (id.startsWith("@") ? id.split("/")[0] : undefined);

/**
 * The components half of the system that owns `tokens`.
 *
 * Looked for among the same family and nowhere else: a design system ships its
 * components either in the tokens package itself or in a sibling under the same
 * scope, and every other dependency an app has exports something too.
 */
function componentsFor(tokens: Candidate, candidates: Candidate[], packages: Installed[]): Components | undefined {
  const scope = scopeOf(tokens.id);
  const family = packages.filter(
    (pkg) => candidates.some((c) => c.id === pkg.id) || (scope !== undefined && scopeOf(pkg.id) === scope),
  );
  const found = family
    .map((pkg) => {
      const stylesheet = candidates.find((c) => c.id === pkg.id)?.stylesheet;
      return { id: pkg.id, names: componentNamesOf(pkg), ...(stylesheet ? { stylesheet } : {}) };
    })
    .filter((it) => it.names.length > 0)
    .sort((a, b) => b.names.length - a.names.length || a.id.localeCompare(b.id));
  return found[0];
}

const NOTHING_INSTALLED =
  "no design system was found: nothing this app installed publishes a styles.css that " +
  "declares custom properties, so there is no contract to measure against";

/**
 * What the app at `root` installed and what it owns.
 *
 * Throws rather than guessing. An app with no design system installed is a real
 * answer to a different question, and reporting 0% coverage for it would be a
 * lie dressed as a measurement.
 */
export function discover(root: string): Discovery {
  const at = resolve(root);
  const manifest = manifestOf(at);
  if (manifest === undefined) {
    throw new Error(`no package.json at ${at} — dsbridge reads what an app installed, so it needs the app's manifest`);
  }
  /* The app itself first. A monorepo root installs nothing of its own, so its
     members are where the dependency actually is; an app run directly answers
     from its own manifest and never walks. */
  const dirs = [at, ...workspaceMembers(at)];
  const packages = installed(dirs);
  const candidates = candidatesFrom(packages);
  const declaring = candidates.filter((c) => c.declares > 0);
  if (declaring.length === 0) throw new Error(NOTHING_INSTALLED);

  /* A design system usually ships two packages that both publish a stylesheet:
     the tokens and the components. The tokens are the one that declares them, so
     the count of declarations is what separates the contract from a stylesheet
     that merely spends it. */
  const tokens = declaring.sort((a, b) => b.declares - a.declares || a.id.localeCompare(b.id))[0]!;
  const components = componentsFor(tokens, candidates, packages);
  return {
    root: at,
    tokens: { id: tokens.id, stylesheet: tokens.stylesheet, declares: tokens.declares },
    ...(components ? { components } : {}),
    prefix: inferPrefix(tokens.names) ?? "--",
    stylesheets: findStylesheets(at),
    sources: findSources(at),
  };
}
