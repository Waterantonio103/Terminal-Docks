import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';

const roots = [
  { label: 'frontend dist', dir: path.resolve('dist'), recursive: true, include: () => true },
  { label: 'release executable', dir: path.resolve('src-tauri', 'target', 'release'), recursive: false, include: name => /\.exe$/i.test(name) },
  { label: 'bundle artifacts', dir: path.resolve('src-tauri', 'target', 'release', 'bundle'), recursive: true, include: () => true },
];

function formatBytes(bytes) {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}

async function walk(dir, include, recursive, files = []) {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory() && recursive) {
      await walk(fullPath, include, recursive, files);
    } else if (include(entry.name, fullPath)) {
      const info = await stat(fullPath);
      files.push({ path: fullPath, bytes: info.size });
    }
  }
  return files;
}

let found = false;
for (const root of roots) {
  const files = await walk(root.dir, root.include, root.recursive);
  if (files.length === 0) continue;
  found = true;
  const total = files.reduce((sum, file) => sum + file.bytes, 0);
  console.log(`${root.label}: ${formatBytes(total)}`);
  for (const file of files.sort((a, b) => b.bytes - a.bytes).slice(0, 8)) {
    console.log(`  ${formatBytes(file.bytes).padStart(10)}  ${path.relative(process.cwd(), file.path)}`);
  }
}

if (!found) {
  throw new Error('No build artifacts found. Run npm run build or npm run tauri -- build first.');
}
