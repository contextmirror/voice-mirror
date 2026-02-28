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
        assert.ok(server.install.type === 'npm', `${id}: install type should be npm`);
        assert.ok(Array.isArray(server.install.packages), `${id}: should have install.packages array`);
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
