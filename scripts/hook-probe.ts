// Exercises the mouse and keyboard hooks together against the library this
// package loads (build/libwebview.dll or .dylib, or WEBVIEW_PATH): installs the
// keyboard hook, then the mouse hook, pumps this thread's messages, synthesises
// key and mouse input (SendInput on Windows, CGEventPost on macOS), and checks
// what the hooks saw: the modifiers on mouse messages, DOM codes, down / repeat
// / up, the modifiers after a key event, disposing the keyboard hook from
// inside its own handler, and that the mouse hook outlives it. Nothing else is
// swallowed. Linux has no hooks, so the probe does not run there.
//
// Flaky by construction: a low-level hook is served only while this thread
// pumps, the pump here is a JS timer, and the OS skips a hook it cannot serve
// in time; an app that pumps natively (webview_run) never misses. Inputs are
// spaced apart so each hook call stands on its own; run it again on a miss.
//
//   bun scripts/hook-probe.ts
//
// On macOS the probe runs as an app of its own, dist/sweetview-hook-probe-test.app (scripts/test-app.ts
// builds it), so that the tap's grant, Device Control and Data Access, lands on that app and not on
// the terminal: the first run refuses and asks, allow it, the next run delivers. The app writes its
// output to the --log file the terminal gives it and the terminal prints it.

