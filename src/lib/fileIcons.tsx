import { File as DefaultFileIcon, FileCode2, FileText, Image, Settings } from 'lucide-react';

export const IMAGE_FILE_EXTENSIONS = new Set([
  'png',
  'jpg',
  'jpeg',
  'jfif',
  'gif',
  'webp',
  'bmp',
  'svg',
  'ico',
  'avif',
  'apng',
  'tif',
  'tiff',
  'heic',
  'heif',
]);

const CODE_FILE_EXTENSIONS = new Set([
  'js',
  'jsx',
  'ts',
  'tsx',
  'mjs',
  'cjs',
  'css',
  'scss',
  'sass',
  'less',
  'html',
  'htm',
  'rs',
  'py',
  'go',
  'java',
  'kt',
  'swift',
  'c',
  'h',
  'cpp',
  'hpp',
  'cs',
  'php',
  'rb',
  'sh',
  'ps1',
  'sql',
  'vue',
  'svelte',
]);

const TEXT_FILE_EXTENSIONS = new Set([
  'md',
  'mdx',
  'txt',
  'log',
  'csv',
  'tsv',
  'yaml',
  'yml',
  'toml',
  'ini',
  'lock',
]);

const CONFIG_FILE_EXTENSIONS = new Set(['json', 'jsonc', 'xml', 'env']);

export function getFileExtension(pathOrName?: string | null): string {
  const name = (pathOrName ?? '').split(/[\\/]/).pop() ?? '';
  const index = name.lastIndexOf('.');
  if (index <= 0 || index === name.length - 1) return '';
  return name.slice(index + 1).toLowerCase();
}

export function isImageFile(pathOrName?: string | null): boolean {
  return IMAGE_FILE_EXTENSIONS.has(getFileExtension(pathOrName));
}

export function getImageMimeType(pathOrName?: string | null): string {
  switch (getFileExtension(pathOrName)) {
    case 'jpg':
    case 'jpeg':
    case 'jfif':
      return 'image/jpeg';
    case 'svg':
      return 'image/svg+xml';
    case 'ico':
      return 'image/x-icon';
    case 'tif':
    case 'tiff':
      return 'image/tiff';
    case 'heic':
      return 'image/heic';
    case 'heif':
      return 'image/heif';
    case 'apng':
      return 'image/apng';
    default:
      return `image/${getFileExtension(pathOrName) || 'png'}`;
  }
}

export function FileTypeIcon({
  fileName,
  size = 13,
  className = '',
}: {
  fileName?: string | null;
  size?: number;
  className?: string;
}) {
  const ext = getFileExtension(fileName);
  if (IMAGE_FILE_EXTENSIONS.has(ext)) return <Image size={size} className={`text-sky-300 ${className}`} />;
  if (CONFIG_FILE_EXTENSIONS.has(ext)) return <Settings size={size} className={`text-amber-300 ${className}`} />;
  if (CODE_FILE_EXTENSIONS.has(ext)) return <FileCode2 size={size} className={`text-violet-300 ${className}`} />;
  if (TEXT_FILE_EXTENSIONS.has(ext)) return <FileText size={size} className={`text-emerald-300 ${className}`} />;
  return <DefaultFileIcon size={size} className={`text-text-muted ${className}`} />;
}
