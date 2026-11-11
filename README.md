# sweetview-webview-bun

[bun](https://bun.sh/) bindings for [webview](https://github.com/webview/webview/), a tiny
cross-platform library to make **web-based GUIs for desktop applications**.

![](banner.png)

Forked from [webview-bun](https://github.com/tr1ckydev/webview-bun), same API. The library this
package ships is built from [sweetview-webview](https://github.com/n0t-invented-here/sweetview-webview),
a fork of webview that adds:

- `webview_set_asset` (serve bytes at the webview's own origin) and `webview_set_background_color`,
  called over `bun:ffi` with the library path from `src/ffi.ts` (the `Webview` class does not wrap them).
- System-wide mouse and keyboard hooks with a permission model: [Input hooks](#input-hooks).

## Installation

<details>
  <summary>Click here for instructions on 🐧 Linux</summary>
  The compiled linux library in this package requires GTK 4 and WebkitGTK 6.

> To use a different version, see Development section below.

- Debian-based systems: `sudo apt install libgtk-4-1 libwebkitgtk-6.0-4`
- Arch-based systems: `sudo pacman -S gtk4 webkitgtk-6.0`
- Fedora-based systems: `sudo dnf install gtk4 webkitgtk6.0`

</details>

<details>
  <summary>Click here for instructions on 🪟 Windows</summary>
  The compiled windows library in this package does not bundle any webview version with itself but rather uses the system installed one.

> To bundle a specific version, see Development section below.

The <a href="https://developer.microsoft.com/en-us/microsoft-edge/webview2/">Microsoft Edge WebView2</a> runtime is required to be installed on the system for any version of Windows before Windows 11.
To manually update or install the latest version, follow the steps <a href="https://github.com/MicrosoftEdge/WebView2Feedback/issues/3371#issuecomment-1500917825">here</a>.

</details>

```bash
bun i @n1h/sweetview-webview-bun
```

## Example

```typescript
import { Webview } from "@n1h/sweetview-webview-bun";

const html = `
<html>
    <body>
        <h1>Hello from bun v${Bun.version} !</h1>
    </body>
</html>
`;

const webview = new Webview();

webview.setHTML(html);
webview.run();
```

For more examples, browse the `examples` folder of this repository.

## Input hooks

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

### Mouse hook

`installMouseHook(handler)` returns `{ dispose() }`. The handler gets a `MouseMessage`:

| Field       | Value                                                                                              |
| ----------- | -------------------------------------------------------------------------------------------------- |
| `event`     | `MouseEvent.Move`, `LeftDown`, `LeftUp`, `RightDown`, `RightUp`, `MiddleDown`, `MiddleUp`, `Wheel` |
| `x`, `y`    | Screen units, origin at the top-left of the primary display                                        |
| `wheel`     | Notches, positive away from the user; `0` unless the event is `Wheel`                              |
| `modifiers` | See [Modifiers](#modifiers)                                                                        |

Return `true` to swallow the event: no window gets it.

### Keyboard hook

`installKeyboardHook(handler)` returns `{ dispose() }`. The handler gets a `KeyMessage`:

| Field       | Value                                                                                                                                                                         |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `event`     | `KeyEvent.Down`, `Up`, `Repeat`                                                                                                                                               |
| `code`      | The DOM `KeyboardEvent.code` name of the physical key: `"KeyZ"`, `"Delete"`, `"ArrowLeft"`, `"ShiftLeft"`; `"Unidentified"` for a key without one. The same on every platform |
| `raw`       | The platform's own number: the virtual-key code on Windows, the virtual keycode on macOS                                                                                      |
| `modifiers` | See [Modifiers](#modifiers)                                                                                                                                                   |

Return `true` to swallow the key: no window gets it, not even the focused one.

### Modifiers

Every message carries `modifiers: { shift, ctrl, alt, meta }`, read for that event. Alt is Option and
Meta is Command on macOS; Meta is the Windows key on Windows. On a key message it is the state after
the event, so Shift's own `Down` has `shift: true`.

### Rules

- One of each hook per process. Install on the UI thread, before `run()`.
- Keep the handler quick: the system waits for it.
- Install or dispose the two in any order; each is independent of the other. A hook may dispose
  itself from inside its own handler.
- Windows: `WH_MOUSE_LL` and `WH_KEYBOARD_LL`. macOS: one `CGEventTap` shared by both. Linux: the
  install throws; there is no hook there.

### Permissions

On macOS both hooks need **Device Control and Data Access** (System Settings > Privacy & Security),
because their event tap filters events. Windows and Linux need nothing. The permission model tells
the app what is needed and whether it is granted, and leaves it to the app when, if ever, the user is
asked:

```typescript
import { Feature, Permission, permissions } from "@n1h/sweetview-webview-bun";

permissions.autoRequest = false; // never ask behind the app's back

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
permission (System Settings > Privacy & Security)`. `Permission.InputMonitoring` (the **Input
Monitoring** row) is modelled too; no feature here needs it.

A grant belongs to the app that asks: a `bun` script gets its terminal's, a compiled `.app` its own.
`examples/input-hooks.ts` shows all of this in a window.

## Single-file executable

You can compile a single self-sufficient executable file for your webview app.

For example, let's create a single executable for the above To-Do app. Clone this repository and run,

```bash
bun build --compile --minify --sourcemap ./examples/todoapp/app.ts --outfile todoapp
```

> [!TIP]
> By default, a terminal window will also open in the back when double-click opening the executable in Windows and macOS.
>
> #### 🪟 To hide it in Windows:
>
> Download and run [hidecmd.bat](https://github.com/tr1ckydev/webview-bun/blob/main/scripts/hidecmd.bat) from this repository, provide the exe path when prompted.
>
> #### 🍎 To hide it in macOS:
>
> Add the extension `.app` in the end of the above bun build command.

### Cross-platform compilation

Bun now supports cross-compilation of single executable binaries. To cross compile your webview app for a different platform run,

```bash
bun build --compile --target=bun-windows-x64 --minify --sourcemap ./examples/todoapp/app.ts --outfile todoapp
```

See [full list](https://github.com/oven-sh/bun/blob/main/docs/bundler/executables.md#supported-targets) of supported targets.

### Bun.serve with webview

If you run a web server it will block the main thread, but using workers you can run the webview window on another thread. Clone this repository then,

```bash
cd examples/webserver/
bun build --compile --minify --sourcemap ./index.ts ./worker.ts --outfile webserver
```

### Extras

🪟 On windows, to add an icon to your exe file, checkout [rcedit](https://github.com/electron/rcedit).

🍎 On macOS, to codesign your executable checkout the [bun docs](https://bun.sh/docs/bundler/executables#code-signing-on-macos).

## Documentation

Refer to the comments in the source code for full documentation.

## Development

Please use `bun pretty` to automatically format all files.

### Building the shipped library

`just build` ([just](https://github.com/casey/just), pwsh) fetches the `webview/` submodule if it is empty, builds the library for this OS and copies it to `build/` (`libwebview.dll`, `libwebview.dylib`, or `libwebview-<arch>.so`), where `src/ffi.ts` imports it from and the npm package ships it. On Windows it enters the Visual Studio dev shell from pwsh and runs CMake with ninja itself, no `cmd` or `.bat`; elsewhere it runs `bun scripts/build.ts`. Commit the result in `build/` so the published package carries it. `just pack` shows what `npm publish` would upload; `just publish` publishes.

### Prerequisites

#### 🪟 On **Windows,** you need C++ Build Tools:

- Go to https://visualstudio.microsoft.com/downloads.
- Scroll down > _All Downloads_ > _Tools for Visual Studio_.
- Download _Build Tools for Visual Studio 2022_ and run.
- Select _Desktop development with C++_ and install.

#### 🐧 On linux, you need following deps:

- Debian-based: `sudo apt install libgtk-4-dev libwebkitgtk-6.0-dev cmake ninja-build clang`
- Fedora-based: `sudo dnf install gtk4-devel webkitgtk6.0-devel cmake ninja-build clang`
- Arch-based: `sudo pacman -S cmake ninja clang`

#### 🍎 On macOS, you need following deps:

```bash
brew install cmake ninja clang
```

### Building

- Clone the repository along with the [webview](https://github.com/webview/webview) submodule.

  ```bash
  git clone --recurse-submodules --branch sweetview https://github.com/n0t-invented-here/sweetview-webview-bun
  cd sweetview-webview-bun
  ```

- Build the library for your platform.

  > Under the hood, it invokes webview's own cmake build system to compile the shared library file.

  ```bash
  bun run build
  ```

- (Optional) Clear build cache and rebuild the library.

  ```bash
  bun clean
  bun run build
  ```

The compiled library file can be found inside the `build` folder.

#### Building for arm64 from x86_64

To create an arm64 shared library from a x86_64 host, checkout [setupARM64.sh](https://github.com/tr1ckydev/webview-bun/blob/main/setupARM64.sh). DO NOT execute the file (the .sh extension has been kept for syntax highlighting), rather read the comments and copy and paste the commands line by line.

### Customization

- 🐧 For linux, if you want to use a different WebkitGTK version, change the cmake `WEBVIEW_WEBKITGTK_API` option in _build.ts_ to one of the [available values](https://github.com/webview/webview?tab=readme-ov-file#linux-specific-options). Be sure to first install the corresponding version libraries.
- 🪟 For windows, if you want to bundle a specific webview version instead of using the system installed one, set the cmake `WEBVIEW_MSWEBVIEW2_VERSION` option to one of the [NuGet version strings](https://www.nuget.org/packages/Microsoft.Web.WebView2/#versions-body-tab).

Check out the [webview build docs](https://github.com/webview/webview?tab=readme-ov-file#customization) for more options.

### Running

> [!TIP]
> To use your own webview library, set the `WEBVIEW_PATH` environment variable with the path to your webview shared library file.

Run the following example to see it in action.

```bash
bun run examples/basic.ts
```

For more examples, browse the `examples` folder of this repository.

### Testing the input hooks

| Command                                        | What it checks                                                                  |
| ---------------------------------------------- | ------------------------------------------------------------------------------- |
| `bun scripts/hook-probe.ts`                    | Both hooks against the shipped library, with synthesised input (Windows, macOS) |
| `bun scripts/permission-probe.ts <app> before` | With the app's grant wiped: every refusal, and the one dialog                   |
| `bun scripts/permission-probe.ts <app> after`  | With it allowed: every success, no dialog                                       |
| `bun scripts/example-app.ts input-hooks`       | The example window, as an app                                                   |

`<app>` is `mouse-hook`, `keyboard-hook` or `input-monitoring`: one test app per grant, because
macOS grants belong to the app that asks and each app should ask for one row only. The
`input-monitoring` app asks for Input Monitoring alone, and the hooks must still refuse after it is
granted.

On macOS the probe and the example run as apps too, all under `dist/`, ad-hoc signed. The first run
of any of them asks; allow it in the dialog and run again. A rebuild (sources newer than the bundle,
or `--rebuild`) changes the signature, and it asks again. On Windows and Linux the permission tests
have one phase, not-applicable, and run as plain executables.

## Credits

This repository is a port of [webview_deno](https://github.com/webview/webview_deno) with various changes to work with the bun runtime.

## License

This repository uses MIT license. See [LICENSE](https://github.com/tr1ckydev/webview-bun/blob/main/LICENSE) for full license text.
