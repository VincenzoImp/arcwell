import type { ArcwellManifest, Posture } from "./manifest.js";

export interface InitialManifestOptions {
  profile?: "core" | "full";
  posture?: Posture;
}

export function createInitialManifest(options: InitialManifestOptions = {}): ArcwellManifest {
  const profile = options.profile ?? "core";
  const posture = options.posture ?? "guarded";
  return {
    schemaVersion: 1,
    profile,
    posture,
    intelligence: profile === "full"
      ? {
          packs: ["core", "engineering", "security"],
          workflows: ["audit", "bugfix", "feature", "plan", "research", "review"],
        }
      : {
          packs: ["core"],
          workflows: ["bugfix", "feature", "plan", "review"],
        },
    modules: {
      claudeCode: true,
      herdr: false,
      mcp: true,
      sandbox: posture === "isolated",
    },
  };
}
