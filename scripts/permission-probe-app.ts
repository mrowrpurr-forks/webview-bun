// What runs inside each permission test app (scripts/permission-probe.ts builds and launches them):
// exercises the permission model and the two toggles for one scenario against the grant this app
// holds, compares every answer with what the phase demands, and writes the report the runner prints.
// Started by the runner with --scenario <s> --phase <before|after|not-applicable> --report <file>;
// not meant to be run by hand.
//
//   mouse-hook        the mouse hook needs Device Control and Data Access; refuses before, works after
//   keyboard-hook     the same for the keyboard hook
//   input-monitoring  asks for Input Monitoring only; the hooks refuse before and after, since that
//                     row is not the one they need, and the app never touches the other row

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

type Scenario = "mouse-hook" | "keyboard-hook" | "input-monitoring";
type Phase = "before" | "after" | "not-applicable";
type Check = { name: string; expected: string; actual: string; pass: boolean };
type Hook = MouseHook | KeyboardHook;

const DEVICE_CONTROL = "Device Control and Data Access";
const INPUT_MONITORING = "Input Monitoring";

const arg = (name: string) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const scenario = (arg("--scenario") ?? "mouse-hook") as Scenario;
const phase = (arg("--phase") ?? "not-applicable") as Phase;
const report = arg("--report");

const mac = process.platform === "darwin";
const granted: PermissionStatus = !mac
  ? "not-applicable"
  : phase === "after"
    ? "granted"
    : "missing";
const missing: PermissionStatus = mac ? "missing" : "not-applicable";

const checks: Check[] = [];
let rowAsked: string | null = null;
const check = (name: string, expected: string, actual: string) =>
  checks.push({ name, expected, actual, pass: expected === actual });
const attempt = (install: () => Hook): { outcome: string; hook?: Hook } => {
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
const hooks: Hook[] = [];
const installMouse = () => installMouseHook(() => false);
const installKeys = () => installKeyboardHook(() => false);

if (scenario === "input-monitoring") inputMonitoringScenario();
else hookScenario(scenario);

for (const h of hooks) h.dispose();

const out = { platform: process.platform, scenario, phase, checks, rowAsked };
if (report) writeFileSync(report, JSON.stringify(out, null, 2));
else console.log(JSON.stringify(out, null, 2));
process.exit(checks.every((c) => c.pass) ? 0 : 1);

// One hook, needing Device Control and Data Access: refused and asked for before, working after.
function hookScenario(which: "mouse-hook" | "keyboard-hook") {
  const feature =
    which === "mouse-hook" ? Feature.MouseHook : Feature.KeyboardHook;
  const install = which === "mouse-hook" ? installMouse : installKeys;
  const label = which === "mouse-hook" ? "MouseHook" : "KeyboardHook";
  const installs =
    process.platform === "linux"
      ? "throws"
      : granted === "missing"
        ? "throws"
        : "ok";

  // 1. What the hook needs here: DeviceControl on macOS, nothing elsewhere.
  check(
    `needed(${label})`,
    mac ? "[DeviceControl]" : "[]",
    `[${permissions.needed(feature).map(nameOf).join(", ")}]`,
  );

  // 2. Status, silently. Input Monitoring stays missing: this app never asks for it.
  check(
    "status(DeviceControl)",
    granted,
    permissions.status(Permission.DeviceControl),
  );
  check(
    "status(InputMonitoring)",
    missing,
    permissions.status(Permission.InputMonitoring),
  );
  check(
    `ready(${label})`,
    String(granted !== "missing"),
    String(permissions.ready(feature)),
  );

  // 3. autoRequest off: an install may fail, and asks for nothing.
  permissions.autoRequest = false;
  const quiet = attempt(install);
  if (quiet.hook) hooks.push(quiet.hook);
  check("install with autoRequest off", installs, outcomeOf(quiet));
  check(
    "error names the row (autoRequest off)",
    String(granted === "missing"),
    String(quiet.outcome.includes(DEVICE_CONTROL)),
  );

  // 4. autoRequest on: a failing install asks the system once; a second failing install does not ask again.
  permissions.autoRequest = true;
  const loud = attempt(install);
  if (loud.hook) hooks.push(loud.hook);
  check("install with autoRequest on", installs, outcomeOf(loud));
  if (granted === "missing") rowAsked = DEVICE_CONTROL;
  if (!loud.hook) {
    const again = attempt(install);
    check("second failing install", "throws", outcomeOf(again));
  }

  // 5. request(DeviceControl): the same row again while missing, granted when granted.
  check(
    "request(DeviceControl)",
    granted,
    permissions.request(Permission.DeviceControl),
  );
}

// Input Monitoring only: the one path that touches that row. Granting it changes nothing for the
// hooks, which is the proof that they need the other row. autoRequest stays off so that nothing
// here ever asks for Device Control and Data Access.
function inputMonitoringScenario() {
  permissions.autoRequest = false;
  const installs = process.platform === "win32" ? "ok" : "throws";

  // 1. Neither hook needs Input Monitoring.
  check(
    "needed(MouseHook) has InputMonitoring",
    "false",
    String(
      permissions
        .needed(Feature.MouseHook)
        .includes(Permission.InputMonitoring),
    ),
  );
  check(
    "needed(KeyboardHook) has InputMonitoring",
    "false",
    String(
      permissions
        .needed(Feature.KeyboardHook)
        .includes(Permission.InputMonitoring),
    ),
  );

  // 2. Status, silently. Device Control stays missing in both phases: this app never asks for it.
  check(
    "status(InputMonitoring)",
    granted,
    permissions.status(Permission.InputMonitoring),
  );
  check(
    "status(DeviceControl)",
    missing,
    permissions.status(Permission.DeviceControl),
  );
  check(
    "ready(KeyboardHook)",
    String(!mac),
    String(permissions.ready(Feature.KeyboardHook)),
  );

  // 3. request(InputMonitoring): asks while missing, granted when granted.
  check(
    "request(InputMonitoring)",
    granted,
    permissions.request(Permission.InputMonitoring),
  );
  if (granted === "missing") rowAsked = INPUT_MONITORING;

  // 4. The hooks refuse either way, and the error names the row they do need.
  for (const [label, install] of [
    ["mouse", installMouse],
    ["keyboard", installKeys],
  ] as const) {
    const r = attempt(install);
    if (r.hook) hooks.push(r.hook);
    check(`install ${label} hook (autoRequest off)`, installs, outcomeOf(r));
    check(
      `${label} error names ${DEVICE_CONTROL}`,
      String(mac),
      String(r.outcome.includes(DEVICE_CONTROL)),
    );
  }
}

function nameOf(p: Permission): string {
  return p === Permission.DeviceControl
    ? "DeviceControl"
    : p === Permission.InputMonitoring
      ? "InputMonitoring"
      : String(p);
}
