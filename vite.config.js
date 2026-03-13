import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { visualizer } from 'rollup-plugin-visualizer';
import { existsSync, readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const host = process.env.TAURI_DEV_HOST;

/**
 * Vite plugin to make ghostty-web's WASM file available at runtime.
 *
 * ghostty-web loads ghostty-vt.wasm via fetch() at '/ghostty-vt.wasm'.
 * - In dev mode: serves it via middleware from node_modules.
 * - In production: emits it as an asset in the dist/ directory.
 */
function copyGhosttyWasm() {
  const wasmSrc = resolve(__dirname, 'node_modules/ghostty-web/ghostty-vt.wasm');

  return {
    name: 'copy-ghostty-wasm',
    generateBundle() {
      if (existsSync(wasmSrc)) {
        this.emitFile({
          type: 'asset',
          fileName: 'ghostty-vt.wasm',
          source: readFileSync(wasmSrc),
        });
      }
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url === '/ghostty-vt.wasm') {
          if (existsSync(wasmSrc)) {
            res.setHeader('Content-Type', 'application/wasm');
            res.end(readFileSync(wasmSrc));
            return;
          }
        }
        next();
      });
    },
  };
}

// https://vitejs.dev/config/
export default defineConfig(async ({ mode }) => ({
  plugins: [
    svelte(),
    copyGhosttyWasm(),
    mode === 'production' && visualizer({ filename: 'stats.html', gzipSize: true }),
  ].filter(Boolean),

  resolve: {
    alias: {
      $lib: resolve(__dirname, 'src/lib'),
    },
  },

  // Prevent Vite from obscuring Rust errors
  clearScreen: false,

  // Exclude ghostty-web from dep optimization so WASM resolves correctly
  optimizeDeps: {
    exclude: ['ghostty-web'],
  },
  assetsInclude: ['**/*.wasm'],

  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          codemirror: [
            'codemirror',
            '@codemirror/state',
            '@codemirror/view',
            '@codemirror/language',
            '@codemirror/commands',
            '@codemirror/autocomplete',
            '@codemirror/lint',
            '@codemirror/search',
            '@codemirror/lang-javascript',
            '@codemirror/lang-json',
            '@codemirror/lang-css',
            '@codemirror/lang-html',
            '@codemirror/lang-markdown',
            '@codemirror/lang-python',
            '@codemirror/lang-rust',
            '@codemirror/theme-one-dark',
            '@codemirror/merge',
            '@lezer/common',
            '@lezer/lr',
            '@lezer/highlight',
            '@lezer/javascript',
            '@lezer/json',
            '@lezer/css',
            '@lezer/html',
            '@lezer/markdown',
            '@lezer/python',
            '@lezer/rust',
          ],
          ghostty: ['ghostty-web'],
          markdown: ['highlight.js', 'dompurify', 'marked', 'marked-highlight'],
        },
      },
    },
  },

  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: 'ws',
          host,
          port: 1421,
        }
      : undefined,
  },
}));
