import { readdir } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";

const directory = path.resolve("test");
const files = (await readdir(directory))
  .filter((name) => name.endsWith(".test.ts"))
  .sort()
  .map((name) => path.join(directory, name));

if (!files.length) throw new Error("No test files found.");

const child = spawn(process.execPath, ["--import", "tsx", "--test", ...files], {
  stdio: "inherit",
  shell: false,
});

child.on("error", (error) => { throw error; });
child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exitCode = code ?? 1;
});
