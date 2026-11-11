// Tests the permission model as one app per grant. macOS grants belong to an app, so each test app
// asks for exactly one row of System Settings > Privacy & Security and is named for what it asks;
// the dialog says which app wants which row, and each app ends up listed under one row only.
//
//   bun scripts/permission-probe.ts mouse-hook before        # grants wiped: install refuses and asks for Device Control and Data Access
//   bun scripts/permission-probe.ts mouse-hook after         # that row allowed: install works, nothing asked
//   bun scripts/permission-probe.ts keyboard-hook before      # the same pair for the keyboard hook
//   bun scripts/permission-probe.ts keyboard-hook after
//   bun scripts/permission-probe.ts input-monitoring before   # asks for Input Monitoring only
//   bun scripts/permission-probe.ts input-monitoring after    # allowed: the hooks still refuse (they need the other row)
//
// `before` resets the app's grants first (tccutil), launches it, and expects every refusal; allow the
// row in the dialog it raises (or in System Settings), then `after` expects every success. The runner
// compiles scripts/permission-probe-app.ts into dist/sweetview-<scenario>-test.app (see
// scripts/test-app.ts for the bundle, its identity and when it is rebuilt), launches it and waits,
// then prints each check with PASS or FAIL and which row the run should have asked for.
//
// On Windows and Linux there are no such permissions: the one phase is "not-applicable", the
// executable is run directly, and the expected answers are empty needs and not-applicable statuses.

import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { buildTestApp, dist, mac, resetGrants, runTestApp } from "./test-app";

const scenarios = ["mouse-hook", "keyboard-hook", "input-monitoring"] as const;
const phases = ["before", "after"] as const;
type Scenario = (typeof scenarios)[number];
type Phase = (typeof phases)[number];

const args = process.argv.slice(2);
const rebuild = args.includes("--rebuild");
const [scenario, phaseArg] = args.filter((a) => !a.startsWith("--"));

const usage = `usage: bun scripts/permission-probe.ts <${scenarios.join(" | ")}> ${mac ? `<${phases.join(" | ")}> ` : ""}[--rebuild]`;
if (!scenarios.includes(scenario as Scenario)) {
  console.error(usage);
  process.exit(2);
}
if (mac && !phases.includes(phaseArg as Phase)) {
  console.error(usage);
  process.exit(2);
}
const phase = mac ? (phaseArg as Phase) : "not-applicable";

const app = await buildTestApp(
  `${scenario}-test`,
  "scripts/permission-probe-app.ts",
  rebuild,
);
if (phase === "before") await resetGrants(app);

const report = join(dist, `${app.name}-report.json`);
rmSync(report, { force: true });
console.log(`running ${app.app}: ${scenario}, ${phase}`);
await runTestApp(app, [
  "--scenario",
  scenario!,
  "--phase",
  phase,
  "--report",
  report,
]);

if (!existsSync(report)) {
  console.log(
    "FAIL: the test app wrote no report (did it launch? on macOS, Finder may call an unsigned copy damaged)",
  );
  process.exit(1);
}
const out = JSON.parse(readFileSync(report, "utf8")) as {
  checks: { name: string; expected: string; actual: string; pass: boolean }[];
  rowAsked: string | null;
};
const width = Math.max(...out.checks.map((c) => c.name.length));
for (const c of out.checks)
  console.log(
    `  ${c.pass ? "PASS" : "FAIL"}  ${c.name.padEnd(width)}  expected ${c.expected}${c.pass ? "" : `, got ${c.actual}`}`,
  );
const failed = out.checks.filter((c) => !c.pass).length;
if (mac)
  console.log(
    out.rowAsked
      ? `this run should have asked you for: ${out.rowAsked} (for ${app.name})`
      : "this run should have asked you for nothing",
  );
console.log(
  failed
    ? `FAIL: ${failed} check(s) did not match "${scenario} ${phase}"`
    : `OK: every answer matches "${scenario} ${phase}"`,
);
process.exit(failed ? 1 : 0);
