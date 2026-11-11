// Exercises the mouse and keyboard hooks together against the library this
// package loads (build/libwebview.dll, or WEBVIEW_PATH): installs the keyboard
// hook, then the mouse hook, pumps this thread's messages, synthesises key and
// mouse input with SendInput, and checks what the hooks saw: the modifiers on
// mouse messages, DOM codes, down / repeat / up, the modifiers after a key
// event, and that disposing the keyboard hook leaves the mouse hook running.
// Nothing is swallowed. Windows only: the message pump and the synthesised
// input are Win32.
//
// Flaky by construction: a low-level hook is served only while this thread
// pumps, the pump here is a JS timer, and Windows skips the hook for an input
// it cannot serve in time; an app that pumps natively (webview_run) never
// misses. Inputs are spaced apart so each hook call stands on its own; run it
// again on a miss.
//
//   bun scripts/hook-probe.ts

import { dlopen, FFIType, ptr } from "bun:ffi";
import {
  installKeyboardHook,
  installMouseHook,
  MouseEvent,
  type Modifiers,
} from "../src/index";

if (process.platform !== "win32") {
  console.error("hook-probe: Windows only (the synthesised input is Win32)");
  process.exit(2);
}

const user32 = dlopen("user32.dll", {
  PeekMessageW: {
    args: [FFIType.ptr, FFIType.ptr, FFIType.u32, FFIType.u32, FFIType.u32],
    returns: FFIType.i32,
  },
  TranslateMessage: { args: [FFIType.ptr], returns: FFIType.i32 },
  DispatchMessageW: { args: [FFIType.ptr], returns: FFIType.i64_fast },
  SendInput: {
    args: [FFIType.u32, FFIType.ptr, FFIType.i32],
    returns: FFIType.u32,
  },
});

// INPUT is 40 bytes on x64: DWORD type, then at offset 8 the union of
// MOUSEINPUT { LONG dx, dy; DWORD mouseData, dwFlags, time; ULONG_PTR extra } and
// KEYBDINPUT { WORD wVk, wScan; DWORD dwFlags, time; ULONG_PTR extra }.
const INPUT_MOUSE = 0;
const INPUT_KEYBOARD = 1;
const MOUSEEVENTF_MOVE = 0x0001;
const MOUSEEVENTF_WHEEL = 0x0800;
const KEYEVENTF_EXTENDEDKEY = 0x0001;
const KEYEVENTF_KEYUP = 0x0002;
const KEYEVENTF_SCANCODE = 0x0008;
const VK_SHIFT = 0x10;
const VK_CONTROL = 0x11;
const VK_MENU = 0x12;
const VK_DELETE = 0x2e;
const SCAN_Z = 0x2c;

const input = new Uint8Array(40);
const dv = new DataView(input.buffer);
function mouse(dx: number, dy: number, flags: number, data = 0) {
  input.fill(0);
  dv.setUint32(0, INPUT_MOUSE, true);
  dv.setInt32(8, dx, true);
  dv.setInt32(12, dy, true);
  dv.setUint32(16, data, true);
  dv.setUint32(20, flags, true);
  if (user32.symbols.SendInput(1, ptr(input), 40) !== 1)
    console.log("SendInput(mouse) sent nothing");
}
function key(vk: number, scan: number, flags: number) {
  input.fill(0);
  dv.setUint32(0, INPUT_KEYBOARD, true);
  dv.setUint16(8, vk, true);
  dv.setUint16(10, scan, true);
  dv.setUint32(12, flags, true);
  if (user32.symbols.SendInput(1, ptr(input), 40) !== 1)
    console.log("SendInput(key) sent nothing");
}

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
const mods = (m: Modifiers) =>
  [m.shift && "shift", m.ctrl && "ctrl", m.alt && "alt", m.meta && "meta"]
    .filter(Boolean)
    .join("+") || "-";

type Seen = { n: number; line: string };
const seen: Seen[] = [];
let step = 0;
let moves = 0;
const note = (line: string) => seen.push({ n: step, line });

// Keyboard first, then mouse: the order the library must not care about.
const keys = installKeyboardHook((m) => {
  note(
    `key ${keyEventName[m.event]} ${m.code} raw=0x${m.raw.toString(16)} mods=${mods(m.modifiers)}`,
  );
  return false;
});
const mouseHook = installMouseHook((m) => {
  if (m.event === MouseEvent.Move) moves++;
  note(
    `mouse ${mouseEventName[m.event]}${m.wheel ? ` wheel=${m.wheel}` : ""} mods=${mods(m.modifiers)}`,
  );
  return false;
});
console.log("both hooks installed (keyboard, then mouse); pumping messages");

