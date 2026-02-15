#!/usr/bin/env node

/**
 * Voice Mirror CLI
 * Interactive setup, health checks, and app launcher.
 *
 * Usage:
 *   voice-mirror setup     Interactive onboarding wizard
 *   voice-mirror start     Launch Voice Mirror
 *   voice-mirror doctor    Check system health
 */

import { Command } from 'commander';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf8'));

const program = new Command();

program
    .name('voice-mirror')
    .description('Voice-controlled AI agent overlay for your entire computer')
    .version(pkg.version || '0.1.0');

program
    .command('setup')
    .description('Interactive onboarding wizard')
    .option('--non-interactive', 'Run without prompts (use defaults)')
    .option('--provider <provider>', 'AI provider (claude, ollama, openai, etc.)')
    .option('--model <model>', 'Model name for Ollama')
    .option('--api-key <key>', 'API key for cloud providers')
    .option('--skip-ollama', 'Skip local LLM setup')
    .option('--ollama-dir <dir>', 'Custom Ollama install directory')
    .action(async (opts) => {
        const { runSetup } = await import('./setup.mjs');
        await runSetup({
            nonInteractive: opts.nonInteractive,
            provider: opts.provider,
            model: opts.model,
            apiKey: opts.apiKey,
            skipOllama: opts.skipOllama,
            ollamaDir: opts.ollamaDir,
        });
    });

program
    .command('doctor')
    .description('Check system health and dependencies')
    .action(async () => {
        const { runDoctor } = await import('./doctor.mjs');
        const issues = await runDoctor();
        process.exit(issues > 0 ? 1 : 0);
    });

program
    .command('uninstall')
    .description('Remove Voice Mirror from your system')
    .option('--keep-config', 'Preserve configuration files for future reinstall')
    .option('--non-interactive', 'Skip prompts (remove everything except config)')
    .action(async (opts) => {
        const { runUninstall } = await import('./uninstall.mjs');
        await runUninstall({
            keepConfig: opts.keepConfig,
            nonInteractive: opts.nonInteractive,
        });
    });

program
    .command('start')
    .description('Launch Voice Mirror')
    .option('--dev', 'Development mode')
    .action(async (opts) => {
        const { execSync } = await import('child_process');
        const projectDir = join(__dirname, '..');
        const args = ['start'];
        if (opts.dev) args.push('-- --dev');

        try {
            execSync(`npm ${args.join(' ')}`, {
                stdio: 'inherit',
                cwd: projectDir,
            });
        } catch (err) {
            process.exit(err.status || 1);
        }
    });

// Default to setup if no command given
program
    .action(async () => {
        const { runSetup } = await import('./setup.mjs');
        await runSetup();
    });

program.parse();
