const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const manifest = JSON.parse(
  fs.readFileSync(
    path.join(__dirname, '../../src-tauri/src/lsp/lsp-servers.json'),
    'utf-8'
  )
);

describe('lsp-servers.json: structure', () => {
  it('has servers object', () => {
    assert.ok(manifest.servers, 'Should have servers object');
    assert.ok(typeof manifest.servers === 'object', 'servers should be an object');
  });

  it('has all Phase 1 servers', () => {
    const ids = Object.keys(manifest.servers);
    assert.ok(ids.includes('svelte'), 'Should have svelte server');
    assert.ok(ids.includes('typescript'), 'Should have typescript server');
    assert.ok(ids.includes('css'), 'Should have css server');
    assert.ok(ids.includes('html'), 'Should have html server');
    assert.ok(ids.includes('json'), 'Should have json server');
  });
});

describe('lsp-servers.json: server entries', () => {
  for (const [id, server] of Object.entries(manifest.servers)) {
    describe(id, () => {
      it('has required fields', () => {
        assert.ok(server.name, `${id}: should have name`);
        assert.ok(Array.isArray(server.languages), `${id}: should have languages array`);
        assert.ok(Array.isArray(server.extensions), `${id}: should have extensions array`);
        assert.ok(Array.isArray(server.excludeExtensions), `${id}: should have excludeExtensions array`);
        assert.ok(server.install, `${id}: should have install object`);
        assert.ok(['npm', 'github-release'].includes(server.install.type), `${id}: install type should be npm or github-release`);
        if (server.install.type === 'npm') {
          assert.ok(Array.isArray(server.install.packages), `${id}: npm type should have install.packages array`);
        }
        if (server.install.type === 'github-release') {
          assert.ok(server.install.repo, `${id}: github-release type should have repo`);
          assert.ok(server.install.assetPattern, `${id}: github-release type should have assetPattern`);
        }
        assert.ok(server.command, `${id}: should have command`);
        assert.ok(Array.isArray(server.args), `${id}: should have args array`);
        assert.ok(['primary', 'supplementary'].includes(server.priority), `${id}: should have valid priority`);
        assert.ok(typeof server.enabled === 'boolean', `${id}: should have enabled boolean`);
      });
    });
  }
});

describe('lsp-servers.json: svelte excludes', () => {
  it('typescript excludes .svelte', () => {
    assert.ok(
      manifest.servers.typescript.excludeExtensions.includes('.svelte'),
      'TypeScript should exclude .svelte'
    );
  });

  it('css excludes .svelte', () => {
    assert.ok(
      manifest.servers.css.excludeExtensions.includes('.svelte'),
      'CSS should exclude .svelte'
    );
  });

  it('html excludes .svelte', () => {
    assert.ok(
      manifest.servers.html.excludeExtensions.includes('.svelte'),
      'HTML should exclude .svelte'
    );
  });

  it('svelte does not exclude .svelte', () => {
    assert.ok(
      !manifest.servers.svelte.excludeExtensions.includes('.svelte'),
      'Svelte should NOT exclude .svelte'
    );
  });
});

describe('lsp-servers.json: typescript dependency', () => {
  it('typescript server installs typescript SDK', () => {
    assert.ok(
      manifest.servers.typescript.install.packages.includes('typescript'),
      'TypeScript server should install typescript SDK'
    );
  });

  it('svelte server installs typescript SDK', () => {
    assert.ok(
      manifest.servers.svelte.install.packages.includes('typescript'),
      'Svelte server should install typescript SDK'
    );
  });
});

describe('lsp-servers.json: priority field', () => {
  it('all Phase 1 servers have primary priority', () => {
    const phase1 = ['svelte', 'typescript', 'css', 'html', 'json'];
    for (const id of phase1) {
      assert.equal(
        manifest.servers[id].priority,
        'primary',
        `${id} should have priority "primary"`
      );
    }
  });

  it('every server has a valid priority value', () => {
    for (const [id, server] of Object.entries(manifest.servers)) {
      assert.ok(
        ['primary', 'supplementary'].includes(server.priority),
        `${id}: priority should be "primary" or "supplementary", got "${server.priority}"`
      );
    }
  });

  it('primary servers are not duplicating language coverage unnecessarily', () => {
    const primaryServers = Object.entries(manifest.servers)
      .filter(([, s]) => s.priority === 'primary');
    // Collect all extensions from primary servers
    const extCounts = {};
    for (const [id, server] of primaryServers) {
      for (const ext of server.extensions) {
        if (!server.excludeExtensions.includes(ext)) {
          if (!extCounts[ext]) extCounts[ext] = [];
          extCounts[ext].push(id);
        }
      }
    }
    // Each extension should have at most one primary server
    for (const [ext, servers] of Object.entries(extCounts)) {
      assert.ok(
        servers.length <= 1,
        `Extension ${ext} has multiple primary servers: ${servers.join(', ')}`
      );
    }
  });
});

