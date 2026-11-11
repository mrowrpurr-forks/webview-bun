// Tests the permission model and its toggles as an app of its own, one command per grant combination:
//
//   bun scripts/permission-probe.ts none               # resets the probe app's grants first, then runs
//   bun scripts/permission-probe.ts device-control     # after you switched the app on in that row
//   bun scripts/permission-probe.ts input-monitoring   # that row on, Device Control and Data Access off
//   bun scripts/permission-probe.ts both
//
// The argument is what the probe app holds in System Settings > Privacy & Security when you run the
// command. The runner compiles scripts/permission-probe-app.ts into dist/permission-probe.app (its own
// bundle id, dev.n1h.sweetview.permission-probe, so grants land on it and not on your terminal), signs
// it ad hoc, launches it with open and waits, then prints each check with PASS or FAIL and how many
// system dialogs that run should have shown you. The bundle is built once and reused, so its identity,
// and with it the grants, survive between runs; --rebuild builds it again (after which macOS forgets its
// grants, because an ad-hoc signature changes with the binary).
//
// On Windows and Linux there are no such permissions: the one combination is "not-applicable", the
// executable is run directly, and the expected answers are empty needs and not-applicable statuses.

import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { $ } from "bun";

const combos = ["none", "device-control", "input-monitoring", "both"] as const;
const args = process.argv.slice(2);
const rebuild = args.includes("--rebuild");
const combo = args.find((a) => !a.startsWith("--"));
const mac = process.platform === "darwin";

if (mac && !combos.includes(combo as (typeof combos)[number])) {
  console.error(
    `usage: bun scripts/permission-probe.ts <${combos.join(" | ")}> [--rebuild]`,
  );
  process.exit(2);
}
const expect = mac ? combo! : "not-applicable";

const root = new URL("..", import.meta.url).pathname.replace(
  /^\/([A-Za-z]:)/,
  "$1",
);
const dist = join(root, "dist");
const name = "permission-probe";
const bundleId = "dev.n1h.sweetview.permission-probe";
const app = join(dist, `${name}.app`);
const binary = mac
  ? join(app, "Contents", "MacOS", name)
  : join(dist, name + (process.platform === "win32" ? ".exe" : ""));

if (rebuild && existsSync(mac ? app : binary))
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
      `built ${app} (${bundleId}); macOS forgets its grants whenever it is rebuilt`,
    );
  }
}

if (mac && expect === "none") {
  console.log(`resetting every grant of ${bundleId}`);
  await $`tccutil reset All ${bundleId}`.nothrow().quiet();
}

const report = join(dist, `${name}-report.json`);
rmSync(report, { force: true });
console.log(`running as ${mac ? app : binary}, expecting "${expect}"`);
if (mac)
  await $`open -W -n ${app} --args --expect ${expect} --report ${report}`
    .nothrow()
    .quiet();
else await $`${binary} --expect ${expect} --report ${report}`.nothrow().quiet();

if (!existsSync(report)) {
  console.log(
    "FAIL: the probe app wrote no report (did it launch? on macOS, Finder may call an unsigned copy damaged)",
  );
  process.exit(1);
}
const out = JSON.parse(readFileSync(report, "utf8")) as {
  checks: { name: string; expected: string; actual: string; pass: boolean }[];
  dialogsExpected: number;
};
const width = Math.max(...out.checks.map((c) => c.name.length));
for (const c of out.checks)
  console.log(
    `  ${c.pass ? "PASS" : "FAIL"}  ${c.name.padEnd(width)}  expected ${c.expected}${c.pass ? "" : `, got ${c.actual}`}`,
  );
const failed = out.checks.filter((c) => !c.pass).length;
if (mac)
  console.log(
    `system dialogs you should have seen during this run: ${out.dialogsExpected}`,
  );
console.log(
  failed
    ? `FAIL: ${failed} check(s) did not match "${expect}"`
    : `OK: every answer matches "${expect}"`,
);
process.exit(failed ? 1 : 0);
