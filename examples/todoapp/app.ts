import { SizeHint, Webview } from "../../src";
// Bun's types call every .html import an HTMLBundle; with { type: "text" } it is the file's text.
import html from "./ui.html" with { type: "text" };

const webview = new Webview(false, {
  height: 500,
  width: 800,
  hint: SizeHint.NONE,
});
webview.title = "Bun App";
webview.setHTML(html as unknown as string);
webview.run();
