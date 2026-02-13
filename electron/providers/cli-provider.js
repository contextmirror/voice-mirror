/**
 * CLI Provider - Generic provider for CLI-based AI tools (Codex, Gemini CLI)
 *
 * Uses cli-spawner.js for PTY management. Does not support MCP.
 */

const { BaseProvider } = require('./base-provider');
const { createCLISpawner, isCLIAvailable, CLI_CONFIGS } = require('../cli-spawner');

class CLIProvider extends BaseProvider {
    constructor(cliType, config = {}) {
        super(config);
        this.cliType = cliType;
        this.spawner = createCLISpawner(cliType);
        this._ready = false;
    }

    getDisplayName() {
        return this.spawner.config.displayName;
    }

    static isAvailable(cliType) {
        const cfg = CLI_CONFIGS[cliType];
        if (!cfg) return false;
        return isCLIAvailable(cfg.command);
    }

    supportsVision() {
        return false;
    }

    isReady() {
        return this._ready;
    }

    async spawn(options = {}) {
        const { cols = 120, rows = 30 } = options;

        if (this.running) {
            return true;
        }

        const cliType = this.cliType;
        if (!CLIProvider.isAvailable(cliType)) {
            const name = this.spawner.config.displayName;
            this.emitOutput('stderr', `[Error] ${name} CLI not found. Ensure "${this.spawner.config.command}" is installed and on your PATH.\n`);
            return false;
        }

        return new Promise((resolve) => {
            const pty = this.spawner.spawn({
                onOutput: (data) => {
                    this.emitOutput('stdout', data);
                },
                onExit: (code) => {
                    this.running = false;
                    this._ready = false;
                    this.emitExit(code);
                },
                cols,
                rows
            });

            if (pty) {
                this.running = true;
                this.emitOutput('start', `${this.getDisplayName()} started\n`);
                resolve(true);
            } else {
                resolve(false);
            }
        });
    }

    async stop() {
        this.spawner.stop();
        this.running = false;
        this._ready = false;
    }

    async sendInput(text) {
        this.spawner.sendInput(text);
    }

    sendRawInput(data) {
        this.spawner.sendRawInput(data);
    }

    resize(cols, rows) {
        this.spawner.resize(cols, rows);
    }

    async sendInputWhenReady(text, timeout = 15000) {
        const result = await this.spawner.sendInputWhenReady(text, timeout);
        if (result) this._ready = true;
        return result;
    }
}

module.exports = { CLIProvider };
