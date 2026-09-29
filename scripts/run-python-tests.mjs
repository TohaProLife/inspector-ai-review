import { spawnSync } from "node:child_process";
import { delimiter, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const suites = {
  worker: "services/worker",
  bonsai: "services/bonsai",
  "model-store": "services/model-store",
  "document-ai": "services/document-ai",
  "text-inference": "services/text-inference",
  "gpu-admission": "services/gpu-admission",
  scripts: "scripts",
  infra: "infra",
};
const selected = process.argv.slice(2);
const names = selected.length ? selected : Object.keys(suites);
if (names.some(name => !Object.hasOwn(suites, name))) {
  console.error(`Unknown suite. Choose: ${Object.keys(suites).join(", ")}`);
  process.exit(2);
}
const python = process.env.PYTHON_BIN || (process.platform === "win32" ? "python" : "python3");
let failed = false;
for (const name of names) {
  const directory = resolve(root, suites[name]);
  console.log(`\nPython suite: ${name}`);
  const result = spawnSync(python, ["-m", "unittest", "discover", "-s", resolve(directory, "tests"), "-v"], {
    cwd: root,
    stdio: "inherit",
    env: {
      ...process.env,
      PYTHONUTF8: "1",
      PYTHONPATH: [directory, process.env.PYTHONPATH].filter(Boolean).join(delimiter),
    },
  });
  if (result.error) console.error(`Could not start ${python}: ${result.error.message}. Set PYTHON_BIN to a Python 3 executable.`);
  if (result.error || result.status !== 0) failed = true;
}
process.exitCode = failed ? 1 : 0;
