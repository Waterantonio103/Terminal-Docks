import { copyFile, mkdir, readdir, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = dirname(fileURLToPath(new URL('../package.json', import.meta.url)));
const sourceDir = join(repoRoot, 'node_modules', 'material-icon-theme', 'icons');
const targetDir = join(repoRoot, 'public', 'vendor', 'material-icon-theme', 'icons');

const entries = await readdir(sourceDir, { withFileTypes: true });
const svgFiles = entries.filter(entry => entry.isFile() && entry.name.endsWith('.svg'));

await rm(targetDir, { recursive: true, force: true });
await mkdir(targetDir, { recursive: true });

await Promise.all(
  svgFiles.map(entry => copyFile(join(sourceDir, entry.name), join(targetDir, entry.name))),
);

console.log(`Copied ${svgFiles.length} Material Icon Theme SVGs to public/vendor/material-icon-theme/icons`);
