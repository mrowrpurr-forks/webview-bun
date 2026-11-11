// What runs inside the permission probe's app bundle (scripts/permission-probe.ts builds and launches
// it): exercises the permission model and the two toggles against the grants this app holds, compares
// every answer with what the expected grant combination demands, and writes the report the runner
// prints. Started by the runner with --expect <combo> --report <file>; not meant to be run by hand.

import { writeFileSync } from "node:fs";
import {
  Feature,
  installKeyboardHook,
  installMouseHook,
  Permission,
  permissions,
  type KeyboardHook,
  type MouseHook,
  type PermissionStatus,
} from "../src/index";

type Combo =
  "none" | "device-control" | "input-monitoring" | "both" | "not-applicable";
type Check = { name: string; expected: string; actual: string; pass: boolean };

const arg = (name: string) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const combo = (arg("--expect") ?? "not-applicable") as Combo;
const report = arg("--report");

const hasPermissions = process.platform === "darwin";
const dc: PermissionStatus = !hasPermissions
  ? "not-applicable"
  : combo === "device-control" || combo === "both"
    ? "granted"
    : "missing";
const im: PermissionStatus = !hasPermissions
  ? "not-applicable"
  : combo === "input-monitoring" || combo === "both"
    ? "granted"
    : "missing";
const installs =
  process.platform === "linux" ? "throws" : dc === "missing" ? "throws" : "ok";

const checks: Check[] = [];
let dialogs = 0;
const check = (name: string, expected: string, actual: string) =>
  checks.push({ name, expected, actual, pass: expected === actual });
const attempt = (
  install: () => MouseHook | KeyboardHook,
): { outcome: string; hook?: MouseHook | KeyboardHook } => {
  try {
    return { outcome: "ok", hook: install() };
  } catch (err) {
    return {
      outcome: `throws: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
};
const outcomeOf = (r: { outcome: string }) =>
  r.outcome === "ok" ? "ok" : "throws";
const hooks: (MouseHook | KeyboardHook)[] = [];

// 1. What the hooks need here: the same for both, DeviceControl on macOS, nothing elsewhere.
const neededMouse = permissions.needed(Feature.MouseHook);
const neededKeys = permissions.needed(Feature.KeyboardHook);
check(
  "needed(MouseHook)",
  hasPermissions ? "[DeviceControl]" : "[]",
  `[${neededMouse.map(nameOf).join(", ")}]`,
);
check(
  "needed(KeyboardHook)",
  hasPermissions ? "[DeviceControl]" : "[]",
  `[${neededKeys.map(nameOf).join(", ")}]`,
);

// 2. Status, silently.
check(
  "status(DeviceControl)",
  dc,
  permissions.status(Permission.DeviceControl),
);
check(
  "status(InputMonitoring)",
  im,
  permissions.status(Permission.InputMonitoring),
);
check(
  "ready(KeyboardHook)",
  String(dc !== "missing"),
  String(permissions.ready(Feature.KeyboardHook)),
);

// 3. autoRequest off: an install may fail, and asks for nothing.
permissions.autoRequest = false;
const quiet = attempt(() => installKeyboardHook(() => false));
if (quiet.hook) hooks.push(quiet.hook);
check("install with autoRequest off", installs, outcomeOf(quiet));
check(
  "error names the permission (autoRequest off)",
  String(dc === "missing"),
  String(quiet.outcome.includes("Device Control and Data Access")),
);

// 4. autoRequest on: a failing install asks the system once; a second failing install does not ask again.
permissions.autoRequest = true;
const loud = attempt(() => installMouseHook(() => false));
if (loud.hook) hooks.push(loud.hook);
check("install with autoRequest on", installs, outcomeOf(loud));
if (dc === "missing") dialogs += 1;
if (!loud.hook) {
  const again = attempt(() => installMouseHook(() => false));
  check("second failing install", "throws", outcomeOf(again));
}

// 5. request(DeviceControl): asks while missing, says granted when granted.
check(
  "request(DeviceControl)",
  dc,
  permissions.request(Permission.DeviceControl),
);
if (dc === "missing") dialogs += 1;

// 6. request(InputMonitoring): the only path that ever touches that row.
check(
  "request(InputMonitoring)",
  im,
  permissions.request(Permission.InputMonitoring),
);
if (im === "missing") dialogs += 1;

for (const h of hooks) h.dispose();

const out = {
  platform: process.platform,
  combo,
  checks,
  dialogsExpected: dialogs,
};
if (report) writeFileSync(report, JSON.stringify(out, null, 2));
else console.log(JSON.stringify(out, null, 2));
process.exit(checks.every((c) => c.pass) ? 0 : 1);

function nameOf(p: Permission): string {
  return p === Permission.DeviceControl
    ? "DeviceControl"
    : p === Permission.InputMonitoring
      ? "InputMonitoring"
      : String(p);
}
