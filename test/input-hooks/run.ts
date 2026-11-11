// The input-hooks test suite, in one command: `bun run test` from the package root.
//
// Runs, in order:
//   1. hooks.ts: both hooks against the shipped library with synthesized input (Windows, macOS).
//   2. permissions.ts for each test app (mouse-hook, keyboard-hook, input-monitoring): `before`
//      with the app's grant wiped, then `after` with it allowed.
//
// On macOS each app asks for its permission once; the suite stops at each dialog and waits for Enter
// after it has been allowed. On Windows and Linux there is nothing to allow and the suite runs through.
// Exit code is non-zero when any step fails.

import { $ } from "bun";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { root } from "./app-bundle";

const mac = process.platform === "darwin";
const linux = process.platform === "linux";
const apps = ["mouse-hook", "keyboard-hook", "input-monitoring"] as const;
const results: { step: string; status: "pass" | "fail" | "skip" }[] = [];

async function run(step: string, script: string, args: string[]) {
  console.log(`\n=== ${step}`);
  const r = await $`bun ${join(root, "test", "input-hooks", script)} ${args}`
    .cwd(root)
    .nothrow();
  const out = r.stdout.toString() + r.stderr.toString();
  process.stdout.write(out);
  return { code: r.exitCode, out };
}

function record(step: string, status: "pass" | "fail" | "skip") {
  results.push({ step, status });
}

async function waitForEnter(what: string) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  await new Promise<void>((resolve) => {
    rl.on("close", resolve); // stdin closed (not a terminal): go on without waiting
    rl.question(`\n>>> Allow the dialog for ${what}, then press Enter. `, () =>
      resolve(),
    );
  });
  rl.close();
}

// 1. The hooks with synthesized input.
if (linux) record("hooks", "skip");
else {
  let r = await run("hooks", "hooks.ts", []);
  if (mac && r.out.includes("no grant yet")) {
    await waitForEnter("sweetview-hooks-test");
    r = await run("hooks (allowed)", "hooks.ts", []);
  }
  record("hooks", r.code === 0 ? "pass" : "fail");
}

// 2. The permission model, one app per grant.
for (const app of apps) {
  if (mac) {
    const before = await run(`${app} before`, "permissions.ts", [
      app,
      "before",
    ]);
    record(`${app} before`, before.code === 0 ? "pass" : "fail");
    await waitForEnter(`sweetview-${app}-test`);
    const after = await run(`${app} after`, "permissions.ts", [app, "after"]);
    record(`${app} after`, after.code === 0 ? "pass" : "fail");
  } else {
    const r = await run(app, "permissions.ts", [app]);
    record(app, r.code === 0 ? "pass" : "fail");
  }
}

console.log("\n=== summary");
const width = Math.max(...results.map((r) => r.step.length));
for (const r of results)
  console.log(`  ${r.status.toUpperCase().padEnd(4)}  ${r.step.padEnd(width)}`);
const failed = results.filter((r) => r.status === "fail").length;
console.log(failed ? `FAIL: ${failed} step(s)` : "OK: every step passed");
process.exit(failed ? 1 : 0);
