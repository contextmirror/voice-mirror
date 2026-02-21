/**
 * file-icons.js -- Maps file/folder names to SVG sprite icon IDs.
 *
 * Adapted from OpenCode Desktop (https://github.com/anomalyco/opencode).
 * Copyright (c) 2025 opencode — MIT License.
 * See src/assets/icons/LICENSE-file-icons for the full license text.
 *
 * Icons come from src/assets/icons/file-icons-sprite.svg (1089 symbols).
 * Usage: chooseIconName(path, type, expanded) => icon ID string
 */

const FILE_NAMES = {
  'readme.md': 'Readme', 'changelog.md': 'Changelog', 'contributing.md': 'Contributing',
  'conduct.md': 'Conduct', 'license': 'Certificate', 'authors': 'Authors',
  'package.json': 'Nodejs', 'package-lock.json': 'Nodejs', 'yarn.lock': 'Yarn',
  'pnpm-lock.yaml': 'Pnpm', 'bun.lock': 'Bun', 'bun.lockb': 'Bun', 'bunfig.toml': 'Bun',
  '.nvmrc': 'Nodejs', '.node-version': 'Nodejs',
  'dockerfile': 'Docker', 'docker-compose.yml': 'Docker', 'docker-compose.yaml': 'Docker',
  '.dockerignore': 'Docker',
  'jest.config.js': 'Jest', 'jest.config.ts': 'Jest', 'jest.config.mjs': 'Jest',
  'vitest.config.js': 'Vitest', 'vitest.config.ts': 'Vitest',
  'tailwind.config.js': 'Tailwindcss', 'tailwind.config.ts': 'Tailwindcss',
  'turbo.json': 'Turborepo', 'tsconfig.json': 'Tsconfig', 'jsconfig.json': 'Jsconfig',
  '.eslintrc': 'Eslint', '.eslintrc.js': 'Eslint', '.eslintrc.json': 'Eslint',
  '.prettierrc': 'Prettier', '.prettierrc.js': 'Prettier', '.prettierrc.json': 'Prettier',
  'vite.config.js': 'Vite', 'vite.config.ts': 'Vite',
  'webpack.config.js': 'Webpack', 'rollup.config.js': 'Rollup',
  'next.config.js': 'Next', 'next.config.mjs': 'Next',
  'nuxt.config.js': 'Nuxt', 'nuxt.config.ts': 'Nuxt',
  'svelte.config.js': 'Svelte',
  '.gitignore': 'Git', '.gitattributes': 'Git',
  'makefile': 'Makefile',
  'cargo.toml': 'Rust', 'go.mod': 'GoMod', 'go.sum': 'GoMod',
  'requirements.txt': 'Python', 'pyproject.toml': 'Python', 'pipfile': 'Python',
  'gemfile': 'Gemfile', 'rakefile': 'Ruby', 'composer.json': 'Php',
  'build.gradle': 'Gradle', 'pom.xml': 'Maven',
  'deno.json': 'Deno', 'deno.jsonc': 'Deno',
  'vercel.json': 'Vercel', 'netlify.toml': 'Netlify',
  '.env': 'Tune', '.env.local': 'Tune', '.env.development': 'Tune',
  '.env.production': 'Tune', '.env.example': 'Tune',
  '.editorconfig': 'Editorconfig', 'robots.txt': 'Robots', 'favicon.ico': 'Favicon',
  '.babelrc': 'Babel', 'babel.config.js': 'Babel',
  'playwright.config.js': 'Playwright', 'wrangler.toml': 'Wrangler',
  'firebase.json': 'Firebase',
  'dependabot.yml': 'Dependabot', 'renovate.json': 'Renovate',
  'lerna.json': 'Lerna', 'nx.json': 'Nx',
  '.mcp.json': 'Settings',
  'claude.md': 'Markdown', 'agents.md': 'Markdown',
  'roadmap.md': 'Markdown', 'security.md': 'Certificate',
  'code_of_conduct.md': 'Conduct',
};

