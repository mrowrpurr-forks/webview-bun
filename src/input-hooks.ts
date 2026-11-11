// What the mouse hook (src/mouse-hook.ts) and the keyboard hook (src/keyboard-hook.ts) share: the modifier keys every
// message carries, and how a hook's install failure becomes an error. Both hooks live in the fork's library
// (sweetview-webview: core/include/webview/detail/input_hooks.hh) and are system-wide, one of each per process; on macOS
// they listen on one CGEventTap, so the Accessibility permission is asked for once.

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