import { dlopen, FFIType, ptr } from "bun:ffi";
import { appendFileSync, existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import {
  installKeyboardHook,
  installMouseHook,
  MouseEvent,
  type Modifiers,
} from "../src/index";

const logFile = process.argv[process.argv.indexOf("--log") + 1];
if (process.platform === "darwin" && !process.argv.includes("--log")) {
  const { buildTestApp, dist, runTestApp } = await import("./test-app");
  const app = await buildTestApp(
    "hook-probe-test",
    "scripts/hook-probe.ts",
    process.argv.includes("--rebuild"),
  );
  const log = join(dist, `${app.name}.log`);
  rmSync(log, { force: true });
  console.log(`running ${app.app}`);
  await runTestApp(app, ["--log", log]);
  if (!existsSync(log)) {
    console.log("FAIL: the probe app wrote no log (did it launch?)");
    process.exit(1);
  }
  const text = readFileSync(log, "utf8");
  process.stdout.write(text);
  process.exit(/^OK:/m.test(text) ? 0 : 1);
}
if (logFile) {
  const toLog = (...parts: unknown[]) =>
    appendFileSync(logFile, parts.map(String).join(" ") + "\n");
  console.log = toLog;
  console.error = toLog;
}

// What the probe synthesises, in platform terms: a modifier or key by its platform code, a mouse move, a wheel notch,
// and a pump of the thread's queue, so the steps below read the same on both platforms.
type Input = {
  key(
    name: KeyName,
    down: boolean,
    opts?: { repeat?: boolean; scan?: boolean },
  ): void;
  move(): void;
  wheel(): void;
  pump(): void;
  raw: Record<"z" | "delete", number>;
};
type KeyName = "shift" | "control" | "alt" | "z" | "delete";

function windowsInput(): Input {
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
  const MOUSEEVENTF_MOVE = 0x0001;
  const MOUSEEVENTF_WHEEL = 0x0800;
  const KEYEVENTF_EXTENDEDKEY = 0x0001;
  const KEYEVENTF_KEYUP = 0x0002;
  const KEYEVENTF_SCANCODE = 0x0008;
  // Each key as a virtual key (sent bare, so the library derives the scan code) and as its scan code with the extended
  // flag (sent as the keyboard would).
  const keys: Record<KeyName, { vk: number; scan: number; extended: boolean }> =
    {
      shift: { vk: 0x10, scan: 0x2a, extended: false },
      control: { vk: 0x11, scan: 0x1d, extended: false },
      alt: { vk: 0x12, scan: 0x38, extended: false },
      z: { vk: 0x5a, scan: 0x2c, extended: false },
      delete: { vk: 0x2e, scan: 0x53, extended: true },
    };
  const input = new Uint8Array(40);
  const dv = new DataView(input.buffer);
  const send = () => {
    if (user32.symbols.SendInput(1, ptr(input), 40) !== 1)
      console.log("SendInput sent nothing");
  };
  const mouse = (dx: number, flags: number, data = 0) => {
    input.fill(0);
    dv.setInt32(8, dx, true);
    dv.setUint32(16, data, true);
    dv.setUint32(20, flags, true);
    send();
  };
  let dx = 3;
  const msg = new Uint8Array(64); // MSG is 48 bytes on x64
  return {
    key(name, down, opts = {}) {
      const k = keys[name];
      input.fill(0);
      dv.setUint32(0, 1, true); // INPUT_KEYBOARD
      let flags = down ? 0 : KEYEVENTF_KEYUP;
      if (opts.scan) {
        dv.setUint16(10, k.scan, true);
        flags |= KEYEVENTF_SCANCODE | (k.extended ? KEYEVENTF_EXTENDEDKEY : 0);
      } else {
        dv.setUint16(8, k.vk, true);
      }
      dv.setUint32(12, flags, true);
      send(); // a repeat is just another down while held
    },
    move: () => mouse((dx = -dx), MOUSEEVENTF_MOVE),
    wheel: () => mouse(0, MOUSEEVENTF_WHEEL, 120),
    pump() {
      while (user32.symbols.PeekMessageW(ptr(msg), null, 0, 0, 1)) {
        user32.symbols.TranslateMessage(ptr(msg));
        user32.symbols.DispatchMessageW(ptr(msg));
      }
    },
    raw: { z: 0x5a, delete: 0x2e },
  };
}

function macInput(): Input {
  const cg = dlopen(
    "/System/Library/Frameworks/ApplicationServices.framework/ApplicationServices",
    {
      CGEventCreate: { args: [FFIType.ptr], returns: FFIType.ptr },
      CGEventCreateKeyboardEvent: {
        args: [FFIType.ptr, FFIType.u16, FFIType.bool],
        returns: FFIType.ptr,
      },
      CGEventCreateScrollWheelEvent: {
        args: [FFIType.ptr, FFIType.u32, FFIType.u32, FFIType.i32],
        returns: FFIType.ptr,
      },
      CGEventSetType: {
        args: [FFIType.ptr, FFIType.u32],
        returns: FFIType.void,
      },
      CGEventSetFlags: {
        args: [FFIType.ptr, FFIType.u64],
        returns: FFIType.void,
      },
      CGEventSetIntegerValueField: {
        args: [FFIType.ptr, FFIType.u32, FFIType.i64],
        returns: FFIType.void,
      },
      CGEventPost: { args: [FFIType.u32, FFIType.ptr], returns: FFIType.void },
      CFRelease: { args: [FFIType.ptr], returns: FFIType.void },
      CFRunLoopRunInMode: {
        args: [FFIType.ptr, FFIType.f64, FFIType.bool],
        returns: FFIType.i32,
      },
      CFStringCreateWithCString: {
        args: [FFIType.ptr, FFIType.cstring, FFIType.u32],
        returns: FFIType.ptr,
      },
    },
  );
  const kCGHIDEventTap = 0;
  const kCGEventMouseMoved = 5;
  const kCGScrollEventUnitLine = 1;
  const kCGKeyboardEventAutorepeat = 8;
  const flagOf: Record<KeyName, bigint> = {
    shift: 0x20000n,
    control: 0x40000n,
    alt: 0x80000n,
    z: 0n,
    delete: 0n,
  };
  const keycode: Record<KeyName, number> = {
    shift: 0x38,
    control: 0x3b,
    alt: 0x3a,
    z: 0x06,
    delete: 0x75,
  };
  // The flags a posted event carries are whatever it is given, so the probe keeps the held modifiers itself.
  let held = 0n;
  const post = (event: ReturnType<typeof cg.symbols.CGEventCreate>) => {
    if (!event) throw new Error("CGEventCreate failed");
    cg.symbols.CGEventSetFlags(event, held);
    cg.symbols.CGEventPost(kCGHIDEventTap, event);
    cg.symbols.CFRelease(event);
  };
  const mode = cg.symbols.CFStringCreateWithCString(
    null,
    "kCFRunLoopDefaultMode",
    0x08000100,
  ); // UTF-8
  return {
    key(name, down, opts = {}) {
      if (flagOf[name])
        held = down ? held | flagOf[name] : held & ~flagOf[name];
      const event = cg.symbols.CGEventCreateKeyboardEvent(
        null,
        keycode[name],
        down,
      );
      if (event && opts.repeat)
        cg.symbols.CGEventSetIntegerValueField(
          event,
          kCGKeyboardEventAutorepeat,
          1n,
        );
      post(event);
    },
    move() {
      const event = cg.symbols.CGEventCreate(null); // at the cursor's current location
      if (event) cg.symbols.CGEventSetType(event, kCGEventMouseMoved);
      post(event);
    },
    wheel: () =>
      post(
        cg.symbols.CGEventCreateScrollWheelEvent(
          null,
          kCGScrollEventUnitLine,
          1,
          1,
        ),
      ),
    pump: () => void cg.symbols.CFRunLoopRunInMode(mode, 0.001, false),
    raw: { z: 0x06, delete: 0x75 },
  };
}

const input =
  process.platform === "win32"
    ? windowsInput()
    : process.platform === "darwin"
      ? macInput()
      : undefined;
if (!input) {
  console.error("hook-probe: Windows and macOS only (Linux has no hooks)");
  process.exit(2);
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

// Keyboard first, then mouse: the order the library must not care about. The keyboard handler disposes its own hook
// when it sees Alt go up, which is the disposal an app does (on Escape, say) and the one that must not crash.
let keys: ReturnType<typeof installKeyboardHook>;
let mouseHook: ReturnType<typeof installMouseHook>;
try {
  keys = installKeyboardHook((m) => {
    note(
      `key ${keyEventName[m.event]} ${m.code} raw=0x${m.raw.toString(16)} mods=${mods(m.modifiers)}`,
    );
    if (m.event === 1 && m.code === "AltLeft") keys.dispose();
    return false;
  });
  mouseHook = installMouseHook((m) => {
    if (m.event === MouseEvent.Move) moves++;
    note(
      `mouse ${mouseEventName[m.event]}${m.wheel ? ` wheel=${m.wheel}` : ""} mods=${mods(m.modifiers)}`,
    );
    return false;
  });
} catch (err) {
  console.log(
    `FAIL: install refused: ${err instanceof Error ? err.message : String(err)}`,
  );
  console.log(
    "(no grant yet: the system asked once; allow it and run the probe again)",
  );
  process.exit(1);
}
console.log("both hooks installed (keyboard, then mouse); pumping");

const pump = setInterval(() => input.pump(), 1);

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
const none = (lines: string[]) =>
  lines.length ? `expected nothing, got [${lines.join(" | ")}]` : undefined;
const z = input.raw.z.toString(16);
const del = input.raw.delete.toString(16);
const steps: Step[] = [
  { do: () => input.key("shift", true), expect: want("key Down ShiftLeft") },
  { do: () => input.move(), expect: want("mouse Move mods=shift") },
  { do: () => input.key("shift", false), expect: want("key Up ShiftLeft") },
  { do: () => input.move(), expect: want("mouse Move mods=-") },
  {
    do: () => input.key("control", true),
    expect: want("key Down ControlLeft"),
  },
  { do: () => input.wheel(), expect: want("mouse Wheel wheel=1 mods=ctrl") },
  // Z as a keyboard sends it; held, so the second down is a repeat.
  {
    do: () => input.key("z", true, { scan: true }),
    expect: want(`key Down KeyZ raw=0x${z} mods=ctrl`),
  },
  {
    do: () => input.key("z", true, { scan: true, repeat: true }),
    expect: want(`key Repeat KeyZ raw=0x${z} mods=ctrl`),
  },
  {
    do: () => input.key("z", false, { scan: true }),
    expect: want(`key Up KeyZ raw=0x${z} mods=ctrl`),
  },
  { do: () => input.key("control", false), expect: want("key Up Control") },
  // Delete by its bare platform code (on Windows no scan code: the library derives the extended one).
  {
    do: () => input.key("delete", true),
    expect: want(`key Down Delete raw=0x${del} mods=-`),
  },
  {
    do: () => input.key("delete", false),
    expect: want(`key Up Delete raw=0x${del} mods=-`),
  },
  // Delete as the keyboard sends it (on Windows scan E0 53).
  {
    do: () => input.key("delete", true, { scan: true }),
    expect: want("key Down Delete"),
  },
  {
    do: () => input.key("delete", false, { scan: true }),
    expect: want("key Up Delete"),
  },
  { do: () => input.key("alt", true), expect: want("key Down AltLeft") },
  { do: () => input.move(), expect: want("mouse Move mods=alt") },
  // Alt's up: the keyboard handler disposes its own hook from inside this call.
  { do: () => input.key("alt", false), expect: want("key Up AltLeft") },
  // The keyboard hook is gone; the mouse hook must still deliver.
  { do: () => input.key("z", true, { scan: true }), expect: none },
  { do: () => input.key("z", false, { scan: true }), expect: none },
  { do: () => input.move(), expect: want("mouse Move mods=-") },
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
    keys.dispose(); // already disposed by its handler; a second dispose is a no-op
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
        : "OK: modifiers on mouse messages, DOM codes, down/repeat/up, dispose from inside the handler, and the mouse hook outliving the keyboard hook",
    );
    process.exit(failures.length ? 1 : 0);
  },
  600 + steps.length * GAP + 500,
);
