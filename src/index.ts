export { unload } from "./ffi";
export * from "./webview";
export {
  installMouseHook,
  MouseEvent,
  type MouseHandler,
  type MouseHook,
  type MouseMessage,
} from "./mouse-hook";
export const WEBVIEW_VERSION = "0.12.0";
