export type EditorLanguageKind =
  | 'json'
  | 'tsx'
  | 'typescript'
  | 'jsx'
  | 'javascript'
  | 'markdown'
  | 'css'
  | 'scss'
  | 'sass'
  | 'html'
  | 'xml'
  | 'vue'
  | 'svelte'
  | 'rust'
  | 'python'
  | 'go'
  | 'java'
  | 'kotlin'
  | 'swift'
  | 'c'
  | 'cpp'
  | 'csharp'
  | 'php'
  | 'ruby'
  | 'shell'
  | 'powershell'
  | 'sql'
  | 'dockerfile'
  | 'makefile'
  | 'diff'
  | 'toml'
  | 'yaml'
  | 'ini'
  | 'env'
  | 'plain';

export function fileNameFromPath(path?: string): string {
  if (typeof path !== 'string') return '';
  const cleaned = path.replace(/\0/g, '').trim().replace(/[\\/]+$/g, '');
  return cleaned ? cleaned.split(/[\\/]/).pop() ?? cleaned : '';
}

export function extensionForPath(path?: string): string {
  const fileName = fileNameFromPath(path).toLowerCase();
  if (!fileName || !fileName.includes('.')) return '';
  return fileName.slice(fileName.lastIndexOf('.') + 1);
}

export function editorLanguageKindForPath(path?: string): EditorLanguageKind {
  const fileName = fileNameFromPath(path).toLowerCase();
  const ext = extensionForPath(path);

  if (
    fileName === 'package.json' ||
    fileName === 'package-lock.json' ||
    fileName === 'tsconfig.json' ||
    fileName.startsWith('tsconfig.') && ext === 'json' ||
    ext === 'json' ||
    ext === 'jsonc'
  ) return 'json';
  if (ext === 'tsx') return 'tsx';
  if (ext === 'ts') return 'typescript';
  if (ext === 'jsx') return 'jsx';
  if (['js', 'mjs', 'cjs'].includes(ext)) return 'javascript';
  if (['md', 'markdown', 'mdx'].includes(ext)) return 'markdown';
  if (ext === 'css') return 'css';
  if (ext === 'scss') return 'scss';
  if (ext === 'sass') return 'sass';
  if (['html', 'htm'].includes(ext)) return 'html';
  if (['xml', 'svg', 'xsd', 'xsl'].includes(ext)) return 'xml';
  if (ext === 'vue') return 'vue';
  if (ext === 'svelte') return 'svelte';
  if (ext === 'rs') return 'rust';
  if (['py', 'pyw', 'pyi', 'gyp', 'gypi'].includes(ext) || fileName === 'sconstruct' || fileName === 'sconscript') return 'python';
  if (ext === 'go') return 'go';
  if (ext === 'java') return 'java';
  if (['kt', 'kts'].includes(ext)) return 'kotlin';
  if (ext === 'swift') return 'swift';
  if (['c', 'h'].includes(ext)) return 'c';
  if (['cpp', 'cxx', 'cc', 'hpp', 'hh', 'hxx'].includes(ext)) return 'cpp';
  if (['cs', 'csx'].includes(ext)) return 'csharp';
  if (['php', 'phtml'].includes(ext)) return 'php';
  if (['rb', 'rake', 'gemspec'].includes(ext) || fileName === 'rakefile' || fileName === 'gemfile') return 'ruby';
  if (['sh', 'bash', 'zsh', 'fish', 'ksh'].includes(ext) || fileName === '.bashrc' || fileName === '.zshrc') return 'shell';
  if (['ps1', 'psm1', 'psd1'].includes(ext)) return 'powershell';
  if (['sql', 'pgsql', 'mysql'].includes(ext)) return 'sql';
  if (fileName === 'dockerfile' || fileName.startsWith('dockerfile.') || ext === 'dockerfile') return 'dockerfile';
  if (fileName === 'makefile' || fileName === 'gnumakefile' || fileName === 'kbuild') return 'makefile';
  if (['diff', 'patch'].includes(ext)) return 'diff';
  if (fileName === 'cargo.lock' || ext === 'toml') return 'toml';
  if (['yaml', 'yml'].includes(ext)) return 'yaml';
  if (['ini', 'properties', 'conf'].includes(ext) || fileName === '.npmrc' || fileName === '.yarnrc') return 'ini';
  if (fileName === '.env' || fileName.startsWith('.env.') || fileName.startsWith('.env-')) return 'env';

  return 'plain';
}

