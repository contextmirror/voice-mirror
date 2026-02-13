/**
 * Base Provider - Abstract base class for AI providers
 *
 * All provider implementations should extend this class.
 * Provides common interface for spawning, stopping, and communicating with AI services.
 */

const { EventEmitter } = require('events');

class BaseProvider extends EventEmitter {
    constructor(config = {}) {
        super();
        this.config = config;
        this.running = false;
        this.model = null;
    }

    /**
     * Get display name for UI
     * @returns {string} Human-readable name (e.g., 'Claude Code', 'Ollama (llama3.2)')
     */
    getDisplayName() {
        throw new Error('getDisplayName() must be implemented by subclass');
    }

    /**
     * Check if provider is currently running
     * @returns {boolean}
     */
    isRunning() {
        return this.running;
    }

    /**
     * Start the provider
     * @param {Object} options - Startup options
     * @returns {Promise<boolean>} Success status
     */
    async spawn(options = {}) {
        throw new Error('spawn() must be implemented by subclass');
    }

    /**
     * Stop the provider
     * @returns {Promise<void>}
     */
    async stop() {
        throw new Error('stop() must be implemented by subclass');
    }

    /**
     * Send input/message to the provider
     * @param {string} text - Message text
     * @returns {Promise<void>}
     */
    async sendInput(text) {
        throw new Error('sendInput() must be implemented by subclass');
    }

    /**
     * Send raw input (for terminal passthrough)
     * @param {string} data - Raw data to send
     */
    sendRawInput(data) {
        throw new Error('sendRawInput() must be implemented by subclass');
    }

    /**
     * Resize terminal (if applicable)
     * @param {number} cols - Column count
     * @param {number} rows - Row count
     */
    resize(cols, rows) {
        // Optional - only PTY-based providers need this
    }

    /**
     * Emit output event
     * @param {string} type - Event type ('stdout', 'stderr', 'start', 'exit')
     * @param {string} text - Output text
     */
    emitOutput(type, text) {
        this.emit('output', { type, text });
    }

    /**
     * Emit exit event
     * @param {number} code - Exit code
     */
    emitExit(code) {
        this.running = false;
        this.emit('exit', code);
    }

    /**
     * Check if provider supports vision/images
     * @returns {boolean}
     */
    supportsVision() {
        return false;
    }

}

module.exports = { BaseProvider };
