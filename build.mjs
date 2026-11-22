import { build } from "esbuild";
import { cp, mkdir, readFile, rm } from "node:fs/promises";

const root = new URL("./", import.meta.url);
const dist = new URL("dist/", root);
const webFiles = {
    "/": ["index.html", "text/html"],
    "/assets/app.js": ["app.js", "text/javascript"],
    "/assets/browser-wallet.mjs": ["browser-wallet.mjs", "text/javascript"],
    "/assets/hosted-scan.mjs": ["hosted-scan.mjs", "text/javascript"],
    "/assets/python-worker.js": ["python-worker.js", "text/javascript"],
    "/assets/ranking.py": ["ranking.py", "text/plain"],
    "/assets/styles.css": ["styles.css", "text/css"],
    "/assets/brand-mark.svg": ["brand-mark.svg", "image/svg+xml"],
    "/assets/apple-touch-icon.png": ["apple-touch-icon.png", "image/png"],
};

const assets = Object.fromEntries(await Promise.all(Object.entries(webFiles).map(async ([path, [name, type]]) => {
    const source = new URL(`frontend/${name}`, root);
    // Keep PNGs binary; encoding as UTF-8 would corrupt the Home Screen icon.
    return [path, type === "image/png"
        ? { type, base64: await readFile(source, "base64") }
        : { type: `${type}; charset=utf-8`, contents: await readFile(source, "utf8") }];
})));

await rm(dist, { recursive: true, force: true });
await mkdir(new URL(".openai/", dist), { recursive: true });
await cp(new URL(".openai/hosting.json", root), new URL(".openai/hosting.json", dist));
await cp(new URL("drizzle/", root), new URL(".openai/drizzle/", dist), { recursive: true });

await build({
    entryPoints: ["worker/index.mjs"],
    outfile: "dist/server/index.js",
    bundle: true,
    format: "esm",
    target: "es2022",
    plugins: [{
        name: "underfive-assets",
        setup(plugin) {
            plugin.onResolve({ filter: /^underfive:assets$/ }, spec => ({ path: spec.path, namespace: "site-assets" }));
            plugin.onLoad({ filter: /.*/, namespace: "site-assets" }, () => ({
                contents: `export default ${JSON.stringify(assets)};`,
                loader: "js",
            }));
        },
    }],
});
