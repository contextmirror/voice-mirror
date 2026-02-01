/**
 * Voice Mirror Memory System - Local Embedding Provider
 * Uses embeddinggemma-300M via node-llama-cpp for offline embedding
 *
 * This is the preferred provider - no API costs, works offline
 */

const path = require('path');
const fs = require('fs');
const { getModelCacheDir, withTimeout } = require('../utils');

const DEFAULT_MODEL = 'embeddinggemma-300M-Q8_0.gguf';
const DEFAULT_DIMENSIONS = 256;
const MODEL_URL = 'https://huggingface.co/ggml-org/embeddinggemma-300M-GGUF/resolve/main/embeddinggemma-300M-Q8_0.gguf';

class LocalProvider {
    constructor(options = {}) {
        this.id = 'local';
        this.model = options.model || DEFAULT_MODEL;
        this.dimensions = DEFAULT_DIMENSIONS;
        this.modelPath = options.modelPath || path.join(getModelCacheDir(), this.model);
        this._llama = null;
        this._model = null;
        this._context = null;
        this._initialized = false;
    }

    async init() {
        if (this._initialized) return;

        if (!fs.existsSync(this.modelPath)) {
            throw new Error(`Local embedding model not found at ${this.modelPath}. Run 'voice-mirror download-model' or set up the model manually.`);
        }

        try {
            await withTimeout((async () => {
                const { getLlama } = await import('node-llama-cpp');
                this._llama = await getLlama();
                this._model = await this._llama.loadModel({ modelPath: this.modelPath });
                this._context = await this._model.createEmbeddingContext();
            })(), 30000, 'Local embedding init');
            this._initialized = true;
        } catch (err) {
            this._context = null;
            this._model = null;
            this._llama = null;
            if (err.code === 'MODULE_NOT_FOUND') {
                throw new Error('node-llama-cpp not installed. Run: npm install node-llama-cpp');
            }
            throw new Error(`Failed to load local embedding model: ${err.message}`);
        }
    }

    /**
     * Embed a single text
     * @param {string} text
     * @returns {Promise<number[]>}
     */
    async embedQuery(text) {
        if (!this._initialized) {
            await this.init();
        }

        const embedding = await withTimeout(
            this._context.getEmbeddingFor(text),
            300000,
            'Local embedding query'
        );
        return Array.from(embedding.vector);
    }

    /**
     * Embed multiple texts
     * @param {string[]} texts
     * @returns {Promise<number[][]>}
     */
    async embedBatch(texts) {
        if (texts.length === 0) return [];

        if (!this._initialized) {
            await this.init();
        }

        // Process sequentially - local model doesn't benefit from batching
        const results = [];
        for (const text of texts) {
            const embedding = await this._context.getEmbeddingFor(text);
            results.push(Array.from(embedding.vector));
        }
        return results;
    }

    /**
     * Close the model context (free memory)
     */
    async close() {
        if (this._context) {
            // node-llama-cpp handles cleanup automatically
            this._context = null;
        }
        if (this._model) {
            this._model = null;
        }
        if (this._llama) {
            this._llama = null;
        }
        this._initialized = false;
    }

    /**
     * Download the embedding model
     * @param {Function} [onProgress] - Progress callback (0-100)
     * @returns {Promise<string>} Path to downloaded model
     */
    static async downloadModel(onProgress) {
        const https = require('https');
        const modelDir = getModelCacheDir();
        const modelPath = path.join(modelDir, DEFAULT_MODEL);

        // Create directory if needed
        if (!fs.existsSync(modelDir)) {
            fs.mkdirSync(modelDir, { recursive: true });
        }

        // Check if already exists
        if (fs.existsSync(modelPath)) {
            if (onProgress) onProgress(100);
            return modelPath;
        }

        return new Promise((resolve, reject) => {
            const file = fs.createWriteStream(modelPath);
            let downloadedBytes = 0;
            let totalBytes = 0;

            const download = (url) => {
                https.get(url, (response) => {
                    // Handle redirects
                    if (response.statusCode === 301 || response.statusCode === 302) {
                        download(response.headers.location);
                        return;
                    }

                    if (response.statusCode !== 200) {
                        reject(new Error(`Failed to download: HTTP ${response.statusCode}`));
                        return;
                    }

                    totalBytes = parseInt(response.headers['content-length'], 10) || 0;

                    response.on('data', (chunk) => {
                        downloadedBytes += chunk.length;
                        if (onProgress && totalBytes > 0) {
                            onProgress(Math.round((downloadedBytes / totalBytes) * 100));
                        }
                    });

                    response.pipe(file);

                    file.on('finish', () => {
                        file.close();
                        resolve(modelPath);
                    });
                }).on('error', (err) => {
                    fs.unlink(modelPath, () => {}); // Clean up partial file
                    reject(err);
                });
            };

            download(MODEL_URL);
        });
    }

    /**
     * Check if local model is available
     * @returns {boolean}
     */
    static isAvailable() {
        const modelPath = path.join(getModelCacheDir(), DEFAULT_MODEL);
        return fs.existsSync(modelPath);
    }

    /**
     * Get the default model path
     * @returns {string}
     */
    static getModelPath() {
        return path.join(getModelCacheDir(), DEFAULT_MODEL);
    }
}

module.exports = LocalProvider;
