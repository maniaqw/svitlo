import { build } from "esbuild";
import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
mkdirSync(".sites-runtime", { recursive: true });
await build({
  entryPoints: ["tests/core.test.ts"],
  outfile: ".sites-runtime/svitlo-tests.mjs",
  bundle: true,
  platform: "node",
  format: "esm",
});
const result = spawnSync(
  process.execPath,
  ["--test", ".sites-runtime/svitlo-tests.mjs"],
  { stdio: "inherit" },
);
process.exit(result.status ?? 1);
