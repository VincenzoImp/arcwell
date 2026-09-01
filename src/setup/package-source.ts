export const ARCWELL_PACKAGE_SOURCE = "git:github.com/VincenzoImp/arcwell@v0.5.0";

interface SemanticPackageSource {
  identity: string;
  ref?: string;
}

function npmPackageSource(source: string): SemanticPackageSource | undefined {
  if (!source.startsWith("npm:")) return undefined;
  const specifier = source.slice(4).trim();
  // Mirror Pi 0.84.4 parseNpmSpec(): identity is the requested package name,
  // including when its version is an npm alias such as pkg@npm:other@1.0.0.
  const match = /^(@?[^@]+(?:\/[^@]+)?)(?:@(.+))?$/.exec(specifier);
  const name = match?.[1] ?? (specifier || undefined);
  if (!name) return undefined;
  const ref = match?.[2];
  return {
    identity: `npm:${name}`,
    ...(ref ? { ref } : {}),
  };
}

function splitGitRef(pathWithRef: string, fragment?: string): { path: string; ref?: string } {
  const refSeparator = pathWithRef.indexOf("@");
  if (refSeparator >= 0) {
    const path = pathWithRef.slice(0, refSeparator);
    const ref = pathWithRef.slice(refSeparator + 1);
    return path && ref ? { path, ref } : { path: pathWithRef };
  }
  return fragment ? { path: pathWithRef, ref: fragment } : { path: pathWithRef };
}

function gitPackageSource(source: string): SemanticPackageSource | undefined {
  const trimmed = source.trim();
  const hasGitPrefix = trimmed.startsWith("git:") && !trimmed.startsWith("git://");
  const specifier = hasGitPrefix ? trimmed.slice(4).trim() : trimmed;
  let host: string;
  let pathWithRef: string;
  let fragment: string | undefined;

  const scpLike = hasGitPrefix ? /^git@([^:]+):(.+)$/.exec(specifier) : null;
  if (scpLike?.[1] && scpLike[2]) {
    host = scpLike[1];
    pathWithRef = scpLike[2];
  } else if (/^(?:https?|ssh|git):\/\//i.test(specifier)) {
    try {
      const parsed = new URL(specifier);
      host = parsed.hostname;
      pathWithRef = parsed.pathname.replace(/^\/+/, "");
      fragment = parsed.hash.slice(1) || undefined;
    } catch {
      return undefined;
    }
  } else {
    if (!hasGitPrefix) return undefined;
    const slash = specifier.indexOf("/");
    if (slash < 1) return undefined;
    host = specifier.slice(0, slash);
    pathWithRef = specifier.slice(slash + 1);
  }

  const split = splitGitRef(pathWithRef, fragment);
  const path = split.path.replace(/\.git$/, "").replace(/^\/+/, "");
  if (!host || !path || path.split("/").length < 2) return undefined;
  const lowerHost = host.toLowerCase();
  const normalizedHost = lowerHost === "www.github.com" ? "github.com" : lowerHost;
  return {
    identity: `git:${normalizedHost}/${path}`,
    ...(split.ref ? { ref: split.ref } : {}),
  };
}

function semanticPackageSource(source: string): SemanticPackageSource | undefined {
  return npmPackageSource(source) ?? gitPackageSource(source);
}

/** Mirrors Pi package identity: npm package name, or Git host/repository without its ref. */
export function packageSourceIdentity(source: string): string | undefined {
  return semanticPackageSource(source)?.identity;
}

/** Compares package source identity and its requested npm version or Git ref. */
export function packageSourcesEquivalent(left: string, right: string): boolean {
  const leftSource = semanticPackageSource(left);
  const rightSource = semanticPackageSource(right);
  return leftSource !== undefined
    && rightSource !== undefined
    && leftSource.identity === rightSource.identity
    && leftSource.ref === rightSource.ref;
}
