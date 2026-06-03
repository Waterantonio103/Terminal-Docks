import { File as DefaultFileIcon, FileCode2, FileText, Folder as DefaultFolderIcon, Image, Settings } from 'lucide-react';
import { generateManifest, type Manifest } from 'material-icon-theme';
import { useState, type ReactNode } from 'react';
import {
  siC,
  siCplusplus,
  siCss,
  siDocker,
  siDotenv,
  siDotnet,
  siGnubash,
  siGo,
  siHtml5,
  siJavascript,
  siJson,
  siKotlin,
  siMarkdown,
  siMysql,
  siOpenjdk,
  siPhp,
  siPython,
  siReact,
  siRuby,
  siRust,
  siSass,
  siSqlite,
  siSvelte,
  siSwift,
  siToml,
  siTypescript,
  siVuedotjs,
  siXml,
  siYaml,
  type SimpleIcon,
} from 'simple-icons';

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
  '1',
  'adoc',
  'ahk',
  'aidl',
  'applescript',
  'arb',
  'asciidoc',
  'asp',
  'aspx',
  'astro',
  'awk',
  'bash',
  'bib',
  'cairo',
  'capnp',
  'cc',
  'clj',
  'cljs',
  'cljc',
  'cmake',
  'conf',
  'cr',
  'cshtml',
  'csx',
  'cts',
  'cue',
  'cxx',
  'd',
  'dart',
  'dhall',
  'eex',
  'ejs',
  'erl',
  'erb',
  'ex',
  'exs',
  'expect',
  'fs',
  'fsi',
  'fsx',
  'gemspec',
  'gql',
  'gradle',
  'graphql',
  'haml',
  'hbs',
  'hcl',
  'heex',
  'hrl',
  'hs',
  'hxx',
  'jade',
  'js',
  'jsx',
  'j2',
  'jinja',
  'jinja2',
  'jl',
  'jsp',
  'ts',
  'tsx',
  'mjs',
  'cjs',
  'ksh',
  'lhs',
  'liquid',
  'lua',
  'm',
  'make',
  'man',
  'metal',
  'mk',
  'mm',
  'mts',
  'mustache',
  'nim',
  'njk',
  'odin',
  'phtml',
  'pl',
  'pm',
  'proto',
  'pug',
  'r',
  'rake',
  'razor',
  'rego',
  'sc',
  'scala',
  'sed',
  'sol',
  'styl',
  't',
  'tcl',
  'tf',
  'tfvars',
  'thrift',
  'twig',
  'v',
  'vala',
  'vb',
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
  'zig',
]);

const TEXT_FILE_EXTENSIONS = new Set([
  'authors',
  'changelog',
  'creole',
  'license',
  'md',
  'mdx',
  'nfo',
  'notice',
  'org',
  'pod',
  'rej',
  'rtf',
  'rst',
  'txt',
  'todo',
  'textile',
  'wiki',
  'log',
  'csv',
  'tsv',
  'yaml',
  'yml',
  'toml',
  'ini',
  'lock',
]);

const CONFIG_FILE_EXTENSIONS = new Set([
  'babelrc',
  'browserslistrc',
  'cfg',
  'config',
  'containerfile',
  'dockerignore',
  'editorconfig',
  'env',
  'gitignore',
  'json',
  'jsonc',
  'npmrc',
  'prettierignore',
  'prettierrc',
  'xml',
  'yarnrc',
]);

const DATA_FILE_EXTENSIONS = new Set([
  'arb',
  'ass',
  'avsc',
  'dotenv',
  'edn',
  'ftl',
  'geojson',
  'ics',
  'json5',
  'jsonl',
  'ldif',
  'mo',
  'ndjson',
  'plist',
  'po',
  'pot',
  'props',
  'psv',
  'resx',
  'srt',
  'ssa',
  'ssv',
  'strings',
  'topojson',
  'vcf',
  'vtt',
]);

const AUDIO_FILE_EXTENSIONS = new Set([
  'aac',
  'aiff',
  'flac',
  'm4a',
  'mid',
  'midi',
  'mp3',
  'oga',
  'ogg',
  'opus',
  'wav',
  'weba',
  'wma',
]);