const LABEL_BY_EXTENSION: Record<string, string> = {
  '1': 'Man Page',
  '3ds': '3D Studio',
  '3gp': '3GP Video',
  '7z': '7-Zip Archive',
  a: 'Static Library',
  aar: 'Android Archive',
  accdb: 'Access Database',
  adoc: 'AsciiDoc',
  aac: 'AAC Audio',
  ahk: 'AutoHotkey',
  ai: 'Adobe Illustrator',
  aiff: 'AIFF Audio',
  aidl: 'Android IDL',
  apk: 'Android Package',
  applescript: 'AppleScript',
  arb: 'ARB Localization',
  asciidoc: 'AsciiDoc',
  ass: 'ASS Subtitles',
  astro: 'Astro',
  avi: 'AVI Video',
  avif: 'AVIF Image',
  avsc: 'Avro Schema',
  awk: 'AWK',
  bat: 'Batch',
  bib: 'BibTeX',
  bin: 'Binary',
  blend: 'Blender',
  bmp: 'Bitmap Image',
  bz2: 'Bzip2 Archive',
  cab: 'Cabinet Archive',
  capnp: 'Capn Proto',
  cfg: 'Config',
  clj: 'Clojure',
  cljs: 'ClojureScript',
  cljc: 'Clojure',
  cmake: 'CMake',
  cmd: 'Command Script',
  conf: 'Config',
  config: 'Config',
  cr: 'Crystal',
  crt: 'Certificate',
  csr: 'Certificate Request',
  cue: 'CUE',
  dae: 'Collada',
  dart: 'Dart',
  dat: 'Data',
  db: 'Database',
  deb: 'Debian Package',
  dex: 'Android DEX',
  dhall: 'Dhall',
  dmg: 'Disk Image',
  doc: 'Word Document',
  docx: 'Word Document',
  dotx: 'Word Template',
  dwg: 'AutoCAD Drawing',
  dxf: 'AutoCAD DXF',
  ear: 'Java EAR',
  edn: 'EDN',
  eex: 'EEx',
  ejs: 'EJS',
  eot: 'Embedded Font',
  epub: 'EPUB',
  erl: 'Erlang',
  erb: 'ERB',
  ex: 'Elixir',
  exe: 'Executable',
  exs: 'Elixir',
  expect: 'Expect',
  fbx: 'FBX',
  fig: 'Figma',
  flac: 'FLAC Audio',
  flv: 'Flash Video',
  fnt: 'Font',
  fon: 'Font',
  fs: 'F#',
  fsi: 'F#',
  fsx: 'F#',
  ftl: 'Fluent',
  gem: 'Ruby Gem',
  gemspec: 'Ruby Gem Spec',
  geojson: 'GeoJSON',
  gif: 'GIF Image',
  glb: 'glTF Binary',
  gltf: 'glTF',
  gql: 'GraphQL',
  gradle: 'Gradle',
  gz: 'Gzip Archive',
  haml: 'Haml',
  hbs: 'Handlebars',
  hcl: 'HCL',
  heex: 'HEEx',
  heic: 'HEIC Image',
  hrl: 'Erlang Header',
  hs: 'Haskell',
  ico: 'Icon',
  ics: 'Calendar',
  iges: 'IGES',
  igs: 'IGES',
  ini: 'INI',
  ipa: 'iOS App',
  ipynb: 'Jupyter Notebook',
  iso: 'Disk Image',
  jar: 'Java Archive',
  jl: 'Julia',
  jpeg: 'JPEG Image',
  jpg: 'JPEG Image',
  j2: 'Jinja',
  jade: 'Jade',
  jinja: 'Jinja',
  jinja2: 'Jinja',
  json5: 'JSON5',
  jsonl: 'JSON Lines',
  jsp: 'JSP',
  key: 'Keynote',
  keychain: 'Keychain',
  lhs: 'Literate Haskell',
  lib: 'Library',
  liquid: 'Liquid',
  lua: 'Lua',
  m: 'Objective-C',
  m4a: 'M4A Audio',
  m4v: 'M4V Video',
  ma: 'Maya ASCII',
  man: 'Man Page',
  mat: 'MATLAB Data',
  max: '3ds Max',
  mb: 'Maya Binary',
  mdb: 'Access Database',
  mid: 'MIDI',
  midi: 'MIDI',
  mk: 'Makefile',
  mkv: 'Matroska Video',
  mm: 'Objective-C++',
  mo: 'Gettext Binary',
  mov: 'QuickTime Video',
  move: 'Move',
  mp3: 'MP3 Audio',
  mp4: 'MP4 Video',
  mpg: 'MPEG Video',
  mpeg: 'MPEG Video',
  msi: 'Windows Installer',
  mustache: 'Mustache',
  nef: 'Nikon RAW',
  nim: 'Nim',
  njk: 'Nunjucks',
  nfo: 'Info',
  numbers: 'Numbers',
  obj: 'Object',
  odin: 'Odin',
  odp: 'OpenDocument Presentation',
  ods: 'OpenDocument Spreadsheet',
  odt: 'OpenDocument Text',
  oga: 'Ogg Audio',
  ogg: 'Ogg Audio',
  ogv: 'Ogg Video',
  one: 'OneNote',
  opus: 'Opus Audio',
  orf: 'Olympus RAW',
  otf: 'OpenType Font',
  pages: 'Pages',
  parquet: 'Parquet',
  pbxproj: 'Xcode Project',
  pem: 'PEM Key',
  pickle: 'Pickle',
  pkl: 'Pickle',
  plist: 'Property List',
  ply: 'PLY 3D',
  po: 'Gettext',
  pot: 'Gettext Template',
  ppt: 'PowerPoint',
  pptx: 'PowerPoint',
  properties: 'Properties',
  proto: 'Protocol Buffers',
  psd: 'Photoshop',
  psv: 'Pipe-Separated Values',
  pub: 'Publisher',
  pug: 'Pug',
  r: 'R',
  rar: 'RAR Archive',
  raw: 'RAW Image',
  rds: 'R Data',
  reg: 'Registry',
  rej: 'Rejected Patch',
  resx: 'Resources',
  rpm: 'RPM Package',
  rtf: 'Rich Text',
  sav: 'SPSS Data',
  sc: 'Scala',
  scala: 'Scala',
  scpt: 'AppleScript',
  sed: 'sed',
  service: 'Systemd Service',
  sketch: 'Sketch',
  smali: 'Smali',
  sol: 'Solidity',
  socket: 'Systemd Socket',
  sqlite3: 'SQLite',
  srt: 'Subtitles',
  step: 'STEP',
  stl: 'STL 3D',
  storyboard: 'Storyboard',
  strings: 'Strings',
  stp: 'STEP',
  styl: 'Stylus',
  tcl: 'Tcl',
  tex: 'TeX',
  textile: 'Textile',
  thrift: 'Thrift',
  tif: 'TIFF Image',
  tiff: 'TIFF Image',
  timer: 'Systemd Timer',
  topojson: 'TopoJSON',
  ttf: 'TrueType Font',
  twig: 'Twig',
  usd: 'USD',
  usda: 'USD ASCII',
  usdc: 'USD Binary',
  v: 'V',
  vala: 'Vala',
  vbs: 'VBScript',
  vcf: 'vCard',
  vtt: 'WebVTT',
  war: 'Java WAR',
  wav: 'WAV Audio',
  weba: 'Web Audio',
  webm: 'WebM Video',
  webmanifest: 'Web Manifest',
  webp: 'WebP Image',
  whl: 'Python Wheel',
  wiki: 'Wiki',
  wma: 'Windows Media Audio',
  wmv: 'Windows Media Video',
  woff: 'Web Font',
  woff2: 'Web Font',
  wsf: 'Windows Script',
  xib: 'Xcode Interface',
  xlsx: 'Excel',
  xls: 'Excel',
  xlsm: 'Excel Macro',
  xz: 'XZ Archive',
  zip: 'ZIP Archive',
  zig: 'Zig',
};

