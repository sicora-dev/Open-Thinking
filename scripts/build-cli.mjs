import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(scriptDir, "..");
const distDir = resolve(rootDir, "dist");
const outputFile = resolve(distDir, "cli/index.cjs");

rmSync(distDir, { recursive: true, force: true });
mkdirSync(dirname(outputFile), { recursive: true });

execFileSync(
  "bun",
  [
    "build",
    "src/cli/index.ts",
    "--target=node",
    "--format=cjs",
    "--external=better-sqlite3",
    "--outfile",
    outputFile,
  ],
  {
    cwd: rootDir,
    stdio: "inherit",
  },
);

const builtFile = readFileSync(outputFile, "utf8");
const withShebang = builtFile.startsWith("#!") ? builtFile : `#!/usr/bin/env node\n${builtFile}`;

writeFileSync(outputFile, withShebang, { mode: 0o755 });
chmodSync(outputFile, 0o755);
