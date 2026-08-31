import { homedir } from "node:os";
import { join } from "node:path";

import { getAgentDir } from "@earendil-works/pi-coding-agent";

function expandTilde(path: string): string {
  if (path === "~") return homedir();
  if (path.startsWith("~/") || (process.platform === "win32" && path.startsWith("~\\"))) {
    return join(homedir(), path.slice(2));
  }
  return path;
}

export function resolveArcwellAgentDir(
  environment: NodeJS.ProcessEnv = process.env,
  fallback: () => string = getAgentDir,
): string {
  const configured = environment.PI_CODING_AGENT_DIR;
  return configured ? expandTilde(configured) : fallback();
}