const LABEL_BY_FILENAME: Record<string, string> = {
  '.babelrc': 'Babel Config',
  '.browserslistrc': 'Browserslist',
  '.dockerignore': 'Docker Ignore',
  '.editorconfig': 'EditorConfig',
  '.eslintrc.json': 'ESLint Config',
  '.gitattributes': 'Git Attributes',
  '.gitignore': 'Git Ignore',
  '.npmrc': 'npm Config',
  '.prettierrc': 'Prettier Config',
  '.stylelintrc': 'Stylelint Config',
  'bun.lockb': 'Bun Lockfile',
  brewfile: 'Brewfile',
  containerfile: 'Containerfile',
  'docker-compose.yml': 'Docker Compose',
  'docker-compose.yaml': 'Docker Compose',
  gemfile: 'Gemfile',
  'gemfile.lock': 'Gemfile Lock',
  jenkinsfile: 'Jenkinsfile',
  justfile: 'Justfile',
  license: 'License',
  notice: 'Notice',
  procfile: 'Procfile',
  readme: 'README',
  vagrantfile: 'Vagrantfile',
};

function plainFileTypeLabelForPath(path?: string): string {
  const fileName = fileNameFromPath(path);
  const lowerName = fileName.toLowerCase();
  if (!lowerName) return 'Plain Text';
  if (LABEL_BY_FILENAME[lowerName]) return LABEL_BY_FILENAME[lowerName];
  if (lowerName === '.env' || lowerName.startsWith('.env.') || lowerName.startsWith('.env-')) return 'ENV';
  const ext = extensionForPath(path);
  if (LABEL_BY_EXTENSION[ext]) return LABEL_BY_EXTENSION[ext];
  return ext ? ext.toUpperCase() : 'Plain Text';
}

