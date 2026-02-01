/**
 * Voice Mirror Memory System - OpenAI Embedding Provider
 * Uses OpenAI's text-embedding-3-small model
 */

const https = require('https');
const http = require('http');
const { withRetry } = require('../utils');

const DEFAULT_MODEL = 'text-embedding-3-small';
const DEFAULT_DIMENSIONS = 1536;
const DEFAULT_BASE_URL = 'https://api.openai.com/v1';

class OpenAIProvider {
    constructor(options = {}) {
        this.id = 'openai';
        this.model = options.model || DEFAULT_MODEL;
        this.dimensions = DEFAULT_DIMENSIONS;
        this.apiKey = options.apiKey || process.env.OPENAI_API_KEY;
        this.baseUrl = options.baseUrl || DEFAULT_BASE_URL;
        this._initialized = false;
        this._batchFailures = 0;
        this._batchDisabled = false;
    }

    async init() {
        if (this._initialized) return;

        if (!this.apiKey) {
            throw new Error('OpenAI API key not found. Set OPENAI_API_KEY environment variable or pass apiKey option.');
        }

        // Validate by making a simple request (optional, skip for faster init)
        this._initialized = true;
    }

    /**
     * Embed a single text
     * @param {string} text
     * @returns {Promise<number[]>}
     */
    async embedQuery(text) {
        const results = await this.embedBatch([text]);
        return results[0];
    }

    /**
     * Embed multiple texts
     * @param {string[]} texts
     * @returns {Promise<number[][]>}
     */
    async embedBatch(texts) {
        if (texts.length === 0) return [];

        // Fall back to sequential if batch mode disabled
        if (this._batchDisabled) {
            const results = [];
            for (const text of texts) {
                results.push(await this.embedQuery(text));
            }
            return results;
        }

        try {
            const response = await withRetry(() => this._request('/embeddings', {
                model: this.model,
                input: texts
            }));

            const sorted = response.data.sort((a, b) => a.index - b.index);
            this._batchFailures = 0;
            return sorted.map(item => item.embedding);
        } catch (err) {
            this._batchFailures++;
            if (this._batchFailures >= 2) {
                this._batchDisabled = true;
                console.error('[OpenAI] Batch embedding disabled after 2 consecutive failures, falling back to sequential');
            }
            throw err;
        }
    }

    /**
     * Make HTTP request to OpenAI API
     * @param {string} endpoint
     * @param {Object} body
     * @returns {Promise<Object>}
     */
    async _request(endpoint, body) {
        return new Promise((resolve, reject) => {
            const url = new URL(endpoint, this.baseUrl);
            const isHttps = url.protocol === 'https:';
            const lib = isHttps ? https : http;

            const options = {
                hostname: url.hostname,
                port: url.port || (isHttps ? 443 : 80),
                path: url.pathname,
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.apiKey}`
                }
            };

            const req = lib.request(options, (res) => {
                let data = '';

                res.on('data', chunk => {
                    data += chunk;
                });

                res.on('end', () => {
                    try {
                        const parsed = JSON.parse(data);

                        if (res.statusCode >= 400) {
                            const error = parsed.error?.message || `HTTP ${res.statusCode}`;
                            reject(new Error(`OpenAI API error: ${error}`));
                            return;
                        }

                        resolve(parsed);
                    } catch (err) {
                        reject(new Error(`Failed to parse OpenAI response: ${err.message}`));
                    }
                });
            });

            req.on('error', err => {
                reject(new Error(`OpenAI request failed: ${err.message}`));
            });

            req.setTimeout(60000, () => {
                req.destroy();
                reject(new Error('OpenAI request timeout (60s)'));
            });

            req.write(JSON.stringify(body));
            req.end();
        });
    }
}

module.exports = OpenAIProvider;
