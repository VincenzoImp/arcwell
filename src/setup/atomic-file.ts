import {
  chmodSync,
  closeSync,
  existsSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, parse, resolve, sep } from "node:path";

export interface AtomicFileOptions {
  defaultMode?: number;
  targetDescription: string;
}

/** Reject existing symbolic links anywhere in a path before accessing Arcwell state. */
export function assertNoSymbolicLinkComponents(path: string, includeTarget = true): void {
  const absolute = resolve(path);
  const root = parse(absolute).root;
  const components = absolute.slice(root.length).split(sep).filter(Boolean);
  const limit = includeTarget ? components.length : Math.max(0, components.length - 1);
  let current = root;
  for (let index = 0; index < limit; index += 1) {
    current = join(current, components[index]!);
    try {
      if (lstatSync(current).isSymbolicLink()) throw new Error(`setup path contains a symbolic link: ${current}`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw error;
    }
  }
}

export function writeFileAtomic(path: string, content: string | Buffer, options: AtomicFileOptions): void {
  const bytes = Buffer.isBuffer(content) ? content : Buffer.from(content);
  const directory = dirname(path);
  assertNoSymbolicLinkComponents(directory);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  assertNoSymbolicLinkComponents(directory);

  let mode = options.defaultMode ?? 0o600;
  if (existsSync(path)) {
    const stat = lstatSync(path);
    if (stat.isSymbolicLink()) throw new Error(`${options.targetDescription} target is a symbolic link: ${path}`);
    if (!stat.isFile()) throw new Error(`${options.targetDescription} target is not a regular file: ${path}`);
    mode = stat.mode & 0o777;
    if (readFileSync(path).equals(bytes)) return;
  }

  const temporary = join(directory, `.${basename(path)}.${process.pid}.${Date.now()}.tmp`);
  let descriptor: number | undefined;
  try {
    descriptor = openSync(temporary, "wx", mode);
    writeFileSync(descriptor, bytes);
    closeSync(descriptor);
    descriptor = undefined;
    chmodSync(temporary, mode);
    renameSync(temporary, path);
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
    rmSync(temporary, { force: true });
  }
}