const FILE_EXTENSIONS = {
  // Test files
  'spec.ts': 'TestTs', 'test.ts': 'TestTs', 'spec.tsx': 'TestJsx', 'test.tsx': 'TestJsx',
  'spec.js': 'TestJs', 'test.js': 'TestJs', 'spec.jsx': 'TestJsx', 'test.jsx': 'TestJsx',
  'test.cjs': 'TestJs', 'test.mjs': 'TestJs',
  // JS/TS
  'js.map': 'JavascriptMap', 'd.ts': 'TypescriptDef',
  'ts': 'Typescript', 'tsx': 'React_ts', 'js': 'Javascript', 'jsx': 'React',
  'mjs': 'Javascript', 'cjs': 'Javascript',
  // Web
  'html': 'Html', 'htm': 'Html', 'css': 'Css', 'scss': 'Sass', 'sass': 'Sass', 'less': 'Less',
  // Data
  'json': 'Json', 'xml': 'Xml', 'yml': 'Yaml', 'yaml': 'Yaml', 'toml': 'Toml',
  // Docs
  'md': 'Markdown', 'mdx': 'Mdx', 'tex': 'Tex',
  // Languages
  'py': 'Python', 'rs': 'Rust', 'go': 'Go', 'java': 'Java', 'kt': 'Kotlin',
  'scala': 'Scala', 'php': 'Php', 'rb': 'Ruby', 'cs': 'Csharp',
  'cpp': 'Cpp', 'cc': 'Cpp', 'cxx': 'Cpp', 'c': 'C', 'h': 'H', 'hpp': 'Hpp',
  'swift': 'Swift', 'dart': 'Dart', 'lua': 'Lua', 'pl': 'Perl', 'r': 'R',
  'jl': 'Julia', 'hs': 'Haskell', 'elm': 'Elm', 'ml': 'Ocaml',
  'clj': 'Clojure', 'cljs': 'Clojure', 'erl': 'Erlang',
  'ex': 'Elixir', 'exs': 'Elixir', 'nim': 'Nim', 'zig': 'Zig',
  'v': 'Vlang', 'gleam': 'Gleam', 'fs': 'Fsharp',
  // Shell
  'sh': 'Console', 'bash': 'Console', 'zsh': 'Console', 'fish': 'Console', 'ps1': 'Powershell',
  // Config
  'cfg': 'Settings', 'ini': 'Settings', 'conf': 'Settings', 'properties': 'Settings',
  // Media
  'svg': 'Svg', 'png': 'Image', 'jpg': 'Image', 'jpeg': 'Image', 'gif': 'Image',
  'webp': 'Image', 'ico': 'Favicon',
  'mp4': 'Video', 'mov': 'Video', 'avi': 'Video', 'webm': 'Video',
  'mp3': 'Audio', 'wav': 'Audio', 'flac': 'Audio',
  // Archives
  'zip': 'Zip', 'tar': 'Zip', 'gz': 'Zip', 'rar': 'Zip', '7z': 'Zip',
  // Documents
  'pdf': 'Pdf', 'doc': 'Word', 'docx': 'Word',
  // Database
  'sql': 'Database', 'db': 'Database', 'sqlite': 'Database',
  // Other
  'env': 'Tune', 'log': 'Log', 'lock': 'Lock', 'key': 'Key',
  'pem': 'Certificate', 'crt': 'Certificate',
  'graphql': 'Graphql', 'gql': 'Graphql', 'wasm': 'Webassembly',
  'svelte': 'Svelte',
};

