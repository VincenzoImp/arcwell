import { spawn as nodeSpawn, type SpawnOptions } from "node:child_process";

export interface PiPackage {
  source: string;
  scope: "user" | "project";
  filtered: boolean;
  installedPath: string;
}

export interface PiClient {
  version(signal?: AbortSignal): Promise<string>;
  list(signal?: AbortSignal): Promise<PiPackage[]>;
  install(source: string, signal?: AbortSignal): Promise<void>;
  remove(source: string, signal?: AbortSignal): Promise<void>;
}

type Spawn = typeof nodeSpawn;

export interface PiClientOptions {
  executable?: string;
  prefixArguments?: readonly string[];
  environment?: NodeJS.ProcessEnv;
  maxOutputBytes?: number;
  spawn?: Spawn;
}

const DEFAULT_MAX_OUTPUT_BYTES = 64 * 1024;
const ansiEscape = /\u001b(?:\[[0-?]*[ -/]*[@-~]|\][^\u0007]*(?:\u0007|\u001b\\))/g;

function sanitizeOutput(text: string): string {
  return text.replace(ansiEscape, "").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/g, (character) =>
    `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`);
}

function parsePackageList(output: string): PiPackage[] {
  const packages: PiPackage[] = [];
  let scope: PiPackage["scope"] | undefined;
  let pending: Omit<PiPackage, "installedPath"> | undefined;
  for (const line of output.split(/\r?\n/)) {
    if (line === "User packages:" || line === "Project packages:") {
      if (pending) throw new Error(`Pi package list entry has no installed path: ${pending.source}`);
      scope = line === "User packages:" ? "user" : "project";
      continue;
    }
    if (!scope) continue;
    const packageMatch = /^ {2}(\S.*?)( \(filtered\))?$/.exec(line);
    if (packageMatch?.[1]) {
      if (pending) throw new Error(`Pi package list entry has no installed path: ${pending.source}`);
      pending = { source: packageMatch[1], scope, filtered: packageMatch[2] !== undefined };
      continue;
    }
    const pathMatch = /^ {4}(.+)$/.exec(line);
    if (pathMatch?.[1] && pending) {
      packages.push({ ...pending, installedPath: pathMatch[1] });
      pending = undefined;
    }
  }
  if (pending) throw new Error(`Pi package list entry has no installed path: ${pending.source}`);
  return packages;
}

export function createPiClient(options: PiClientOptions = {}): PiClient {
  const executable = options.executable ?? "pi";
  const prefixArguments = [...(options.prefixArguments ?? [])];
  const spawnProcess = options.spawn ?? nodeSpawn;
  const maxOutputBytes = options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;
  if (!Number.isSafeInteger(maxOutputBytes) || maxOutputBytes < 1) {
    throw new Error("Pi client maxOutputBytes must be a positive integer");
  }

  const run = (arguments_: readonly string[], signal?: AbortSignal): Promise<string> => new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason instanceof Error ? signal.reason : new Error("Pi command aborted"));
      return;
    }
    const spawnOptions: SpawnOptions = {
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
      env: options.environment ?? process.env,
      ...(signal ? { signal } : {}),
    };
    let child: ReturnType<Spawn>;
    try {
      child = spawnProcess(executable, [...prefixArguments, ...arguments_], spawnOptions);
    } catch (error) {
      reject(error);
      return;
    }

    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let capturedBytes = 0;
    let exceeded = false;
    let settled = false;
    let processError: Error | undefined;
    const capture = (destination: Buffer[], chunk: Buffer | string): void => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      const remaining = Math.max(0, maxOutputBytes - capturedBytes);
      if (remaining > 0) destination.push(buffer.subarray(0, remaining));
      capturedBytes += Math.min(buffer.length, remaining);
      if (buffer.length > remaining && !exceeded) {
        exceeded = true;
        child.kill();
      }
    };
    child.stdout!.on("data", (chunk: Buffer | string) => capture(stdout, chunk));
    child.stderr!.on("data", (chunk: Buffer | string) => capture(stderr, chunk));
    child.once("error", (error) => {
      // Node emits close after error. Wait for it so callers never compensate while
      // an aborted package-manager process may still be mutating its install root.
      processError = error;
    });
    child.once("close", (code, closeSignal) => {
      if (settled) return;
      settled = true;
      const safeStdout = sanitizeOutput(Buffer.concat(stdout).toString("utf8"));
      const safeStderr = sanitizeOutput(Buffer.concat(stderr).toString("utf8"));
      if (exceeded) {
        reject(new Error(`Pi command output exceeded ${maxOutputBytes} bytes`));
        return;
      }
      if (processError) {
        reject(processError);
        return;
      }
      if (code !== 0) {
        const detail = safeStderr.trim() || safeStdout.trim() || `exit ${code ?? closeSignal ?? "unknown"}`;
        reject(new Error(`Pi command failed: ${detail}`));
        return;
      }
      resolve(safeStdout);
    });
  });

  return {
    async version(signal) {
      const output = (await run(["--version"], signal)).trim();
      if (!output) throw new Error("Pi version command returned no version");
      return output.split(/\r?\n/, 1)[0]!;
    },
    async list(signal) {
      return parsePackageList(await run(["list"], signal));
    },
    async install(source, signal) {
      await run(["install", source], signal);
    },
    async remove(source, signal) {
      await run(["remove", source], signal);
    },
  };
}
