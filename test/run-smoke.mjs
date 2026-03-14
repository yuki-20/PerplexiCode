import { build } from 'esbuild';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const outDir = path.join(process.cwd(), 'out', 'smoke');
const outfile = path.join(outDir, 'smoke-bundle.mjs');

mkdirSync(outDir, { recursive: true });

await build({
  entryPoints: [path.join(process.cwd(), 'test', 'smoke.ts')],
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node24',
  outfile,
  sourcemap: false,
  minify: false,
});

await import(pathToFileURL(outfile).href);
