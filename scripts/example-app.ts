// Runs an example as an app of its own on macOS, so that the grant it asks for lands on the example
// and not on the terminal (grants belong to the app that asks; see scripts/test-app.ts):
//
//   bun scripts/example-app.ts input-hooks        # dist/sweetview-input-hooks-example.app
//
// The first run asks for the permission the example needs; allow it in the dialog, close the
// window, and run again. On Windows and Linux the example runs as a plain executable from dist/.

import { existsSync } from "node:fs";
import { join } from "node:path";
import { buildTestApp, root, runTestApp } from "./test-app";

const args = process.argv.slice(2);
const example = args.find((a) => !a.startsWith("--"));
if (!example || !existsSync(join(root, "examples", `${example}.ts`))) {
  console.error(
    "usage: bun scripts/example-app.ts <name of a file in examples/, without .ts> [--rebuild]",
  );
  process.exit(2);
}
const app = await buildTestApp(
  `${example}-example`,
  `examples/${example}.ts`,
  args.includes("--rebuild"),
);
console.log(`running ${app.app}; close its window to end`);
await runTestApp(app, []);
console.log("exited");
