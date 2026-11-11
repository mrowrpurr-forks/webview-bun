# The `Webview` class

One instance is one native window with a web view in it.

```typescript
import { Webview, SizeHint } from "@n1h/sweetview-webview-bun";

const webview = new Webview();
webview.title = "Hello";
webview.size = { width: 800, height: 600, hint: SizeHint.NONE };
webview.setHTML(`<h1>Hello from bun v${Bun.version}</h1>`);
webview.run(); // blocks until the window closes, then destroys the instance
```

Declared in [`src/webview.ts`](../src/webview.ts); every member has its documentation there too.

## Creating

```typescript
new Webview(debug?: boolean, size?: Size, window?: Pointer | null)
```

| Argument | Default                                             | Meaning                                                                                                                       |
| -------- | --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `debug`  | `false`                                             | `true` enables the developer tools where the platform has them                                                                |
| `size`   | `{ width: 1024, height: 768, hint: SizeHint.NONE }` | The window size. Pass `undefined` to leave the window as the platform makes it (on macOS it can stay invisible until resized) |
| `window` | `null`                                              | Unsafe. A native window handle (`GtkWindow`, `NSWindow` or `HWND` pointer) to embed the web view in; `null` creates a window  |

`new Webview(handle)` with a `Pointer` wraps an existing native webview handle. Unsafe.

## Window

| Member                           | Meaning                                                                                                                               |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `title = string`                 | Sets the window title                                                                                                                 |
| `size = { width, height, hint }` | Sets the window size. `hint` is a `SizeHint`: `NONE` (a size), `MIN` (a minimum), `MAX` (a maximum), `FIXED` (the user cannot resize) |
| `setBackgroundColor(r, g, b, a)` | The color behind the page, or transparency; see [Assets and background](assets-and-background.md)                                     |
| `unsafeHandle`                   | Unsafe. The native webview handle                                                                                                     |
| `unsafeWindowHandle`             | Unsafe. The native window handle: `GtkWindow`, `NSWindow` or `HWND` by platform                                                       |

## Content

| Member                       | Meaning                                                                                                                        |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `navigate(url)`              | Loads a URL. A `data:` URI works; it is re-encoded if needed                                                                   |
| `setHTML(html)`              | Loads the string as the page. Windows caps it at 2 MB; for anything bigger, or a page with its own files, use `setAsset`       |
| `setAsset(path, mime, data)` | Serves bytes at the webview's own origin, then `navigate` to them; see [Assets and background](assets-and-background.md)       |
| `assetOrigin`                | The origin `setAsset` serves at on this platform                                                                               |
| `init(source)`               | JavaScript run at the start of every page the webview opens, before `window.onload`                                            |
| `eval(source)`               | Runs JavaScript in the current page. Asynchronous; the result is discarded. Run it after the page has loaded, or it is dropped |

## Calling bun from the page

```typescript
webview.bind("press", (label: string, n: number) => {
  console.log(label, n);
  return { ok: true }; // sent back to the page
});
webview.setHTML(
  `<button onclick="press('hi', 1).then(console.log)">Press</button>`,
);
```

| Member                          | Meaning                                                                                                                                                                                            |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bind(name, callback)`          | Makes `window[name]` in the page an async function that calls `callback` in bun. Arguments arrive as JSON-converted values; the return value (or a thrown error) goes back as the promise's result |
| `unbind(name)`                  | Removes the binding and frees its callback                                                                                                                                                         |
| `bindRaw(name, callback, arg?)` | The low-level form: `callback(seq, req, arg)` gets the request id and the raw JSON array of arguments, and answers with `return`                                                                   |
| `return(seq, status, result)`   | Answers a `bindRaw` request: `status` 0 with a JSON `result` resolves the page's promise; any other status rejects it with `result` as the error                                                   |

## Running and ending

| Member      | Meaning                                                                                                     |
| ----------- | ----------------------------------------------------------------------------------------------------------- |
| `run()`     | Runs the window's event loop on this thread until the window closes, then calls `destroy()`                 |
| `destroy()` | Closes the window, unbinds everything, frees the instance. After `run()` returns it has already happened    |
| `unload()`  | A function, not a method: destroys every instance and unloads the library. For after all windows are closed |

`run()` blocks the thread, so a bun server or other work runs on a worker;
[`examples/webserver/`](../examples/webserver) shows that.
