// webview_mouse_hook_install / webview_mouse_hook_remove: a system-wide mouse
// hook that sees every mouse event before any window does and swallows the
// ones the handler says to. One per process. Windows: a WH_MOUSE_LL hook on
// the calling thread; macOS: a CGEventTap on the main run loop, which needs
// the Accessibility permission. Call on the UI thread before run().

import { FFIType, JSCallback, dlopen } from "bun:ffi";
import { libraryPath } from "./ffi";
import { hookInstallError, modifiersFrom, type Modifiers } from "./input-hooks";

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
 * primary display), for `Wheel` the notches turned, positive away from the user (a trackpad gives fractions), and the
 * modifier keys held when the event was generated (read inside the hook: the asynchronous key state on Windows, the
 * event's own flags on macOS).
 */
export type MouseMessage = {
  event: MouseEvent;
  x: number;
  y: number;
  wheel: number;
  modifiers: Modifiers;
};

/** Return true to swallow the event (no window gets it), false to let it go on. Runs on the UI thread inside the run loop; be quick. */
export type MouseHandler = (m: MouseMessage) => boolean;

export type MouseHook = { dispose(): void };

/**
 * Installs the process's mouse hook. Throws when one is already installed, when the platform has none (Linux), or on
 * macOS when the process lacks the Accessibility permission (the system is asked to show its prompt once; the next
 * launch after the user grants it succeeds). Independent of `installKeyboardHook`: install both in either order, dispose
 * either, and the other keeps delivering.
 */
export function installMouseHook(handler: MouseHandler): MouseHook {
  const lib = (hookLib ??= openHookLib()); // throws when the library has no webview_mouse_hook_install
  const callback = new JSCallback(
    (
      event: number,
      x: number,
      y: number,
      wheel: number,
      modifiers: number,
      _arg: unknown,
    ) =>
      handler({ event, x, y, wheel, modifiers: modifiersFrom(modifiers) })
        ? 1
        : 0,
    {
      args: [
        FFIType.i32,
        FFIType.f64,
        FFIType.f64,
        FFIType.f64,
        FFIType.u32,
        FFIType.ptr,
      ],
      returns: FFIType.i32,
    },
  );
  const code = lib.symbols.webview_mouse_hook_install(callback.ptr, null);
  if (code !== 0) {
    callback.close();
    throw hookInstallError("mouse", code);
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
