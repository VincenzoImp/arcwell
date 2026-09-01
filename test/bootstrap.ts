import { mkdirSync } from "node:fs";
import { join } from "node:path";

for (const directory of [".tmp-tests", ".npm-cache"]) {
  mkdirSync(join(process.cwd(), directory), { recursive: true });
}
