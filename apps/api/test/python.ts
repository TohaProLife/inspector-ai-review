import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { delimiter, join } from "node:path";
import { fileURLToPath } from "node:url";

export const projectRoot = fileURLToPath(new URL("../../../", import.meta.url));
export const workerRoot = join(projectRoot, "services", "worker");
const virtualEnvironmentPython = join(workerRoot, ".venv",
  process.platform === "win32" ? "Scripts/python.exe" : "bin/python");

export const pythonExecutable = process.env.PYTHON_BIN
  ?? (existsSync(virtualEnvironmentPython) ? virtualEnvironmentPython
    : process.platform === "win32" ? "python" : "python3");

export const pythonEnv = {
  PYTHONUTF8: "1",
  PYTHONPATH: [workerRoot, projectRoot, process.env.PYTHONPATH].filter(Boolean).join(delimiter),
};

export const pythonAvailable = spawnSync(pythonExecutable, ["--version"], {
  env: { ...process.env, ...pythonEnv }, encoding: "utf8", timeout: 10_000,
}).status === 0;
