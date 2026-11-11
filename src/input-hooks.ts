// What the mouse hook (src/mouse-hook.ts) and the keyboard hook (src/keyboard-hook.ts) share: the modifier keys every
// message carries, how a hook's install failure becomes an error, and the one rule about a hook's JSCallback (never
// close it while native code is inside it). Both hooks live in the fork's library (sweetview-webview:
// core/include/webview/detail/input_hooks.hh) and are system-wide, one of each per process; on macOS they listen on one
// CGEventTap, so the Accessibility permission is asked for once.

import type { JSCallback } from "bun:ffi";

/** The modifier keys held when a hook saw an event: the DOM's four (`shiftKey`, `ctrlKey`, `altKey`, `metaKey`). */
export type Modifiers = {
  shift: boolean;
  ctrl: boolean;
  /** Alt on Windows and Linux, Option on macOS. */
  alt: boolean;
  /** The Windows key on Windows, Command on macOS. */
  meta: boolean;
};

/** The library's webview_modifier_t bits, as they arrive in a hook's `modifiers` argument. */
export const enum Modifier {
  Shift = 1 << 0,
  Control = 1 << 1,
  Alt = 1 << 2,
  Meta = 1 << 3,
}

/** The `Modifiers` a hook's bits stand for. */
export function modifiersFrom(bits: number): Modifiers {
  return {
    shift: (bits & Modifier.Shift) !== 0,
    ctrl: (bits & Modifier.Control) !== 0,
    alt: (bits & Modifier.Alt) !== 0,
    meta: (bits & Modifier.Meta) !== 0,
  };
}

/** The library's error codes a hook install can return; the message says which. */
const WEBVIEW_ERROR_MISSING_DEPENDENCY = -5;
const WEBVIEW_ERROR_UNSPECIFIED = -1;
const WEBVIEW_ERROR_DUPLICATE = 1;

/** The error for a non-zero result of `webview_<kind>_hook_install`. */
export function hookInstallError(
  kind: "mouse" | "keyboard",
  code: number,
): Error {
  const why =
    code === WEBVIEW_ERROR_DUPLICATE
      ? `a ${kind} hook is already installed`
      : code === WEBVIEW_ERROR_MISSING_DEPENDENCY
        ? "the process needs the Accessibility permission (System Settings > Privacy & Security > Accessibility)"
        : code === WEBVIEW_ERROR_UNSPECIFIED
          ? "the hook could not be installed (on Linux there is none)"
          : `error ${code}`;
  return new Error(`webview_${kind}_hook_install failed: ${why}`);
}

/**
 * The JSCallback behind one installed hook. Closing a JSCallback frees the trampoline native code calls into, so it
 * must not happen while the hook is inside it, and a handler may well dispose its own hook (on Escape, say). `guard`
 * marks the call; `release` closes at once outside a call, and inside one leaves the callback to `closeOrphans`, which
 * the next install runs once native code has left it. A hook disposed from its handler and never followed by another
 * install keeps one small trampoline until the process ends.
 */
export class HookCallback {
  private inCall = false;
  constructor(readonly callback: JSCallback) {}

  guard(run: () => boolean): number {
    this.inCall = true;
    try {
      return run() ? 1 : 0;
    } finally {
      this.inCall = false;
    }
  }

  release(): void {
    if (this.inCall) orphans.push(this);
    else this.callback.close();
  }

  get isInCall(): boolean {
    return this.inCall;
  }
}

const orphans: HookCallback[] = [];

/** Closes the callbacks of hooks disposed from inside their own handlers, those native code has left. */
export function closeOrphans(): void {
  for (let i = orphans.length - 1; i >= 0; i--) {
    const orphan = orphans[i]!;
    if (!orphan.isInCall) {
      orphan.callback.close();
      orphans.splice(i, 1);
    }
  }
}
