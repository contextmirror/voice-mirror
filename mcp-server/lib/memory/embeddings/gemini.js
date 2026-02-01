/**
 * Voice Mirror Memory System - Gemini Embedding Provider
 * Uses Google's gemini-embedding-001 model
 */

const https = require('https');
const { withRetry } = require('../utils');

const DEFAULT_MODEL = 'text-embedding-004';
const DEFAULT_DIMENSIONS = 768;
const DEFAULT_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';

class GeminiProvider {
    constructor(options = {}) {
        this.id = 'gemini';
        this.model = options.model || DEFAULT_MODEL;
        this.dimensions = DEFAULT_DIMENSIONS;
        this.apiKey = options.apiKey || process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY;
        this.baseUrl = options.baseUrl || DEFAULT_BASE_URL;
        this._initialized = false;
        this._batchFailures = 0;
        this._batchDisabled = false;
    }

    async init() {
        if (this._initialized) return;

        if (!this.apiKey) {
            throw new Error('Gemini API key not found. Set GOOGLE_API_KEY or GEMINI_API_KEY environment variable or pass apiKey option.');
        }

        this._initialized = true;
    }

    /**
     * Embed a single text
     * @param {string} text
     * @returns {Promise<number[]>}
     */
    async embedQuery(text) {
        const response = await withRetry(() => this._request(`/models/${this.model}:embedContent`, {
            content: {
                parts: [{ text }]
            },
            taskType: 'RETRIEVAL_QUERY'
        }));

        return response.embedding.values;
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
            const requests = texts.map(text => ({
                model: `models/${this.model}`,
                content: {
                    parts: [{ text }]
                },
                taskType: 'RETRIEVAL_DOCUMENT'
            }));

            const response = await withRetry(() => this._request(`/models/${this.model}:batchEmbedContents`, {
                requests
            }));

            this._batchFailures = 0;
            return response.embeddings.map(e => e.values);
        } catch (err) {
            this._batchFailures++;
            if (this._batchFailures >= 2) {
                this._batchDisabled = true;
                console.error('[Gemini] Batch embedding disabled after 2 consecutive failures, falling back to sequential');
            }
            throw err;
        }
    }

    /**
     * Make HTTP request to Gemini API
     * @param {string} endpoint
     * @param {Object} body
     * @returns {Promise<Object>}
     */
    async _request(endpoint, body) {
        return new Promise((resolve, reject) => {
            const url = new URL(endpoint, this.baseUrl);
            url.searchParams.set('key', this.apiKey);

            const options = {
                hostname: url.hostname,
                port: 443,
                path: `${url.pathname}${url.search}`,
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                }
            };

            const req = https.request(options, (res) => {
                let data = '';

                res.on('data', chunk => {
                    data += chunk;
                });

                res.on('end', () => {
                    try {
                        const parsed = JSON.parse(data);

                        if (res.statusCode >= 400) {
                            const error = parsed.error?.message || `HTTP ${res.statusCode}`;
                            reject(new Error(`Gemini API error: ${error}`));
                            return;
                        }

                        resolve(parsed);
                    } catch (err) {
                        reject(new Error(`Failed to parse Gemini response: ${err.message}`));
                    }
                });
            });

            req.on('error', err => {
                reject(new Error(`Gemini request failed: ${err.message}`));
            });

            req.setTimeout(60000, () => {
                req.destroy();
                reject(new Error('Gemini request timeout (60s)'));
            });

            req.write(JSON.stringify(body));
            req.end();
        });
    }
}

module.exports = GeminiProvider;