const FOLDER_NAMES = {
  'src': 'FolderSrc', 'source': 'FolderSrc', 'lib': 'FolderLib', 'libs': 'FolderLib',
  'test': 'FolderTest', 'tests': 'FolderTest', '__tests__': 'FolderTest', 'spec': 'FolderTest',
  'e2e': 'FolderTest',
  'node_modules': 'FolderNode', 'vendor': 'FolderPackages', 'packages': 'FolderPackages',
  'build': 'FolderBuildkite', 'dist': 'FolderDist', 'out': 'FolderDist', 'target': 'FolderTarget',
  'config': 'FolderConfig', 'configs': 'FolderConfig', 'settings': 'FolderConfig',
  'docker': 'FolderDocker',
  'docs': 'FolderDocs', 'doc': 'FolderDocs', 'documentation': 'FolderDocs',
  'public': 'FolderPublic', 'static': 'FolderPublic',
  'assets': 'FolderImages', 'images': 'FolderImages', 'img': 'FolderImages', 'icons': 'FolderImages',
  'fonts': 'FolderFont', 'styles': 'FolderCss', 'css': 'FolderCss', 'sass': 'FolderSass', 'scss': 'FolderSass',
  'scripts': 'FolderScripts', 'tools': 'FolderTools', 'utils': 'FolderUtils', 'helpers': 'FolderHelper',
  'components': 'FolderComponents', 'views': 'FolderViews', 'layouts': 'FolderLayout',
  'templates': 'FolderTemplate', 'hooks': 'FolderHook', 'store': 'FolderStore', 'stores': 'FolderStore',
  'services': 'FolderApi', 'api': 'FolderApi', 'routes': 'FolderRoutes',
  'middleware': 'FolderMiddleware', 'controllers': 'FolderController',
  'models': 'FolderDatabase', 'schemas': 'FolderDatabase', 'migrations': 'FolderDatabase',
  'types': 'FolderTypescript', 'typings': 'FolderTypescript', '@types': 'FolderTypescript',
  'interfaces': 'FolderInterface',
  'android': 'FolderAndroid', 'ios': 'FolderIos',
  '.github': 'FolderGithub', '.gitlab': 'FolderGitlab',
  'ci': 'FolderCi', '.ci': 'FolderCi', 'workflows': 'FolderGhWorkflows',
  '.git': 'FolderGit', '.vscode': 'FolderVscode', '.idea': 'FolderIntellij',
  '.cursor': 'FolderCursor',
  'i18n': 'FolderI18n', 'locales': 'FolderI18n', 'lang': 'FolderI18n',
  'temp': 'FolderTemp', 'tmp': 'FolderTemp', 'logs': 'FolderLog',
  'examples': 'FolderExamples', 'demo': 'FolderExamples', 'samples': 'FolderExamples',
  'mocks': 'FolderMock', 'data': 'FolderDatabase', 'database': 'FolderDatabase', 'prisma': 'FolderPrisma',
  'security': 'FolderSecure', 'auth': 'FolderSecure',
  'keys': 'FolderKeys', 'certs': 'FolderKeys',
  'content': 'FolderContent', 'posts': 'FolderContent', 'blog': 'FolderContent',
  'functions': 'FolderFunctions', 'lambda': 'FolderFunctions', 'serverless': 'FolderServerless',
  'jobs': 'FolderJob', 'tasks': 'FolderTasks',
  'internal': 'FolderConfig',
  'providers': 'FolderApi', 'commands': 'FolderScripts',
  'ipc': 'FolderApi', 'voice': 'FolderFunctions', 'mcp': 'FolderApi',
  'shared': 'FolderComponents', 'terminal': 'FolderComponents',
  'chat': 'FolderComponents', 'lens': 'FolderComponents', 'sidebar': 'FolderComponents',
  'overlay': 'FolderComponents',
};

const DEFAULTS = { file: 'Document', folder: 'Folder', folderOpen: 'FolderOpen' };

function toOpenVariant(icon) {
  if (!icon.startsWith('Folder')) return icon;
  if (icon.endsWith('Open')) return icon;
  return icon + 'Open';
}

function basename(p) {
  return p.replace(/\\/g, '/').split('/').filter(Boolean).pop() || '';
}

/**
 * Get all dotted suffixes of a filename, longest first.
 * e.g. "foo.test.js" => ["foo.test.js", "test.js", "js"]
 */
function dottedSuffixes(name) {
  const indices = [];
  for (let i = 0; i < name.length; i++) {
    if (name[i] === '.') indices.push(i);
  }
  const out = [name]; // full name as a "suffix" for exact matches like "dockerfile"
  for (const i of indices) {
    if (i + 1 < name.length) out.push(name.slice(i + 1));
  }
  return out.sort((a, b) => b.length - a.length);
}

/**
 * Choose the icon name for a file or directory.
 * @param {string} path - File path (relative or absolute)
 * @param {'file'|'directory'} type - Entry type
 * @param {boolean} expanded - Whether directory is expanded
 * @returns {string} Icon ID matching a <symbol> in the sprite
 */
export function chooseIconName(path, type, expanded = false) {
  const base = basename(path).toLowerCase();

  if (type === 'directory') {
    // Check folder name variants: name, .name, _name, __name__
    for (const variant of [base, '.' + base, '_' + base, '__' + base + '__']) {
      const icon = FOLDER_NAMES[variant];
      if (icon) return expanded ? toOpenVariant(icon) : icon;
    }
    return expanded ? DEFAULTS.folderOpen : DEFAULTS.folder;
  }

  // Check exact file name match
  const byName = FILE_NAMES[base];
  if (byName) return byName;

  // Check dotted suffixes (longest first for specificity)
  for (const ext of dottedSuffixes(base)) {
    const icon = FILE_EXTENSIONS[ext];
    if (icon) return icon;
  }

  return DEFAULTS.file;
}