const VIDEO_FILE_EXTENSIONS = new Set([
  '3gp',
  'avi',
  'flv',
  'm4v',
  'mkv',
  'mov',
  'mp4',
  'mpeg',
  'mpg',
  'ogv',
  'ts',
  'webm',
  'wmv',
]);

const ARCHIVE_FILE_EXTENSIONS = new Set([
  '7z',
  'apk',
  'bz2',
  'cab',
  'crate',
  'deb',
  'dmg',
  'ear',
  'egg',
  'gem',
  'gz',
  'ipa',
  'iso',
  'jar',
  'nupkg',
  'pkg',
  'rar',
  'rpm',
  'tar',
  'tgz',
  'war',
  'whl',
  'xz',
  'zip',
]);

const OFFICE_FILE_EXTENSIONS = new Set([
  'doc',
  'docx',
  'dotx',
  'key',
  'numbers',
  'odp',
  'ods',
  'odt',
  'one',
  'pages',
  'pdf',
  'ppt',
  'pptx',
  'pub',
  'xls',
  'xlsm',
  'xlsx',
]);

const FONT_FILE_EXTENSIONS = new Set([
  'eot',
  'fnt',
  'fon',
  'otf',
  'ttf',
  'woff',
  'woff2',
]);

const MODEL_FILE_EXTENSIONS = new Set([
  '3ds',
  'abc',
  'blend',
  'dae',
  'dwg',
  'dxf',
  'fbx',
  'glb',
  'gltf',
  'iges',
  'igs',
  'ma',
  'max',
  'mb',
  'obj',
  'ply',
  'step',
  'stl',
  'stp',
  'usd',
  'usda',
  'usdc',
]);

const BINARY_FILE_EXTENSIONS = new Set([
  'a',
  'accdb',
  'app',
  'arrow',
  'bin',
  'class',
  'com',
  'dat',
  'db',
  'db3',
  'dex',
  'dll',
  'dylib',
  'exe',
  'feather',
  'lib',
  'mat',
  'mdb',
  'msi',
  'npy',
  'npz',
  'o',
  'orc',
  'parquet',
  'pickle',
  'pkl',
  'rds',
  'sav',
  'so',
  'sqlite3',
  'wasm',
]);

export type FileIconKind = 'brand' | 'badge' | 'lucide' | 'material';

export interface FileIconDescriptor {
  kind: FileIconKind;
  label: string;
  color: string;
  icon?: SimpleIcon;
  src?: string;
  iconName?: string;
  iconFile?: string;
}

const materialIconManifest = generateManifest({
  files: { associations: {} },
  folders: { associations: {}, theme: 'specific' },
  languages: { associations: {} },
}) as Manifest;

const importMeta = import.meta as ImportMeta & { env?: { BASE_URL?: string } };
const materialIconBaseUrl = `${importMeta.env?.BASE_URL ?? '/'}vendor/material-icon-theme/icons/`;