describe('lsp-servers.json: shared packages', () => {
  it('css, html, json use vscode-langservers-extracted', () => {
    for (const id of ['css', 'html', 'json']) {
      assert.ok(
        manifest.servers[id].install.packages.includes('vscode-langservers-extracted'),
        `${id} should use vscode-langservers-extracted`
      );
    }
  });
});

describe('lsp-servers.json: eslint entry', () => {
  it('eslint entry exists', () => {
    assert.ok(manifest.servers.eslint, 'Should have eslint server entry');
  });

  it('eslint has supplementary priority', () => {
    assert.equal(
      manifest.servers.eslint.priority,
      'supplementary',
      'ESLint should be a supplementary server'
    );
  });

  it('eslint covers JS/TS extensions', () => {
    const exts = manifest.servers.eslint.extensions;
    assert.ok(exts.includes('.js'), 'Should cover .js');
    assert.ok(exts.includes('.jsx'), 'Should cover .jsx');
    assert.ok(exts.includes('.ts'), 'Should cover .ts');
    assert.ok(exts.includes('.tsx'), 'Should cover .tsx');
    assert.ok(exts.includes('.mjs'), 'Should cover .mjs');
    assert.ok(exts.includes('.cjs'), 'Should cover .cjs');
  });

  it('eslint excludes .svelte', () => {
    assert.ok(
      manifest.servers.eslint.excludeExtensions.includes('.svelte'),
      'ESLint should exclude .svelte'
    );
  });

  it('eslint uses vscode-langservers-extracted', () => {
    assert.ok(
      manifest.servers.eslint.install.packages.includes('vscode-langservers-extracted'),
      'ESLint should install from vscode-langservers-extracted'
    );
  });

  it('eslint uses --stdio', () => {
    assert.ok(
      manifest.servers.eslint.args.includes('--stdio'),
      'ESLint should use --stdio'
    );
  });

  it('eslint command is vscode-eslint-language-server', () => {
    assert.equal(
      manifest.servers.eslint.command,
      'vscode-eslint-language-server',
      'ESLint should use vscode-eslint-language-server binary'
    );
  });

  it('eslint has same JS/TS language IDs as typescript server', () => {
    const eslintLangs = manifest.servers.eslint.languages;
    const tsLangs = manifest.servers.typescript.languages;
    for (const lang of tsLangs) {
      assert.ok(
        eslintLangs.includes(lang),
        `ESLint should support ${lang} language`
      );
    }
  });
});

describe('lsp-servers.json: rust-analyzer entry', () => {
  it('rust-analyzer entry exists', () => {
    assert.ok(manifest.servers['rust-analyzer'], 'Should have rust-analyzer entry');
  });

  it('uses github-release install type', () => {
    assert.strictEqual(
      manifest.servers['rust-analyzer'].install.type,
      'github-release',
      'rust-analyzer should use github-release install type'
    );
  });

  it('covers .rs extension', () => {
    assert.ok(
      manifest.servers['rust-analyzer'].extensions.includes('.rs'),
      'rust-analyzer should cover .rs files'
    );
  });

  it('has repo field pointing to rust-lang/rust-analyzer', () => {
    assert.strictEqual(
      manifest.servers['rust-analyzer'].install.repo,
      'rust-lang/rust-analyzer',
      'Should point to the correct GitHub repo'
    );
  });

  it('has assetPattern with platform placeholders', () => {
    const pattern = manifest.servers['rust-analyzer'].install.assetPattern;
    assert.ok(pattern.includes('{arch}'), 'assetPattern should contain {arch} placeholder');
    assert.ok(pattern.includes('{os}'), 'assetPattern should contain {os} placeholder');
  });

  it('has primary priority', () => {
    assert.strictEqual(
      manifest.servers['rust-analyzer'].priority,
      'primary',
      'rust-analyzer should be a primary server'
    );
  });

  it('command is rust-analyzer', () => {
    assert.strictEqual(
      manifest.servers['rust-analyzer'].command,
      'rust-analyzer',
      'rust-analyzer command should be rust-analyzer'
    );
  });

  it('has rust in languages', () => {
    assert.ok(
      manifest.servers['rust-analyzer'].languages.includes('rust'),
      'rust-analyzer should support rust language'
    );
  });
});
