import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const distAssetsDir = path.resolve('dist', 'assets');
const maxEntryBytes = Number(process.env.MAX_ENTRY_BUNDLE_BYTES ?? 350_000);

function formatKb(bytes) {
  return `${(bytes / 1024).toFixed(1)} KB`;
}

const entries = await readdir(distAssetsDir).catch(() => {
  throw new Error('dist/assets not found. Run npm run build before npm run check:bundle.');
});

const indexChunks = [];
for (const name of entries) {
  if (!/^index-[\w-]+\.js$/.test(name)) continue;
  const filePath = path.join(distAssetsDir, name);
  const info = await stat(filePath);
  indexChunks.push({ name, bytes: info.size });
}

if (indexChunks.length === 0) {
  throw new Error('No built index chunk found in dist/assets.');
}

indexChunks.sort((left, right) => right.bytes - left.bytes);
const entry = indexChunks[0];

if (entry.bytes > maxEntryBytes) {
  throw new Error(
    `Entry bundle ${entry.name} is ${formatKb(entry.bytes)}, above the ${formatKb(maxEntryBytes)} limit.`,
  );
}

console.log(`PASS entry bundle ${entry.name}: ${formatKb(entry.bytes)} <= ${formatKb(maxEntryBytes)}`);