const ICON_BY_EXTENSION: Record<string, FileIconDescriptor> = {
  bash: brandIcon(siGnubash),
  c: brandIcon(siC),
  cc: brandIcon(siCplusplus),
  cpp: brandIcon(siCplusplus),
  cs: brandIcon(siDotnet, 'C#'),
  css: brandIcon(siCss),
  cxx: brandIcon(siCplusplus),
  dockerfile: brandIcon(siDocker),
  env: brandIcon(siDotenv, 'ENV'),
  go: brandIcon(siGo),
  h: brandIcon(siC),
  hh: brandIcon(siCplusplus),
  hpp: brandIcon(siCplusplus),
  html: brandIcon(siHtml5),
  htm: brandIcon(siHtml5),
  hxx: brandIcon(siCplusplus),
  java: brandIcon(siOpenjdk, 'Java'),
  js: brandIcon(siJavascript, 'JS'),
  json: brandIcon(siJson),
  jsonc: brandIcon(siJson, 'JSONC'),
  jsx: brandIcon(siReact, 'JSX'),
  kt: brandIcon(siKotlin),
  kts: brandIcon(siKotlin),
  mjs: brandIcon(siJavascript, 'JS'),
  cjs: brandIcon(siJavascript, 'JS'),
  md: brandIcon(siMarkdown),
  mdx: brandIcon(siMarkdown, 'MDX'),
  mysql: brandIcon(siMysql, 'SQL'),
  php: brandIcon(siPhp),
  phtml: brandIcon(siPhp),
  ps1: badgeIcon('PS', '#5391FE'),
  psd1: badgeIcon('PS', '#5391FE'),
  psm1: badgeIcon('PS', '#5391FE'),
  py: brandIcon(siPython),
  pyi: brandIcon(siPython),
  pyw: brandIcon(siPython),
  rb: brandIcon(siRuby),
  rs: brandIcon(siRust),
  sass: brandIcon(siSass),
  scss: brandIcon(siSass, 'SCSS'),
  sh: brandIcon(siGnubash),
  sql: brandIcon(siSqlite, 'SQL'),
  svelte: brandIcon(siSvelte),
  swift: brandIcon(siSwift),
  toml: brandIcon(siToml),
  ts: brandIcon(siTypescript, 'TS'),
  tsx: brandIcon(siReact, 'TSX'),
  vue: brandIcon(siVuedotjs, 'Vue'),
  xml: brandIcon(siXml),
  yaml: brandIcon(siYaml),
  yml: brandIcon(siYaml),
  zsh: brandIcon(siGnubash, 'Zsh'),
};

const ICON_BY_FILENAME: Record<string, FileIconDescriptor> = {
  '.env': brandIcon(siDotenv, 'ENV'),
  '.gitignore': badgeIcon('Git', '#F05032'),
  '.npmrc': badgeIcon('npm', '#CB3837'),
  '.yarnrc': badgeIcon('Yarn', '#2C8EBB'),
  'cargo.lock': brandIcon(siRust),
  'cargo.toml': brandIcon(siRust),
  containerfile: brandIcon(siDocker, 'Container'),
  dockerfile: brandIcon(siDocker),
  'docker-compose.yml': brandIcon(siDocker, 'Compose'),
  'docker-compose.yaml': brandIcon(siDocker, 'Compose'),
  gemfile: brandIcon(siRuby),
  justfile: badgeIcon('Just', '#6EAA5E'),
  makefile: badgeIcon('Mk', '#6EAA5E'),
  'package.json': brandIcon(siJson, 'npm'),
  'package-lock.json': brandIcon(siJson, 'npm'),
  rakefile: brandIcon(siRuby),
  'tsconfig.json': brandIcon(siTypescript, 'TS'),
};

function brandIcon(icon: SimpleIcon, label = icon.title): FileIconDescriptor {
  return { kind: 'brand', icon, label, color: `#${icon.hex}` };
}

function badgeIcon(label: string, color: string): FileIconDescriptor {
  return { kind: 'badge', label, color };
}

function materialIcon(iconName?: string, label = iconName ?? 'File'): FileIconDescriptor | null {
  if (!iconName) return null;
  const iconPath = materialIconManifest.iconDefinitions?.[iconName]?.iconPath;
  const iconFileName = iconPath?.split(/[\\/]/).pop();

  return {
    kind: 'material',
    label,
    color: 'currentColor',
    src: iconFileName ? `${materialIconBaseUrl}${encodeURIComponent(iconFileName)}` : undefined,
    iconName,
    iconFile: iconFileName,
  };
}

