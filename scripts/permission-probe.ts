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
// compiles scripts/permission-probe-app.ts into dist/sweetview-<scenario>-test.app (bundle id
// dev.n1h.sweetview.<scenario>-test), signs it ad hoc, launches it with open and waits, then prints
// each check with PASS or FAIL and which row the run should have asked for. A bundle is built once and
// reused, so its identity, and with it the grant, survives between runs; --rebuild builds it again
// (after which macOS forgets the grant, because an ad-hoc signature changes with the binary).
//
// On Windows and Linux there are no such permissions: the one phase is "not-applicable", the
// executable is run directly, and the expected answers are empty needs and not-applicable statuses.

import {
  chmodSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { $ } from "bun";

const scenarios = ["mouse-hook", "keyboard-hook", "input-monitoring"] as const;
const phases = ["before", "after"] as const;
type Scenario = (typeof scenarios)[number];
type Phase = (typeof phases)[number];

const args = process.argv.slice(2);
const rebuild = args.includes("--rebuild");
const [scenario, phaseArg] = args.filter((a) => !a.startsWith("--"));
const mac = process.platform === "darwin";

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

const root = new URL("..", import.meta.url).pathname.replace(
  /^\/([A-Za-z]:)/,
  "$1",
);
const dist = join(root, "dist");
const name = `sweetview-${scenario}-test`;
const bundleId = `dev.n1h.sweetview.${scenario}-test`;
const app = join(dist, `${name}.app`);
const binary = mac
  ? join(app, "Contents", "MacOS", name)
  : join(dist, name + (process.platform === "win32" ? ".exe" : ""));

// A bundle older than what goes into it (the app source, the bindings, the shipped library) would
// test stale code, so it is rebuilt, at the cost of its grant.
const stale =
  existsSync(binary) &&
  newestMtime([
    join(root, "scripts", "permission-probe-app.ts"),
    join(root, "src"),
    join(root, "build"),
  ]) > statSync(binary).mtimeMs;
if (stale && !rebuild)
  console.log(`${name} is older than its sources: rebuilding it`);
if ((rebuild || stale) && existsSync(mac ? app : binary))
  rmSync(mac ? app : binary, { recursive: true, force: true });
if (!existsSync(binary)) {
  mkdirSync(join(binary, ".."), { recursive: true });
  console.log(`compiling ${name}...`);
  await $`bun build --compile ${join(root, "scripts", "permission-probe-app.ts")} --outfile ${binary}`
    .cwd(root)
    .quiet();
  if (mac) {
    writeFileSync(
      join(app, "Contents", "Info.plist"),
      `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleName</key><string>${name}</string>
  <key>CFBundleDisplayName</key><string>${name}</string>
  <key>CFBundleIdentifier</key><string>${bundleId}</string>
  <key>CFBundleExecutable</key><string>${name}</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleVersion</key><string>1</string>
  <key>CFBundleShortVersionString</key><string>1.0</string>
  <key>CFBundleInfoDictionaryVersion</key><string>6.0</string>
  <key>LSUIElement</key><true/>
</dict></plist>
`,
    );
    chmodSync(binary, 0o755);
    await $`codesign --sign - --force --deep ${app}`.quiet();
    console.log(
      `built ${app} (${bundleId}); macOS forgets its grant whenever it is rebuilt`,
    );
  }
}

if (mac && phase === "before") {
  console.log(`resetting every grant of ${bundleId}`);
  await $`tccutil reset All ${bundleId}`.nothrow().quiet();
}

const report = join(dist, `${name}-report.json`);
rmSync(report, { force: true });
console.log(`running ${mac ? app : binary}: ${scenario}, ${phase}`);
if (mac)
  await $`open -W -n ${app} --args --scenario ${scenario} --phase ${phase} --report ${report}`
    .nothrow()
    .quiet();
else
  await $`${binary} --scenario ${scenario} --phase ${phase} --report ${report}`
    .nothrow()
    .quiet();

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
      ? `this run should have asked you for: ${out.rowAsked} (for ${name})`
      : "this run should have asked you for nothing",
  );
console.log(
  failed
    ? `FAIL: ${failed} check(s) did not match "${scenario} ${phase}"`
    : `OK: every answer matches "${scenario} ${phase}"`,
);
process.exit(failed ? 1 : 0);

function newestMtime(paths: string[]): number {
  let newest = 0;
  for (const p of paths) {
    if (!existsSync(p)) continue;
    const st = statSync(p);
    newest = Math.max(
      newest,
      st.isDirectory()
        ? newestMtime(readdirSync(p).map((f) => join(p, f)))
        : st.mtimeMs,
    );
  }
  return newest;
}
