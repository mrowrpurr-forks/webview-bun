export { unload } from "./ffi";
export * from "./webview";
export { Modifier, modifiersFrom, type Modifiers } from "./input-hooks";
export {
  Feature,
  Permission,
  permissions,
  type PermissionStatus,
} from "./permissions";
export {
  installMouseHook,
  MouseEvent,
  type MouseHandler,
  type MouseHook,
  type MouseMessage,
} from "./mouse-hook";
export {
  installKeyboardHook,
  KeyEvent,
  type KeyHandler,
  type KeyboardHook,
  type KeyMessage,
} from "./keyboard-hook";
export const WEBVIEW_VERSION = "0.12.0";
