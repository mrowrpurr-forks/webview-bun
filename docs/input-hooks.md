# Input hooks

System-wide mouse and keyboard hooks: the app sees every mouse and key event on the system, not only
those aimed at its own window, and can swallow any of them. Windows and macOS.

```typescript
import {
  installKeyboardHook,
  installMouseHook,
  KeyEvent,
  MouseEvent,
} from "@n1h/sweetview-webview-bun";

const keys = installKeyboardHook((key) => {
  if (key.event === KeyEvent.Down) console.log(key.code, key.modifiers);
  return key.code === "KeyK" && key.modifiers.ctrl && key.modifiers.shift; // true swallows it
});

const mouse = installMouseHook((m) => {
  if (m.event === MouseEvent.Wheel) console.log(m.wheel, m.x, m.y);
  return false;
});

// ... later
keys.dispose();
mouse.dispose();
```

## Mouse hook

`installMouseHook(handler)` returns `{ dispose() }`. The handler gets a `MouseMessage`:

| Field       | Value                                                                                              |
| ----------- | -------------------------------------------------------------------------------------------------- |
| `event`     | `MouseEvent.Move`, `LeftDown`, `LeftUp`, `RightDown`, `RightUp`, `MiddleDown`, `MiddleUp`, `Wheel` |
| `x`, `y`    | Screen units, origin at the top-left of the primary display                                        |
| `wheel`     | Notches, positive away from the user; `0` unless the event is `Wheel`                              |
| `modifiers` | See [Modifiers](#modifiers)                                                                        |

Return `true` to swallow the event: no window gets it.

## Keyboard hook

`installKeyboardHook(handler)` returns `{ dispose() }`. The handler gets a `KeyMessage`:

| Field       | Value                                                                                                                                                                         |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `event`     | `KeyEvent.Down`, `Up`, `Repeat`                                                                                                                                               |
| `code`      | The DOM `KeyboardEvent.code` name of the physical key: `"KeyZ"`, `"Delete"`, `"ArrowLeft"`, `"ShiftLeft"`; `"Unidentified"` for a key without one. The same on every platform |
| `raw`       | The platform's own number: the virtual-key code on Windows, the virtual keycode on macOS                                                                                      |
| `modifiers` | See [Modifiers](#modifiers)                                                                                                                                                   |

Return `true` to swallow the key: no window gets it, not even the focused one.

## Modifiers

Every message carries `modifiers: { shift, ctrl, alt, meta }`, read for that event.

- Alt is Option and Meta is Command on macOS; Meta is the Windows key on Windows.
- On a key message it is the state after the event, so Shift's own `Down` has `shift: true`.

## Rules

- One of each hook per process. Install on the UI thread, before `run()`.
- Keep the handler quick: the system waits for it.
- Install or dispose the two in any order; each is independent of the other. A hook may dispose
  itself from inside its own handler.
- Windows: `WH_MOUSE_LL` and `WH_KEYBOARD_LL`. macOS: one `CGEventTap` shared by both. Linux: the
  install throws; there is no hook there.

## Permissions

On macOS both hooks need **Device Control and Data Access** (System Settings > Privacy & Security),
because their event tap filters events. Windows and Linux need nothing.

The permission model tells the app what is needed and whether it is granted, and lets the app decide
when, if ever, the user is asked:

```typescript
import { Feature, Permission, permissions } from "@n1h/sweetview-webview-bun";

permissions.autoRequest = false; // no system dialog from a failed install

if (!permissions.ready(Feature.KeyboardHook)) {
  explainWhyTheAppNeedsIt();
  permissions.request(Permission.DeviceControl); // the system's dialog
}
```

| Call                              | Answer                                                                                                                                                                           |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `permissions.needed(feature)`     | The `Permission`s a feature needs here: `[Permission.DeviceControl]` on macOS, `[]` on Windows and Linux                                                                         |
| `permissions.status(permission)`  | `"granted"`, `"missing"`, or `"not-applicable"` (no such permission on this platform). Shows nothing                                                                             |
| `permissions.request(permission)` | Asks the system: on macOS the dialog, each time while missing. Same answers as `status`                                                                                          |
| `permissions.ready(feature)`      | `true` when every permission the feature needs is granted                                                                                                                        |
| `permissions.autoRequest`         | Default `true`: an install that fails for a missing permission asks the system by itself, once per process. `false`: the install only throws, and the app asks through `request` |

Without the permission, an install throws: `the process needs the Device Control and Data Access
permission (System Settings > Privacy & Security)`.

`Permission.InputMonitoring` (the **Input Monitoring** row) is modeled too; no feature here needs it.

A grant belongs to the app that asks: a `bun` script gets its terminal's, a compiled `.app` its own.
[`examples/input-hooks.ts`](../examples/input-hooks.ts) shows all of this in a window.