export function languageLabelForPath(path?: string): string {
  switch (editorLanguageKindForPath(path)) {
    case 'json':
      return 'JSON';
    case 'tsx':
      return 'TSX';
    case 'typescript':
      return 'TypeScript';
    case 'jsx':
      return 'JSX';
    case 'javascript':
      return 'JavaScript';
    case 'markdown':
      return 'Markdown';
    case 'css':
      return 'CSS';
    case 'scss':
      return 'SCSS';
    case 'sass':
      return 'Sass';
    case 'html':
      return 'HTML';
    case 'xml':
      return 'XML';
    case 'vue':
      return 'Vue';
    case 'svelte':
      return 'Svelte';
    case 'rust':
      return 'Rust';
    case 'python':
      return 'Python';
    case 'go':
      return 'Go';
    case 'java':
      return 'Java';
    case 'kotlin':
      return 'Kotlin';
    case 'swift':
      return 'Swift';
    case 'c':
      return 'C';
    case 'cpp':
      return 'C++';
    case 'csharp':
      return 'C#';
    case 'php':
      return 'PHP';
    case 'ruby':
      return 'Ruby';
    case 'shell':
      return 'Shell';
    case 'powershell':
      return 'PowerShell';
    case 'sql':
      return 'SQL';
    case 'dockerfile':
      return 'Dockerfile';
    case 'makefile':
      return 'Makefile';
    case 'diff':
      return 'Diff';
    case 'toml':
      return 'TOML';
    case 'yaml':
      return 'YAML';
    case 'ini':
      return 'INI';
    case 'env':
      return 'ENV';
    case 'plain':
    default:
      return plainFileTypeLabelForPath(path);
  }
}