const msg = new Uint8Array(64); // MSG is 48 bytes on x64
const pump = setInterval(() => {
  while (user32.symbols.PeekMessageW(ptr(msg), null, 0, 0, 1)) {
    user32.symbols.TranslateMessage(ptr(msg));
    user32.symbols.DispatchMessageW(ptr(msg));
  }
}, 1);

// Each step is one input, spaced apart; `expect` is what the hooks must have reported for that step.
type Step = {
  do: () => void;
  expect?: (lines: string[]) => string | undefined;
};
const has = (lines: string[], prefix: string) =>
  lines.some((l) => l.startsWith(prefix));
const want = (prefix: string) => (lines: string[]) =>
  has(lines, prefix)
    ? undefined
    : `expected "${prefix}", got [${lines.join(" | ")}]`;
const steps: Step[] = [
  { do: () => key(VK_SHIFT, 0, 0), expect: want("key Down Shift") },
  {
    do: () => mouse(3, 0, MOUSEEVENTF_MOVE),
    expect: want("mouse Move mods=shift"),
  },
  { do: () => key(VK_SHIFT, 0, KEYEVENTF_KEYUP), expect: want("key Up Shift") },
  {
    do: () => mouse(-3, 0, MOUSEEVENTF_MOVE),
    expect: want("mouse Move mods=-"),
  },
  { do: () => key(VK_CONTROL, 0, 0), expect: want("key Down Control") },
  {
    do: () => mouse(0, 0, MOUSEEVENTF_WHEEL, 120),
    expect: want("mouse Wheel wheel=1 mods=ctrl"),
  },
  // Z by scan code alone, as a keyboard sends it; held, so the second down is a repeat.
  {
    do: () => key(0, SCAN_Z, KEYEVENTF_SCANCODE),
    expect: want("key Down KeyZ raw=0x5a mods=ctrl"),
  },
  {
    do: () => key(0, SCAN_Z, KEYEVENTF_SCANCODE),
    expect: want("key Repeat KeyZ raw=0x5a mods=ctrl"),
  },
  {
    do: () => key(0, SCAN_Z, KEYEVENTF_SCANCODE | KEYEVENTF_KEYUP),
    expect: want("key Up KeyZ raw=0x5a mods=ctrl"),
  },
  {
    do: () => key(VK_CONTROL, 0, KEYEVENTF_KEYUP),
    expect: want("key Up Control"),
  },
  // Delete by virtual key alone (no scan code): the library derives the extended scan code.
  {
    do: () => key(VK_DELETE, 0, 0),
    expect: want("key Down Delete raw=0x2e mods=-"),
  },
  {
    do: () => key(VK_DELETE, 0, KEYEVENTF_KEYUP),
    expect: want("key Up Delete raw=0x2e mods=-"),
  },
  // Delete by its extended scan code (E0 53), as the keyboard sends it.
  {
    do: () => key(0, 0x53, KEYEVENTF_SCANCODE | KEYEVENTF_EXTENDEDKEY),
    expect: want("key Down Delete"),
  },
  {
    do: () =>
      key(
        0,
        0x53,
        KEYEVENTF_SCANCODE | KEYEVENTF_EXTENDEDKEY | KEYEVENTF_KEYUP,
      ),
    expect: want("key Up Delete"),
  },
  { do: () => key(VK_MENU, 0, 0), expect: want("key Down Alt") },
  {
    do: () => mouse(3, 0, MOUSEEVENTF_MOVE),
    expect: want("mouse Move mods=alt"),
  },
  { do: () => key(VK_MENU, 0, KEYEVENTF_KEYUP), expect: want("key Up Alt") },
  // Dispose the keyboard hook; the mouse hook must still deliver.
  { do: () => keys.dispose() },
  {
    do: () => mouse(-3, 0, MOUSEEVENTF_MOVE),
    expect: want("mouse Move mods=-"),
  },
];
const GAP = 250;
steps.forEach((s, i) =>
  setTimeout(
    () => {
      step = i;
      s.do();
    },
    600 + i * GAP,
  ),
);

setTimeout(
  () => {
    clearInterval(pump);
    mouseHook.dispose();
    for (const s of seen) console.log(`  [${s.n}] ${s.line}`);
    const failures: string[] = [];
    steps.forEach((s, i) => {
      const lines = seen.filter((x) => x.n === i).map((x) => x.line);
      const problem = s.expect?.(lines);
      if (problem) failures.push(`step ${i}: ${problem}`);
    });
    for (const f of failures) console.log(f);
    console.log(`moves: ${moves}`);
    console.log(
      failures.length
        ? "FAIL: the hooks missed or misreported some of the synthesised input"
        : "OK: modifiers on mouse messages, DOM codes, down/repeat/up, and the mouse hook outliving the keyboard hook",
    );
    process.exit(failures.length ? 1 : 0);
  },
  600 + steps.length * GAP + 500,
);
