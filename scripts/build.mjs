// Empacota cada ponto de entrada como script clássico (IIFE), como o Chrome espera
// para content scripts, e copia os arquivos estáticos para dist/.
import { build, context } from "esbuild";
import { cp, mkdir, rm } from "node:fs/promises";

const watch = process.argv.includes("--watch");
const outdir = "dist";

const options = {
  entryPoints: {
    background: "src/background/index.ts",
    content: "src/content/index.ts",
    "page-hook": "src/content/page-hook.ts",
    popup: "src/popup/index.ts",
  },
  outdir,
  bundle: true,
  format: "iife",
  target: "chrome111",
  minify: !watch,
  sourcemap: watch ? "inline" : false,
  logLevel: "info",
};

async function copyStatic() {
  await cp("public", outdir, { recursive: true });
  await cp("src/popup/popup.html", `${outdir}/popup.html`);
  await cp("src/popup/popup.css", `${outdir}/popup.css`);
}

await rm(outdir, { recursive: true, force: true });
await mkdir(outdir, { recursive: true });
await copyStatic();

if (watch) {
  const ctx = await context({
    ...options,
    plugins: [{ name: "static", setup: (b) => b.onEnd(() => copyStatic()) }],
  });
  await ctx.watch();
  console.log("Observando alterações…");
} else {
  await build(options);
}