function cleanPathKey(pathOrName?: string | null): string {
  return (pathOrName ?? '').replace(/\0/g, '').trim().replace(/[?#].*$/, '').replace(/\\/g, '/').toLowerCase();
}

function cleanBaseName(pathOrName?: string | null): string {
  return cleanPathKey(pathOrName).split('/').pop() ?? '';
}

function materialFileIconDescriptor(pathOrName?: string | null): FileIconDescriptor | null {
  const lowerPath = cleanPathKey(pathOrName);
  const lowerName = cleanBaseName(pathOrName);
  const ext = getFileExtension(pathOrName);

  const iconName =
    materialIconManifest.fileNames?.[lowerPath] ??
    materialIconManifest.fileNames?.[lowerName] ??
    materialIconManifest.fileExtensions?.[lowerName] ??
    materialIconManifest.fileExtensions?.[ext] ??
    materialIconManifest.file;

  return materialIcon(iconName, iconName ?? 'File');
}

export function getFolderIconDescriptor(folderName?: string | null, expanded = false): FileIconDescriptor {
  void folderName;
  const iconName = expanded
    ? materialIconManifest.folderExpanded ?? materialIconManifest.folder
    : materialIconManifest.folder ?? materialIconManifest.folderExpanded;

  return materialIcon(iconName, iconName ?? 'Folder') ?? { kind: 'lucide', label: 'Folder', color: '#90A4AE' };
}

export function getFileExtension(pathOrName?: string | null): string {
  const name = ((pathOrName ?? '').replace(/\0/g, '').trim().split(/[\\/]/).pop() ?? '')
    .replace(/[?#].*$/, '');
  const lowerName = name.toLowerCase();
  if (lowerName === '.env' || lowerName.startsWith('.env.') || lowerName.startsWith('.env-')) return 'env';
  if (lowerName.startsWith('.') && !lowerName.slice(1).includes('.')) return lowerName.slice(1);
  const index = name.lastIndexOf('.');
  if (index <= 0 || index === name.length - 1) return '';
  return name.slice(index + 1).trim().toLowerCase();
}

export function isImageFile(pathOrName?: string | null): boolean {
  return IMAGE_FILE_EXTENSIONS.has(getFileExtension(pathOrName));
}

export function isBinaryLikeFile(pathOrName?: string | null): boolean {
  const ext = getFileExtension(pathOrName);
  return (
    AUDIO_FILE_EXTENSIONS.has(ext) ||
    VIDEO_FILE_EXTENSIONS.has(ext) ||
    ARCHIVE_FILE_EXTENSIONS.has(ext) ||
    OFFICE_FILE_EXTENSIONS.has(ext) ||
    FONT_FILE_EXTENSIONS.has(ext) ||
    MODEL_FILE_EXTENSIONS.has(ext) ||
    BINARY_FILE_EXTENSIONS.has(ext)
  );
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

export function getFileIconDescriptor(pathOrName?: string | null): FileIconDescriptor {
  const name = ((pathOrName ?? '').replace(/\0/g, '').trim().split(/[\\/]/).pop() ?? '')
    .replace(/[?#].*$/, '');
  const lowerName = name.toLowerCase();
  const ext = getFileExtension(name);
  const themedIcon = materialFileIconDescriptor(pathOrName);
  if (themedIcon) return themedIcon;

  if (ICON_BY_FILENAME[lowerName]) return ICON_BY_FILENAME[lowerName];
  if (lowerName.startsWith('.env.') || lowerName.startsWith('.env-')) return brandIcon(siDotenv, 'ENV');
  if (ICON_BY_EXTENSION[ext]) return ICON_BY_EXTENSION[ext];
  if (IMAGE_FILE_EXTENSIONS.has(ext)) return { kind: 'lucide', label: 'Image', color: '#7DD3FC' };
  if (AUDIO_FILE_EXTENSIONS.has(ext)) return badgeIcon('Audio', '#F9A8D4');
  if (VIDEO_FILE_EXTENSIONS.has(ext)) return badgeIcon('Video', '#FDA4AF');
  if (ARCHIVE_FILE_EXTENSIONS.has(ext)) return badgeIcon('Zip', '#FBBF24');
  if (OFFICE_FILE_EXTENSIONS.has(ext)) return badgeIcon(ext === 'pdf' ? 'PDF' : 'Doc', '#60A5FA');
  if (FONT_FILE_EXTENSIONS.has(ext)) return badgeIcon('Font', '#C084FC');
  if (MODEL_FILE_EXTENSIONS.has(ext)) return badgeIcon('3D', '#2DD4BF');
  if (BINARY_FILE_EXTENSIONS.has(ext)) return badgeIcon('Bin', '#94A3B8');
  if (DATA_FILE_EXTENSIONS.has(ext)) return badgeIcon('Data', '#34D399');
  if (CONFIG_FILE_EXTENSIONS.has(ext)) return { kind: 'lucide', label: 'Config', color: '#FCD34D' };
  if (CODE_FILE_EXTENSIONS.has(ext)) return { kind: 'lucide', label: 'Code', color: '#C4B5FD' };
  if (TEXT_FILE_EXTENSIONS.has(ext)) return { kind: 'lucide', label: 'Text', color: '#6EE7B7' };
  return { kind: 'lucide', label: 'File', color: 'currentColor' };
}

function SimpleBrandIcon({
  descriptor,
  size,
  className,
}: {
  descriptor: FileIconDescriptor;
  size: number;
  className: string;
}) {
  if (!descriptor.icon) return null;
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      className={className}
      style={{ color: descriptor.color }}
      aria-hidden="true"
      focusable="false"
    >
      <path fill="currentColor" d={descriptor.icon.path} />
    </svg>
  );
}

function BadgeIcon({
  descriptor,
  size,
  className,
}: {
  descriptor: FileIconDescriptor;
  size: number;
  className: string;
}) {
  return (
    <span
      className={`inline-flex items-center justify-center rounded-[2px] font-bold leading-none ${className}`}
      style={{
        width: size,
        height: size,
        color: descriptor.color,
        fontSize: Math.max(7, Math.round(size * 0.48)),
      }}
      aria-hidden="true"
    >
      {descriptor.label.slice(0, 3)}
    </span>
  );
}

function MaterialIcon({
  descriptor,
  size,
  className,
  fallback,
}: {
  descriptor: FileIconDescriptor;
  size: number;
  className: string;
  fallback?: ReactNode;
}) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const src = descriptor.src;

  if (!src || failedSrc === src) return fallback ?? <DefaultFileIcon size={size} className={`text-text-muted ${className}`} />;
  return (
    <img
      src={src}
      width={size}
      height={size}
      className={className}
      alt=""
      aria-hidden="true"
      draggable={false}
      onError={() => setFailedSrc(src)}
    />
  );
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
  const descriptor = getFileIconDescriptor(fileName);
  if (descriptor.kind === 'material') return <MaterialIcon descriptor={descriptor} size={size} className={className} />;
  if (descriptor.kind === 'brand') return <SimpleBrandIcon descriptor={descriptor} size={size} className={className} />;
  if (descriptor.kind === 'badge') return <BadgeIcon descriptor={descriptor} size={size} className={className} />;
  if (IMAGE_FILE_EXTENSIONS.has(ext)) return <Image size={size} className={`text-sky-300 ${className}`} />;
  if (CONFIG_FILE_EXTENSIONS.has(ext)) return <Settings size={size} className={`text-amber-300 ${className}`} />;
  if (CODE_FILE_EXTENSIONS.has(ext)) return <FileCode2 size={size} className={`text-violet-300 ${className}`} />;
  if (TEXT_FILE_EXTENSIONS.has(ext)) return <FileText size={size} className={`text-emerald-300 ${className}`} />;
  return <DefaultFileIcon size={size} className={`text-text-muted ${className}`} />;
}

export function FolderTypeIcon({
  folderName,
  expanded = false,
  size = 13,
  className = '',
}: {
  folderName?: string | null;
  expanded?: boolean;
  size?: number;
  className?: string;
}) {
  const descriptor = getFolderIconDescriptor(folderName, expanded);
  if (descriptor.kind === 'material') {
    return (
      <MaterialIcon
        descriptor={descriptor}
        size={size}
        className={className}
        fallback={<DefaultFolderIcon size={size} className={`text-text-muted ${className}`} />}
      />
    );
  }
  return <DefaultFolderIcon size={size} className={`text-text-muted ${className}`} />;
}
