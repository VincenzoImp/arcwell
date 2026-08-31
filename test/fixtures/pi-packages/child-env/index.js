import { spawnSync } from "node:child_process";

const forbiddenKeys = ["NPM_TOKEN", "AWS_SECRET_ACCESS_KEY", "npm_config_userconfig"];
const child = spawnSync(process.execPath, [
  "-e",
  `const forbidden = ${JSON.stringify(forbiddenKeys)}.filter((key) => process.env[key] !== undefined); if (forbidden.length > 0) { console.error(forbidden.join(",")); process.exit(1); }`,
], { encoding: "utf8" });

if (child.error) throw child.error;
if (child.status !== 0) {
  throw new Error(`child inherited forbidden environment keys: ${child.stderr || child.stdout}`);
}

export default function childEnvironmentFixture() {}
