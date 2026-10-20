import { transformAsync } from "@babel/core";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const entries = (await fs.readdir(path.join(rootDir, "src", "v2"))).filter((name) =>
  name.endsWith(".tsx"),
);

for (const entry of entries) {
  const basename = entry.slice(0, -4);
  const sourcePath = path.join(rootDir, "src", "v2", entry);
  const distTsxPath = path.join(rootDir, "dist", "v2", `${basename}.tsx`);
  const distJsPath = path.join(rootDir, "dist", "v2", `${basename}.js`);
  const distJsxPath = path.join(rootDir, "dist", "v2", `${basename}.jsx`);
  const distJsxMapPath = path.join(rootDir, "dist", "v2", `${basename}.jsx.map`);

  const code = await fs.readFile(sourcePath, "utf8");

  const result = await transformAsync(code, {
    filename: sourcePath,
    configFile: false,
    babelrc: false,
    presets: [
      [
        "babel-preset-solid",
        {
          moduleName: "@opentui/solid",
          generate: "universal",
        },
      ],
      ["@babel/preset-typescript"],
    ],
  });

  if (!result?.code) {
    throw new Error(`Babel transform produced no output for ${entry}`);
  }

  await fs.writeFile(distJsPath, result.code, "utf8");

  // Clean up legacy files that are no longer needed
  await fs.rm(distTsxPath, { force: true });
  await fs.rm(distJsxPath, { force: true });
  await fs.rm(distJsxMapPath, { force: true });
}
