# sweetview-webview-bun

[bun](https://bun.sh/) bindings for [sweetview-webview](https://github.com/n0t-invented-here/sweetview-webview),
a fork of [webview](https://github.com/webview/webview) (web-based desktop GUIs on the OS's own web engine)
that adds `webview_set_asset`, `webview_set_background_color` and system-wide mouse and keyboard hooks to
the C API. The package ships the library built from that fork for Windows, macOS (universal) and Linux
(x64, arm64), and wraps it in TypeScript.

```bash
bun i @n1h/sweetview-webview-bun
```

What the OS needs:

- 🐧 Linux: GTK 4 and WebKitGTK 6. Debian: `sudo apt install libgtk-4-1 libwebkitgtk-6.0-4`; Arch:
  `sudo pacman -S gtk4 webkitgtk-6.0`; Fedora: `sudo dnf install gtk4 webkitgtk6.0`.
- 🪟 Windows: the [WebView2](https://developer.microsoft.com/en-us/microsoft-edge/webview2/) runtime,
  which Windows 11 has; the library uses the installed one.
- 🍎 macOS: nothing. The input hooks need a permission; see [Input hooks](#input-hooks).

## Usage

```typescript
import { Webview } from "@n1h/sweetview-webview-bun";

const webview = new Webview();
webview.setHTML(`<h1>Hello from bun v${Bun.version}</h1>`);
webview.run();
```

`examples/` has more: `basic.ts`, `bind.ts` (calling into bun from the page), `multiple.ts`,
`input-hooks.ts`, a `todoapp/` and a `webserver/` (a web server on the main thread with the window on a
worker). The `Webview` class is documented in `src/webview.ts`.

`webview_set_asset` (serve bytes at the webview's own origin) and `webview_set_background_color` are not
wrapped by the class; call them over `bun:ffi` against the library at `libraryPath` from `src/ffi.ts`
(or your own, through `WEBVIEW_PATH`).

## Input hooks

Two system-wide hooks, from `webview_mouse_hook_install` / `webview_mouse_hook_remove` and
`webview_keyboard_hook_install` / `webview_keyboard_hook_remove`:

- `installMouseHook(handler)` returns `{ dispose() }`. The handler gets `{ event, x, y, wheel, modifiers }`
  (`MouseEvent.Move`, `LeftDown`, `LeftUp`, `RightDown`, `RightUp`, `MiddleDown`, `MiddleUp`, `Wheel`;
  screen units, origin at the top-left of the primary display; wheel in notches, positive away from the
  user) and returns true to swallow the event so no window gets it. Windows: `WH_MOUSE_LL`.
- `installKeyboardHook(handler)` returns `{ dispose() }`. The handler gets `{ event, code, raw, modifiers }`
  (`KeyEvent.Down`, `Up`, `Repeat`; `code` is the DOM `KeyboardEvent.code` name of the physical key,
  `"KeyZ"`, `"Delete"`, `"ArrowLeft"`..., so nothing switches on platform key numbers; `raw` is that number,
  the virtual-key code on Windows and the virtual keycode on macOS) and returns true to swallow the key so
  no window gets it, not even the focused one. Windows: `WH_KEYBOARD_LL`.
- `modifiers` on every message is `{ shift, ctrl, alt, meta }` (Alt is Option and Meta is Command on macOS;
  Meta is the Windows key on Windows), read inside the hook for that event. On a key message it is the state
  after the event, so Shift's own `Down` has `shift: true`.

Both hooks: one of each per process, call on the UI thread before `run()`, keep the handler quick, and
install or dispose them in any order (each is independent of the other). A hook may dispose itself from
inside its own handler. Linux: the install throws (no hook on that platform).

The permission model says what the hooks need from the system and gives the app the switches:

- `permissions.needed(Feature.MouseHook)` / `permissions.needed(Feature.KeyboardHook)`: the `Permission`s a
  feature needs on this platform. Empty on Windows and Linux. On macOS both hooks need
  `Permission.DeviceControl`, the "Device Control and Data Access" row in System Settings > Privacy &
  Security, because their one shared `CGEventTap` filters events. `Permission.InputMonitoring` (the "Input
  Monitoring" row, watching without filtering) is modelled too, and no feature here needs it.
- `permissions.status(p)`: `"granted"`, `"missing"`, or `"not-applicable"` (this platform has no such
  permission). Shows nothing.
- `permissions.request(p)`: asks the system; on macOS the dialog appears each time while the permission is
  missing, the user grants it in System Settings, and the next install succeeds.
- `permissions.ready(feature)`: every needed permission is granted (always true where none is needed).
- `permissions.autoRequest` (default `true`): whether an install that fails for a missing permission asks
  the system by itself, once per process. Set it to `false` to ask only through `request`, in the app's own
  time.

`bun run examples/input-hooks.ts` shows the hooks behind that model.

## Single-file executables

```bash
bun build --compile --minify --sourcemap ./examples/todoapp/app.ts --outfile todoapp
```

The library is embedded, so the executable stands alone. Cross-compiling with `--target` (say
`bun-windows-x64`) works the same way; see bun's
[list of targets](https://github.com/oven-sh/bun/blob/main/docs/bundler/executables.md#supported-targets).

- 🪟 A console window opens behind a double-clicked executable; see
  [hidecmd.bat](https://github.com/tr1ckydev/webview-bun/blob/main/scripts/hidecmd.bat) to hide it, and
  [rcedit](https://github.com/electron/rcedit) for an icon.
- 🍎 Give the output file the `.app` extension to avoid the console; to sign it see the
  [bun docs](https://bun.sh/docs/bundler/executables#code-signing-on-macos). The input hooks' permission is
  granted to the app that asks, so a hooks app wants a bundle of its own with a stable identity.

## Development

`bun pretty` formats everything. `WEBVIEW_PATH` points the bindings at a library of your own.

### Building the shipped library

`just build` ([just](https://github.com/casey/just), pwsh) puts the `webview/` submodule at the commit
this branch records, builds the library for this OS and copies it to `build/` (`libwebview.dll`,
`libwebview.dylib`, or `libwebview-<arch>.so`), where `src/ffi.ts` imports it from and the npm package
ships it. Build on each OS itself and commit the file under `build/`. `just clean` removes the build
folder; `just pack` shows what `npm publish` would upload; `just publish` publishes.

Prerequisites: CMake and ninja everywhere; 🪟 Visual Studio 2022 Build Tools with the "Desktop
development with C++" workload (the recipe enters its dev shell from pwsh); 🐧 clang and the GTK 4 /
WebKitGTK 6 dev packages (`libgtk-4-dev libwebkitgtk-6.0-dev` on Debian, `gtk4-devel webkitgtk6.0-devel`
on Fedora); 🍎 the Xcode command line tools (`brew install cmake ninja`).

To build against another WebKitGTK API, change `WEBVIEW_WEBKITGTK_API` in `scripts/build.ts`; to bundle a
specific WebView2 instead of the installed one, set `WEBVIEW_MSWEBVIEW2_VERSION` to a
[NuGet version](https://www.nuget.org/packages/Microsoft.Web.WebView2/#versions-body-tab). More in the
[webview build docs](https://github.com/webview/webview?tab=readme-ov-file#customization).

### Testing the input hooks

`bun scripts/hook-probe.ts` (Windows and macOS) checks both hooks against the shipped library with
synthesised input.

The permission model and its toggles are tested as one app per grant, since macOS grants belong to
the app that asks and each app should ask for one row only:
`bun scripts/permission-probe.ts mouse-hook | keyboard-hook | input-monitoring before | after` builds
`dist/sweetview-<scenario>-test.app` (bundle id `dev.n1h.sweetview.<scenario>-test`), launches it, and
prints every answer against what that phase demands plus which row the run should have asked for.
`before` resets the app's grant and expects every refusal; allow the row in the dialog, and `after`
expects every success. The `input-monitoring` app asks for Input Monitoring only, and the hooks must
still refuse after it is granted, since they need Device Control and Data Access. On Windows and Linux
there is one phase, not-applicable, and the executable runs directly.

On macOS the probe and the examples run as apps of their own as well, so that the grant lands on them
and not on the terminal: the probe builds `dist/sweetview-hook-probe-test.app` by itself, and
`bun scripts/example-app.ts input-hooks` builds and runs `dist/sweetview-input-hooks-example.app`. The
first run of any of these apps asks; allow it and run again. Rebuilding an app (its sources newer than
the bundle, or `--rebuild`) changes its ad-hoc signature, so it asks again.

## Credits and license

Forked from [webview-bun](https://github.com/tr1ckydev/webview-bun) by tr1ckydev, itself a port of
[webview_deno](https://github.com/webview/webview_deno). MIT; see [LICENSE](LICENSE).
