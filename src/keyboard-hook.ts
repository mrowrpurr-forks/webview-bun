// webview_keyboard_hook_install / webview_keyboard_hook_remove: a system-wide
// keyboard hook that sees every key event before the focused window does and
// swallows the ones the handler says to. One per process. Windows: a
// WH_KEYBOARD_LL hook on the calling thread; macOS: key events on the same
// CGEventTap as the mouse hook, which needs a system permission
// (src/permissions.ts says which). Call on the UI thread before run().

import { CString, FFIType, JSCallback, dlopen, type Pointer } from "bun:ffi";
import { libraryPath } from "./ffi";
import {
  closeOrphans,
  HookCallback,
  hookInstallError,
  modifiersFrom,
  type Modifiers,
} from "./input-hooks";

// Bound on first use, separately from the mouse hook, so a library with one hook and not the other still serves the
// one it has.
let hookLib: ReturnType<typeof openHookLib> | undefined;
function openHookLib() {
  return dlopen(libraryPath, {
    webview_keyboard_hook_install: {
      args: [FFIType.function, FFIType.ptr],
      returns: FFIType.i32,
    },
    webview_keyboard_hook_remove: { args: [], returns: FFIType.i32 },
  });
}

/** What the hook saw; the values of the library's webview_key_event_t. */
export const enum KeyEvent {
  /** A key went down that was up. */
  Down = 0,
  /** A key went up. */
  Up = 1,
  /** A held key sent another down (the OS's auto-repeat). */
  Repeat = 2,
}

/**
 * One key event. `code` names the physical key as the DOM's `KeyboardEvent.code` does (`"KeyZ"`, `"Digit1"`, `"Enter"`,
 * `"Delete"`, `"ArrowLeft"`, `"ShiftLeft"`, `"Numpad7"`, `"F5"`...; `"Unidentified"` for a key the library has no name
 * for), so a handler never switches on a platform's key numbers; `raw` is that number anyway (the virtual-key code on
 * Windows, the virtual keycode on macOS). `modifiers` is the state after this event, so a modifier's own `Down` has its
 * flag set and its `Up` has it clear, as the DOM reports them.
 */
export type KeyMessage = {
  event: KeyEvent;
  code: string;
  raw: number;
  modifiers: Modifiers;
};

/**
 * Return true to swallow the event (no window gets it, not even the focused one), false to let it go on. Runs on the UI
 * thread inside the run loop; be quick, and take only the keys this process owns.
 */
export type KeyHandler = (m: KeyMessage) => boolean;

export type KeyboardHook = { dispose(): void };

/**
 * Installs the process's keyboard hook. Throws when one is already installed, when the platform has none (Linux), or on
 * macOS when the process lacks the permission `permissions.needed(Feature.KeyboardHook)` names (the system is asked for
 * it once unless `permissions.autoRequest` is off; the next launch after the user grants it succeeds). Independent of `installMouseHook`: install both in either order, dispose
 * either, and the other keeps delivering. The hook may be disposed from inside its own handler.
 */
export function installKeyboardHook(handler: KeyHandler): KeyboardHook {
  closeOrphans();
  const lib = (hookLib ??= openHookLib()); // throws when the library has no webview_keyboard_hook_install
  const cb: HookCallback = new HookCallback(
    new JSCallback(
      (
        event: number,
        code: Pointer,
        raw: number,
        modifiers: number,
        _arg: unknown,
      ) =>
        cb.guard(() =>
          handler({
            event,
            code: new CString(code).toString(),
            raw,
            modifiers: modifiersFrom(modifiers),
          }),
        ),
      {
        args: [FFIType.i32, FFIType.ptr, FFIType.u32, FFIType.u32, FFIType.ptr],
        returns: FFIType.i32,
      },
    ),
  );
  const code = lib.symbols.webview_keyboard_hook_install(cb.callback.ptr, null);
  if (code !== 0) {
    cb.release();
    throw hookInstallError("keyboard", code);
  }
  let disposed = false;
  return {
    dispose() {
      if (disposed) return;
      disposed = true;
      lib.symbols.webview_keyboard_hook_remove();
      cb.release();
    },
  };
}
