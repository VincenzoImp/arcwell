import assert from "node:assert/strict";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";
import test from "node:test";

import { defaultProtectionConfigPath } from "../extensions/arcwell-protections.js";
import { resolveArcwellAgentDir } from "../src/setup/agent-dir.js";
import { defaultSetupAgentDir } from "../src/setup/cli.js";
import { defaultDoctorAgentDir } from "../src/setup/doctor.js";
import { defaultUninstallAgentDir } from "../src/setup/uninstall.js";

test("setup, extension, doctor, and uninstall share PI_CODING_AGENT_DIR with getAgentDir fallback", () => {
  let fallbackCalls = 0;
  const fallback = () => { fallbackCalls += 1; return "/fallback/pi-agent"; };

  assert.equal(resolveArcwellAgentDir({ PI_CODING_AGENT_DIR: "/custom/pi-agent" }, fallback), "/custom/pi-agent");
  const tildeAgentDir = resolveArcwellAgentDir({ PI_CODING_AGENT_DIR: "~/custom-agent" }, fallback);
  assert.equal(tildeAgentDir, join(homedir(), "custom-agent"));
  assert.equal(isAbsolute(tildeAgentDir), true);
  assert.equal(fallbackCalls, 0);
  assert.equal(resolveArcwellAgentDir({}, fallback), "/fallback/pi-agent");
  assert.equal(fallbackCalls, 1);

  const previous = process.env.PI_CODING_AGENT_DIR;
  try {
    process.env.PI_CODING_AGENT_DIR = "/shared/pi-agent";
    assert.equal(defaultSetupAgentDir(), "/shared/pi-agent");
    assert.equal(defaultDoctorAgentDir(), "/shared/pi-agent");
    assert.equal(defaultUninstallAgentDir(), "/shared/pi-agent");
    assert.equal(defaultProtectionConfigPath(), join("/shared/pi-agent", "arcwell", "config.json"));
  } finally {
    if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previous;
  }
});
