import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import test from "node:test";

import { createDefaultManifest } from "../src/setup/manifest.js";
import { createReadlineWizardIo, runSetupWizard, type SetupWizardIo } from "../src/setup/wizard.js";

function scriptedWizard(answers: Array<string | undefined>): {
  io: SetupWizardIo;
  output: string[];
  prompts: string[];
} {
  const output: string[] = [];
  const prompts: string[] = [];
  return {
    io: {
      question: async (prompt) => {
        prompts.push(prompt);
        return answers.shift();
      },
      write: (text) => output.push(text),
    },
    output,
    prompts,
  };
}

test("wizard defaults to guarded protections and installs the external packages", async () => {
  const script = scriptedWizard(["", "", "", "", "", "yes"]);
  const manifest = await runSetupWizard(script.io);

  assert.deepEqual(manifest, createDefaultManifest());
  assert.match(script.prompts[0] ?? "", /posture.*Guarded.*recommended.*Host/i);
  assert.match(script.prompts.join("\n"), /external capability packages.*LSP.*context.*MCP/i);
  const rendered = script.output.join("");
  assert.match(rendered, /npm:@spences10\/pi-lsp@0\.0\.46/);
  assert.match(rendered, /\$PI_CODING_AGENT_DIR\/AGENTS\.md/);
  assert.match(rendered, /\$PI_CODING_AGENT_DIR\/arcwell\/config\.json/);
  assert.match(rendered, /Network:/);
  assert.match(rendered, /Listeners:/);
  assert.match(rendered, /Processes:/);
  assert.match(rendered, /"posture": "guarded"/);
});

test("host posture disables every protection without asking contradictory protection questions", async () => {
  const script = scriptedWizard(["host", "", "yes"]);
  const manifest = await runSetupWizard(script.io);

  assert.deepEqual(manifest?.protections, { effects: false, secrets: false, redaction: false });
  assert.equal(manifest?.posture, "host");
  assert.equal(script.prompts.some((prompt) => /Enable (effects|secret|redaction)/i.test(prompt)), false);
  assert.match(script.output.join(""), /Warning: Protection effects is disabled/);
  assert.match(script.output.join(""), /Warning: Protection secrets is disabled/);
  assert.match(script.output.join(""), /Warning: Protection redaction is disabled/);
});

test("guarded posture allows each protection to be disabled independently", async () => {
  const script = scriptedWizard(["guarded", "no", "no", "no", "", "yes"]);
  const manifest = await runSetupWizard(script.io);

  assert.deepEqual(manifest?.protections, { effects: false, secrets: false, redaction: false });
  assert.equal(script.prompts.filter((prompt) => /Enable (effects|secret|redaction)/i.test(prompt)).length, 3);
  assert.equal((script.output.join("").match(/Warning: Protection .* is disabled/g) ?? []).length, 3);
});

test("the external packages are one question, and declining installs none of them", async () => {
  const accepted = scriptedWizard(["", "", "", "", "", "yes"]);
  const acceptedManifest = await runSetupWizard(accepted.io);
  assert.deepEqual(acceptedManifest?.modules, { lsp: true, context: true, mcp: true });

  const declined = scriptedWizard(["", "", "", "", "no", "yes"]);
  const declinedManifest = await runSetupWizard(declined.io);
  assert.deepEqual(declinedManifest?.modules, { lsp: false, context: false, mcp: false });

  // Capabilities Arcwell ships itself are not wizard questions: they arrive with the package
  // and are disabled through `pi config`.
  assert.equal(
    accepted.prompts.some((prompt) => /Enable web|Enable subagents|Enable autonomous|Advanced/i.test(prompt)),
    false,
  );
  const output = accepted.output.join("");
  assert.match(output, /web skill.*network.*credentials/i);
  assert.match(output, /MCP.*network.*credentials/i);
  assert.match(output, /subagents.*paid model calls/i);
  assert.match(output, /child agent processes/i);
});

test("the default readline adapter maps EOF to cancellation", async () => {
  const input = new PassThrough();
  const output = new PassThrough();
  const io = createReadlineWizardIo(input, output);
  try {
    const result = runSetupWizard(io);
    input.end();
    assert.equal(await result, undefined);
  } finally {
    io.close();
  }
});

test("EOF, cancellation, and an aborted signal return no manifest", async (t) => {
  await t.test("EOF", async () => {
    assert.equal(await runSetupWizard(scriptedWizard([undefined]).io), undefined);
  });
  await t.test("cancel answer", async () => {
    assert.equal(await runSetupWizard(scriptedWizard(["cancel"]).io), undefined);
  });
  await t.test("declined final confirmation", async () => {
    assert.equal(await runSetupWizard(scriptedWizard(["", "", "", "", "", "no"]).io), undefined);
  });
  await t.test("SIGINT signal", async () => {
    const controller = new AbortController();
    const io: SetupWizardIo = {
      question: async () => {
        controller.abort();
        return "guarded";
      },
      write: () => undefined,
    };
    assert.equal(await runSetupWizard(io, undefined, controller.signal), undefined);
  });
});
