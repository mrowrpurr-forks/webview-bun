// Both system-wide hooks in a window, with the permission model in front: what the hooks need on
// this platform, whether it is granted, and asking for it in the app's own time (never behind the
// app's back: `permissions.autoRequest` is off here). Every mouse event with its modifiers and every
// key event with its DOM code are written to the page, and Ctrl+Shift+K is swallowed (no window
// gets it) while this runs. Windows and macOS.
//
//   bun run examples/input-hooks.ts

import {
  Feature,
  installKeyboardHook,
  installMouseHook,
  KeyEvent,
  MouseEvent,
  permissions,
  Webview,
  type KeyboardHook,
  type MouseHook,
} from "../src/index";

// ---- the permission toggle: the app decides when, if ever, the system asks the user ----------------

permissions.autoRequest = false; // a failing install stays quiet; the app asks below, on its own terms

/** The permissions both hooks need here and are not yet granted (none on Windows and Linux). */
function missingPermissions() {
  const needed = new Set([
    ...permissions.needed(Feature.MouseHook),
    ...permissions.needed(Feature.KeyboardHook),
  ]);
  return [...needed].filter((p) => permissions.status(p) === "missing");
}

/** Asks the user for what is missing, once, having said why; true when everything is granted afterwards. */
function askForPermissions(): boolean {
  const missing = missingPermissions();
  if (missing.length === 0) return true;
  console.log(
    "The hooks need a permission you can grant in System Settings > Privacy & Security; asking now.",
  );
  return missing.every((p) => permissions.request(p) === "granted");
}

// ---- the hooks' own toggle: on is install, off is dispose -----------------------------------------

let mouse: MouseHook | undefined;
let keys: KeyboardHook | undefined;

function enableInputHooks(show: (line: string) => void): boolean {
  try {
    keys ??= installKeyboardHook((m) => {
      if (m.event !== KeyEvent.Repeat)
        show(
          `key ${keyEventName[m.event]} ${m.code} (raw ${m.raw}) ${mods(m.modifiers)}`,
        );
      return m.code === "KeyK" && m.modifiers.ctrl && m.modifiers.shift;
    });
    mouse ??= installMouseHook((m) => {
      if (m.event !== MouseEvent.Move)
        show(
          `mouse ${mouseEventName[m.event]} at ${m.x},${m.y}${m.wheel ? ` wheel ${m.wheel}` : ""} ${mods(m.modifiers)}`,
        );
      return false;
    });
    return true;
  } catch (err) {
    disableInputHooks();
    console.warn(
      `input hooks off: ${err instanceof Error ? err.message : err}`,
    );
    return false;
  }
}

function disableInputHooks() {
  keys?.dispose();
  mouse?.dispose();
  keys = mouse = undefined;
}

// ---- the window ----------------------------------------------------------------------------------

const keyEventName = ["Down", "Up", "Repeat"];
const mouseEventName = [
  "Move",
  "LeftDown",
  "LeftUp",
  "RightDown",
  "RightUp",
  "MiddleDown",
  "MiddleUp",
  "Wheel",
];
const mods = (m: {
  shift: boolean;
  ctrl: boolean;
  alt: boolean;
  meta: boolean;
}) =>
  [m.shift && "Shift", m.ctrl && "Ctrl", m.alt && "Alt", m.meta && "Meta"]
    .filter(Boolean)
    .join("+");

const webview = new Webview();
webview.title = "Input hooks";
const show = (line: string) => webview.eval(`show(${JSON.stringify(line)})`);

const granted = askForPermissions();
const on = granted && enableInputHooks(show);
const state = on
  ? "Hooks on. Press keys and move the mouse anywhere on the system; Ctrl+Shift+K is swallowed."
  : granted
    ? "Hooks off: this platform has none, or the install failed (see the console)."
    : "Hooks off: grant the permission in System Settings > Privacy & Security and run again.";

// The state is part of the page: an eval before the page has loaded is dropped (macOS WebKit).
webview.setHTML(`<!doctype html>
<body style="font: 14px monospace; margin: 1em">
  <p id="state">${state}</p>
  <pre id="log"></pre>
  <script>
    const log = document.getElementById("log");
    window.show = (line) => { log.textContent = (line + "\\n" + log.textContent).split("\\n").slice(0, 30).join("\\n"); };
  </script>
</body>`);

webview.run();
disableInputHooks();
