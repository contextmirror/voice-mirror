import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
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
export default defineConfig(async () => ({
  plugins: [svelte(), copyGhosttyWasm()],

  // Prevent Vite from obscuring Rust errors
  clearScreen: false,

  // Exclude ghostty-web from dep optimization so WASM resolves correctly
  optimizeDeps: {
    exclude: ['ghostty-web'],
  },
  assetsInclude: ['**/*.wasm'],

  build: {
    // Default single-page build from index.html
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
