// Both system-wide hooks in a window: every mouse event with its modifiers and every key event
// with its DOM code are written to the page, and Ctrl+Shift+K is swallowed (no window gets it)
// while this runs. Windows and macOS (macOS asks for the Accessibility permission once).
//
//   bun run examples/input-hooks.ts

import {
  installKeyboardHook,
  installMouseHook,
  KeyEvent,
  MouseEvent,
  Webview,
} from "../src/index";

const webview = new Webview();
webview.title = "Input hooks";
webview.setHTML(`<!doctype html>
<body style="font: 14px monospace; margin: 1em">
  <p>Press keys and move the mouse anywhere on the system. Ctrl+Shift+K is swallowed while this window runs.</p>
  <pre id="log"></pre>
  <script>
    const log = document.getElementById("log");
    window.show = (line) => { log.textContent = (line + "\\n" + log.textContent).split("\\n").slice(0, 30).join("\\n"); };
  </script>
</body>`);

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
const show = (line: string) => webview.eval(`show(${JSON.stringify(line)})`);
const mods = (m: {
  shift: boolean;
  ctrl: boolean;
  alt: boolean;
  meta: boolean;
}) =>
  [m.shift && "Shift", m.ctrl && "Ctrl", m.alt && "Alt", m.meta && "Meta"]
    .filter(Boolean)
    .join("+");

const keys = installKeyboardHook((m) => {
  if (m.event !== KeyEvent.Repeat)
    show(
      `key ${keyEventName[m.event]} ${m.code} (raw ${m.raw}) ${mods(m.modifiers)}`,
    );
  return m.code === "KeyK" && m.modifiers.ctrl && m.modifiers.shift;
});
const mouse = installMouseHook((m) => {
  if (m.event !== MouseEvent.Move)
    show(
      `mouse ${mouseEventName[m.event]} at ${m.x},${m.y}${m.wheel ? ` wheel ${m.wheel}` : ""} ${mods(m.modifiers)}`,
    );
  return false;
});

webview.run();
keys.dispose();
mouse.dispose();
