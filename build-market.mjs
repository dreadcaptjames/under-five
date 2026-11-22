import { build } from "esbuild";

await build({
    entryPoints: ["worker/public-market.mjs"],
    outfile: process.argv[2] ?? "dist/market/server/index.js",
    bundle: true,
    format: "esm",
    target: "es2022",
});
