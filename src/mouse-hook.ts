// webview_mouse_hook_install / webview_mouse_hook_remove: a system-wide mouse
// hook that sees every mouse event before any window does and swallows the
// ones the handler says to. One per process. Windows: a WH_MOUSE_LL hook on
// the calling thread; macOS: a CGEventTap on the main run loop, which needs
// the Accessibility permission. Call on the UI thread before run().

import { FFIType, JSCallback, dlopen } from "bun:ffi";
import { libraryPath } from "./ffi";

// Bound on first use, not with the rest of the library: a shipped library built without the fork's
// functions (upstream's stock arm64 Linux build) must still load for everything else.
let hookLib: ReturnType<typeof openHookLib> | undefined;
function openHookLib() {
  return dlopen(libraryPath, {
    webview_mouse_hook_install: {
      args: [FFIType.function, FFIType.ptr],
      returns: FFIType.i32,
    },
    webview_mouse_hook_remove: { args: [], returns: FFIType.i32 },
  });
}

/** What the hook saw; the values of the library's webview_mouse_event_t. */
export const enum MouseEvent {
  /** The cursor moved, with or without a button held. */
  Move = 0,
  LeftDown = 1,
  LeftUp = 2,
  RightDown = 3,
  RightUp = 4,
  MiddleDown = 5,
  MiddleUp = 6,
  /** The vertical wheel turned; `wheel` is the amount. */
  Wheel = 7,
}

/**
 * One mouse event: the cursor in screen units (physical pixels on Windows, points on macOS, origin at the top-left of the
 * primary display) and, for `Wheel`, the notches turned, positive away from the user (a trackpad gives fractions).
 */
export type MouseMessage = {
  event: MouseEvent;
  x: number;
  y: number;
  wheel: number;
};

/** Return true to swallow the event (no window gets it), false to let it go on. Runs on the UI thread inside the run loop; be quick. */
export type MouseHandler = (m: MouseMessage) => boolean;

export type MouseHook = { dispose(): void };

/** The library's error codes that `installMouseHook` turns into errors; the message says which. */
const WEBVIEW_ERROR_MISSING_DEPENDENCY = -5;
const WEBVIEW_ERROR_DUPLICATE = 1;

/**
 * Installs the process's mouse hook. Throws when one is already installed, when the platform has none (Linux), or on
 * macOS when the process lacks the Accessibility permission (the system is asked to show its prompt once; the next
 * launch after the user grants it succeeds).
 */
export function installMouseHook(handler: MouseHandler): MouseHook {
  const lib = (hookLib ??= openHookLib()); // throws when the library has no webview_mouse_hook_install
  const callback = new JSCallback(
    (event: number, x: number, y: number, wheel: number, _arg: unknown) =>
      handler({ event, x, y, wheel }) ? 1 : 0,
    {
      args: [FFIType.i32, FFIType.f64, FFIType.f64, FFIType.f64, FFIType.ptr],
      returns: FFIType.i32,
    },
  );
  const code = lib.symbols.webview_mouse_hook_install(callback.ptr, null);
  if (code !== 0) {
    callback.close();
    const why =
      code === WEBVIEW_ERROR_DUPLICATE
        ? "a mouse hook is already installed"
        : code === WEBVIEW_ERROR_MISSING_DEPENDENCY
          ? "the process needs the Accessibility permission (System Settings > Privacy & Security > Accessibility)"
          : `error ${code}`;
    throw new Error(`webview_mouse_hook_install failed: ${why}`);
  }
  let disposed = false;
  return {
    dispose() {
      if (disposed) return;
      disposed = true;
      lib.symbols.webview_mouse_hook_remove();
      callback.close();
    },
  };
}
