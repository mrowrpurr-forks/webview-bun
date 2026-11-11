// The permission model behind the input hooks (webview_feature_permissions, webview_permission_status,
// webview_permission_request, webview_permission_set_auto_request): which system permission a feature needs on this
// platform, whether the process holds it, how to ask the user for it, and whether a failing install asks by itself.
//
//   import { Feature, Permission, permissions } from "@n1h/sweetview-webview-bun";
//
//   permissions.needed(Feature.KeyboardHook)        // [] on Windows and Linux; [Permission.DeviceControl] on macOS
//   permissions.status(Permission.DeviceControl)    // "granted" | "missing" | "not-applicable"
//   permissions.request(Permission.DeviceControl)   // shows the system's dialog when missing; same answers
//   permissions.autoRequest = false                 // a failing install no longer asks the system by itself
//   permissions.ready(Feature.MouseHook)            // true when every permission the feature needs is granted
//
// Nothing here installs a hook or shows anything unless `request` is called (or `autoRequest` is left on and an
// install fails). Windows and Linux have no such permissions: `needed` is empty and `status` is "not-applicable".

import { FFIType, dlopen } from "bun:ffi";
import { libraryPath } from "./ffi";

// Bound on first use, so a shipped library without these functions still loads for everything else.
let lib: ReturnType<typeof open> | undefined;
function open() {
  return dlopen(libraryPath, {
    webview_feature_permissions: { args: [FFIType.i32], returns: FFIType.u32 },
    webview_permission_status: { args: [FFIType.u32], returns: FFIType.i32 },
    webview_permission_request: { args: [FFIType.u32], returns: FFIType.i32 },
    webview_permission_set_auto_request: {
      args: [FFIType.i32],
      returns: FFIType.i32,
    },
  });
}

/** A system permission a feature may need; the library's webview_permission_t bits. */
export const enum Permission {
  /**
   * macOS: "Device Control and Data Access" in System Settings > Privacy & Security, which lets a process filter and
   * post input events. What both hooks need there. Windows and Linux have no such permission.
   */
  DeviceControl = 1 << 0,
  /**
   * macOS: "Input Monitoring", which lets a process watch input events without filtering them. No feature of this
   * package needs it; it is here so an app can ask about it the same way.
   */
  InputMonitoring = 1 << 1,
}

/** A feature that may need a permission; the library's webview_feature_t. */
export const enum Feature {
  /** `installMouseHook`. */
  MouseHook = 0,
  /** `installKeyboardHook`. */
  KeyboardHook = 1,
}

/** Whether the process holds a permission: granted, missing (the user can grant it), or nothing of the kind here. */
export type PermissionStatus = "granted" | "missing" | "not-applicable";

const WEBVIEW_ERROR_OK = 0;
const WEBVIEW_ERROR_MISSING_DEPENDENCY = -5;
const WEBVIEW_ERROR_UNSPECIFIED = -1;

function statusFrom(code: number): PermissionStatus {
  if (code === WEBVIEW_ERROR_OK) return "granted";
  if (code === WEBVIEW_ERROR_MISSING_DEPENDENCY) return "missing";
  if (code === WEBVIEW_ERROR_UNSPECIFIED) return "not-applicable";
  throw new Error(`webview permission call failed: error ${code}`);
}

const all: Permission[] = [
  Permission.DeviceControl,
  Permission.InputMonitoring,
];
let autoRequest = true;

export const permissions = {
  /** The permissions a feature needs on this platform; empty when it needs none. */
  needed(feature: Feature): Permission[] {
    const bits = (lib ??= open()).symbols.webview_feature_permissions(feature);
    return all.filter((p) => (bits & p) !== 0);
  },

  /** Whether the process holds a permission right now. Shows nothing. */
  status(permission: Permission): PermissionStatus {
    return statusFrom(
      (lib ??= open()).symbols.webview_permission_status(permission),
    );
  },

  /**
   * Asks the system for a permission: on macOS it adds the app to the row in System Settings > Privacy & Security and
   * shows its dialog each time this is called while the permission is missing. The user grants it there; the next
   * install after that succeeds.
   */
  request(permission: Permission): PermissionStatus {
    return statusFrom(
      (lib ??= open()).symbols.webview_permission_request(permission),
    );
  },

  /** True when every permission the feature needs is granted (so, always, where it needs none). */
  ready(feature: Feature): boolean {
    return this.needed(feature).every((p) => this.status(p) === "granted");
  },

  /**
   * Whether an install that fails for a missing permission asks the system for it by itself, once per process. On by
   * default, so an app that never looks at permissions still gets the system's dialog the first time it installs a
   * hook. Turn it off to ask in your own time with `request`, for example after explaining why, or once per user
   * rather than per launch.
   */
  get autoRequest(): boolean {
    return autoRequest;
  },
  set autoRequest(on: boolean) {
    autoRequest = on;
    (lib ??= open()).symbols.webview_permission_set_auto_request(on ? 1 : 0);
  },
};
