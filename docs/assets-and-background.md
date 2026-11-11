# Assets and background

Two additions of the sweetview fork of the library, as methods on [`Webview`](webview.md).

## `setAsset(path, mime, data)`

Serves bytes at a path of the webview's own origin. Nothing reaches the network.

The page is then loaded with `navigate` instead of `setHTML` (which Windows caps at 2 MB), and fetches
scripts, styles, images and models by relative URL.

```typescript
import { Webview } from "@n1h/sweetview-webview-bun";

const webview = new Webview();
webview.setAsset(
  "index.html",
  "text/html; charset=utf-8",
  `<script type="module" src="main.js"></script>`,
);
webview.setAsset(
  "main.js",
  "text/javascript",
  await Bun.file("dist/main.js").bytes(),
);
webview.setAsset(
  "model.glb",
  "model/gltf-binary",
  await Bun.file("assets/model.glb").bytes(),
);
webview.navigate(`${webview.assetOrigin}/index.html`);
webview.run();
```

| Argument | Meaning                                                                                                                                                         |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `path`   | URL path without the leading slash: `index.html`, `js/main.js`. Must not need percent-encoding. A request's query string and fragment are ignored when matching |
| `mime`   | The `Content-Type` header: `text/html; charset=utf-8`, `text/javascript`, `image/png`...                                                                        |
| `data`   | `Uint8Array`, or a string (encoded as UTF-8)                                                                                                                    |

- The bytes are copied; calling again with the same path replaces them.
- Call it before `run()`, or from a binding while running; either way before the page requests the path.

### The origin

`webview.assetOrigin` is the origin for this platform, so `navigate(`${webview.assetOrigin}/index.html`)`
is the same line everywhere.

| Platform | Origin                     | How                                                                                      |
| -------- | -------------------------- | ---------------------------------------------------------------------------------------- |
| Windows  | `http://webview.localhost` | WebView2's `WebResourceRequested` event; requests to any other origin are untouched      |
| macOS    | `webview://localhost`      | A `WKURLSchemeHandler` for the scheme `webview`, registered when the web view is created |
| Linux    | `webview://localhost`      | Accepted and stored; not served. Use `setHTML` or a `Bun.serve` on Linux                 |

## `setBackgroundColor(r, g, b, a)`

The color the browser paints behind the page, each channel 0 to 255. With `a` of 0 and a page whose
own background is transparent, the native window shows through.

```typescript
webview.setBackgroundColor(0, 0, 0, 0); // transparent
```

| Platform | Behavior                                                                                                                                    |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Windows  | Sets `ICoreWebView2Controller2::DefaultBackgroundColor`. For true transparency the host window also needs DWM composition that honors alpha |
| macOS    | Turns `drawsBackground` off on the `WKWebView` and makes the window non-opaque with this color as its background                            |
| Linux    | Accepted; does nothing                                                                                                                      |

The C side of both is documented in the library fork:

- [assets](https://github.com/n0t-invented-here/sweetview-webview/blob/sweetview/sweetview/assets.md)
- [background color](https://github.com/n0t-invented-here/sweetview-webview/blob/sweetview/sweetview/background-color.md)
