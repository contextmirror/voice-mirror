/**
 * Claude Provider - Claude Code CLI integration
 *
 * Wraps the existing claude-spawner.js for the provider abstraction layer.
 * Spawns a real interactive Claude Code terminal using node-pty.
 */

const { BaseProvider } = require('./base-provider');
const claudeSpawner = require('../claude-spawner');

class ClaudeProvider extends BaseProvider {
    constructor(config = {}) {
        super(config);
        this.ready = false;
    }

    getType() {
        return 'claude';
    }

    getDisplayName() {
        return 'Claude Code';
    }

    /**
     * Check if Claude CLI is available on the system
     */
    static isAvailable() {
        return claudeSpawner.isClaudeAvailable();
    }

    /**
     * Configure MCP server for Claude with tool profile from config
     */
    configureMCP(appConfig) {
        claudeSpawner.configureMCPServer(appConfig);
    }

    isPTY() {
        return true;
    }

    supportsMCP() {
        return true;
    }

    supportsVision() {
        return true;
    }

    isReady() {
        return this.ready;
    }

    /**
     * Spawn Claude Code in a PTY terminal
     */
    async spawn(options = {}) {
        const { cols = 120, rows = 30 } = options;

        if (this.running) {
            console.log('[ClaudeProvider] Already running');
            return true;
        }

        // Check if Claude is available
        if (!ClaudeProvider.isAvailable()) {
            this.emitOutput('stderr', '[Error] Claude CLI not found. Install with: npm install -g @anthropic-ai/claude-code\n');
            return false;
        }

        return new Promise((resolve) => {
            const pty = claudeSpawner.spawnClaude({
                onOutput: (data) => {
                    this.emitOutput('stdout', data);
                },
                onExit: (code) => {
                    this.running = false;
                    this.ready = false;
                    this.emitExit(code);
                },
                cols,
                rows
            });

            if (pty) {
                this.running = true;
                this.emitOutput('start', 'Claude Code started\n');
                resolve(true);
            } else {
                resolve(false);
            }
        });
    }

    /**
     * Stop Claude Code
     */
    async stop() {
        claudeSpawner.stopClaude();
        this.running = false;
        this.ready = false;
    }

    /**
     * Send a complete message to Claude
     */
    async sendInput(text) {
        claudeSpawner.sendInput(text);
    }

    /**
     * Send raw input (keyboard passthrough from terminal)
     */
    sendRawInput(data) {
        claudeSpawner.sendRawInput(data);
    }

    /**
     * Resize PTY
     */
    resize(cols, rows) {
        claudeSpawner.resizePty(cols, rows);
    }

    /**
     * Send input when Claude TUI is ready
     */
    async sendInputWhenReady(text, timeout = 15000) {
        const result = await claudeSpawner.sendInputWhenReady(text, timeout);
        if (result) {
            this.ready = true;
        }
        return result;
    }

    /**
     * Write a response to the inbox (for fallback use)
     */
    writeResponseToInbox(message) {
        return claudeSpawner.writeResponseToInbox(message);
    }

    /**
     * Get the voice mode system prompt
     */
    static getVoiceSystemPrompt() {
        return claudeSpawner.VOICE_CLAUDE_SYSTEM;
    }
}

module.exports = { ClaudeProvider };
