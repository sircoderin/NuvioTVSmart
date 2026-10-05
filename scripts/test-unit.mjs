import { readdir } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
async function findTests(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map((entry) => {
      const target = path.join(directory, entry.name);
      return entry.isDirectory()
        ? findTests(target)
        : entry.name.endsWith(".test.mjs")
          ? [target]
          : [];
    })
  );
  return nested.flat();
}
const tests = (await findTests(path.join(root, "js"))).sort();
if (!tests.length) throw new Error("No unit tests found in js/.");
const child = spawn(process.execPath, ["--test", ...tests], { cwd: root, stdio: "inherit" });
child.on("error", (error) => {
  console.error(error.message);
  process.exitCode = 1;
});
child.on("exit", (code) => {
  process.exitCode = code ?? 1;
});
