/**
 * Voice Mirror CLI — Interactive setup wizard
 * Modeled after OpenClaw's onboarding flow using @clack/prompts.
 */

import * as p from '@clack/prompts';
import chalk from 'chalk';
import { existsSync, mkdirSync, writeFileSync, readFileSync, unlinkSync } from 'fs';
import { execSync } from 'child_process';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { platform, homedir } from 'os';
import { emitBanner } from './banner.mjs';
import {
    detectPython,
    detectPlatform,
    detectOllama,
    detectClaudeCli,
    detectPythonVenv,
    detectWakeWordModel,
    detectTTSModel,
    detectMCPServerDeps,
    readExistingConfig,
    getConfigPath,
} from './checks.mjs';
import {
    RECOMMENDED_MODELS,
    EMBEDDING_MODEL,
    installOllama,
    ensureOllamaRunning,
    pullModel,
    pullEmbeddingModel,
    hasModel,
    verifyModel,
} from './ollama-setup.mjs';
import {
    createVenv,
    installRequirements,
    installChromium,
    installMCPDeps,
    detectFfmpeg,
    downloadTTSModels,
} from './python-setup.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_DIR = join(__dirname, '..');

function cancelled() {
    p.cancel('Setup cancelled.');
    process.exit(0);
}

function guard(value) {
    if (p.isCancel(value)) cancelled();
    return value;
}

/**
 * Run the interactive setup wizard.
 */
export async function runSetup(opts = {}) {
    const nonInteractive = opts.nonInteractive || false;

    emitBanner();
    p.intro(chalk.bold.magenta('Voice Mirror Setup'));

    // --- Check for existing config ---
    const configPath = getConfigPath();
    const existingConfig = readExistingConfig(configPath);

    if (existingConfig && !nonInteractive) {
        const provider = existingConfig.ai?.provider || 'claude';
        const model = existingConfig.ai?.model || '';
        const activation = existingConfig.voice?.activationMode || 'wakeWord';

        p.note(
            `Provider: ${provider}${model ? ` (${model})` : ''}\nActivation: ${activation}`,
            'Existing config detected'
        );

        const action = guard(await p.select({
            message: 'Config handling',
            options: [
                { value: 'keep', label: 'Use existing values', hint: 'Skip to health check' },
                { value: 'modify', label: 'Update values', hint: 'Modify settings' },
                { value: 'reset', label: 'Reset', hint: 'Start fresh' },
            ],
        }));

        if (action === 'keep') {
            // Skip to dependency check
            await runDependencySetup(existingConfig);
            printSummary(existingConfig);
            p.outro(chalk.green('Setup complete! Run: voice-mirror start'));
            return;
        }

        if (action === 'reset') {
            // Continue with fresh setup
        }
        // 'modify' falls through to the wizard
    }

    // --- Step 1b: User name ---
    const existingName = existingConfig?.user?.name;
    const userName = nonInteractive
        ? (opts.userName || existingName || 'User')
        : guard(await p.text({
            message: 'What should I call you?',
            placeholder: 'Your name or nickname',
            initialValue: existingName || '',
            validate: (v) => (!v || v.trim().length === 0) ? 'A name is required' : undefined,
        }));

    // --- Step 2: Platform detection ---
    const spin = p.spinner();
    spin.start('Checking system...');

    const plat = detectPlatform();
    const python = detectPython();
    const ollama = await detectOllama();
    const claudeCli = detectClaudeCli();

    const systemLines = [
        `OS: ${plat.os}/${plat.arch} (${plat.display})`,
        `Node.js: ${process.version}`,
        python ? `Python: ${python.version}` : chalk.red('Python 3 not found'),
        claudeCli ? 'Claude CLI: installed' : chalk.dim('Claude CLI: not installed'),
        ollama.installed
            ? (ollama.running ? `Ollama: running (${ollama.models.length} models)` : 'Ollama: installed, not running')
            : chalk.dim('Ollama: not installed'),
    ];
    spin.stop('System detected');
    p.note(systemLines.join('\n'), 'System');

    if (!python) {
        p.log.error('Python 3.9+ is required. Install it and run setup again.');
        p.outro(chalk.red('Setup incomplete.'));
        process.exit(1);
    }

    // --- Step 3: AI Provider selection ---
    const providerChoice = nonInteractive
        ? (opts.provider || 'claude')
        : guard(await p.select({
            message: 'AI Provider',
            options: [
                { value: 'claude', label: 'Claude Code (Recommended)', hint: 'Full terminal + MCP tools' },
                { value: 'ollama', label: 'Ollama', hint: 'Local models, no API key needed' },
                { value: 'openai', label: 'OpenAI', hint: 'GPT-4o, requires API key' },
                { value: 'other', label: 'Other', hint: 'Gemini, Groq, LM Studio, etc.' },
            ],
            initialValue: 'claude',
        }));

    let providerConfig = { provider: providerChoice };

    // Provider-specific setup
    if (providerChoice === 'claude' && !claudeCli) {
        const s = p.spinner();
        s.start('Installing Claude Code CLI...');
        try {
            execSync('npm install -g @anthropic-ai/claude-code', { stdio: 'pipe', timeout: 120000 });
            s.stop('Claude Code CLI installed');
        } catch {
            s.stop('Claude Code CLI install failed');
            p.log.warn('Install manually: npm install -g @anthropic-ai/claude-code');
        }
    }

    if (providerChoice === 'openai') {
        const apiKey = nonInteractive
            ? (opts.apiKey || '')
            : guard(await p.text({
                message: 'OpenAI API key',
                placeholder: 'sk-...',
                validate: (v) => v.length < 10 ? 'API key too short' : undefined,
            }));
        providerConfig.apiKey = apiKey;
    }

    if (providerChoice === 'other') {
        const otherProvider = guard(await p.select({
            message: 'Select provider',
            options: [
                { value: 'gemini', label: 'Gemini', hint: 'Google AI' },
                { value: 'groq', label: 'Groq', hint: 'Fast inference' },
                { value: 'grok', label: 'Grok', hint: 'xAI' },
                { value: 'mistral', label: 'Mistral' },
                { value: 'openrouter', label: 'OpenRouter', hint: 'Multi-model' },
                { value: 'deepseek', label: 'DeepSeek' },
                { value: 'lmstudio', label: 'LM Studio', hint: 'Local' },
                { value: 'jan', label: 'Jan', hint: 'Local' },
            ],
        }));
        providerConfig.provider = otherProvider;

        const cloudProviders = ['gemini', 'groq', 'grok', 'mistral', 'openrouter', 'deepseek'];
        if (cloudProviders.includes(otherProvider)) {
            const apiKey = guard(await p.text({
                message: `${otherProvider} API key`,
                validate: (v) => v.length < 5 ? 'API key too short' : undefined,
            }));
            providerConfig.apiKey = apiKey;
        }
    }

    // Ollama model selection if Ollama is primary
    let ollamaDir = opts.ollamaDir || undefined; // custom install dir — used for OLLAMA_MODELS env
    if (providerChoice === 'ollama') {
        if (!ollama.installed) {
            const installIt = nonInteractive || guard(await p.confirm({
                message: 'Ollama is not installed. Install it now?',
                initialValue: true,
            }));

            if (installIt) {
                if (!nonInteractive && platform() === 'win32') {
                    const baseDir = guard(await p.text({
                        message: 'Where should Ollama be installed? (an "Ollama" folder will be created)',
                        placeholder: 'C:\\Program Files',
                        defaultValue: '',
                    })) || undefined;
                    if (baseDir) ollamaDir = join(baseDir, 'Ollama');
                }
                const spin2 = p.spinner();
                spin2.start('Installing Ollama...');
                const ok = await installOllama({ update: (m) => spin2.message(m) }, ollamaDir);
                if (ok) {
                    spin2.stop('Ollama installed');
                } else {
                    spin2.stop(chalk.red('Ollama install failed'));
                    p.log.warn('Install manually from https://ollama.ai');
                }
            }
        }

        // Ensure running
        const spin3 = p.spinner();
        spin3.start('Checking Ollama...');
        await ensureOllamaRunning({ update: (m) => spin3.message(m) }, ollamaDir);
        spin3.stop('Ollama ready');

        // Model selection
        const ollamaStatus = await detectOllama();
        const existingModels = ollamaStatus.models || [];

        if (existingModels.length > 0 && !nonInteractive) {
            p.note(existingModels.join('\n'), 'Installed models');
        }

        const modelChoice = nonInteractive
            ? (opts.model || 'llama3.1:8b')
            : guard(await p.select({
                message: 'Choose a model',
                options: [
                    ...RECOMMENDED_MODELS,
                    { value: 'custom', label: 'Custom', hint: 'Enter model name' },
                ],
                initialValue: 'llama3.1:8b',
            }));

        let modelName = modelChoice;
        if (modelChoice === 'custom') {
            modelName = guard(await p.text({
                message: 'Model name (e.g. mistral:7b)',
            }));
        }

        providerConfig.model = modelName;

        // Pull if not already present
        const alreadyHas = await hasModel(modelName);
        if (!alreadyHas) {
            const spin4 = p.spinner();
            spin4.start(`Pulling ${modelName}...`);
            const ok = await pullModel(modelName, { update: (m) => spin4.message(m) }, ollamaDir);
            if (ok) {
                spin4.stop(`${modelName} ready`);
            } else {
                spin4.stop(chalk.red(`Failed to pull ${modelName}`));
            }
        } else {
            p.log.success(`${modelName} already installed`);
        }
    }

    // --- Step 3b: Local LLM recommendation (for non-Ollama providers) ---
    if (providerChoice !== 'ollama') {
        const installLocal = nonInteractive
            ? (!opts.skipOllama)
            : guard(await p.select({
                message: 'Install a local LLM? (Highly Recommended)',
                options: [
                    { value: 'recommended', label: 'Yes, install llama3.1:8b (Recommended)', hint: '4.9GB — 98% browser accuracy, works offline' },
                    { value: 'pick', label: 'Yes, but let me pick a model' },
                    { value: 'skip', label: 'Skip for now' },
                ],
                initialValue: 'recommended',
            }));

        if (installLocal !== 'skip') {
            // Ensure Ollama installed
            let ollamaReady = ollama.installed && ollama.running;

            if (!ollama.installed) {
                const doInstall = nonInteractive || guard(await p.confirm({
                    message: 'Ollama is not installed. Install it now?',
                    initialValue: true,
                }));

                if (doInstall) {
                    if (!ollamaDir && !nonInteractive && platform() === 'win32') {
                        const baseDir = guard(await p.text({
                            message: 'Where should Ollama be installed? (an "Ollama" folder will be created)',
                            placeholder: 'C:\\Program Files',
                            defaultValue: '',
                        })) || undefined;
                        if (baseDir) ollamaDir = join(baseDir, 'Ollama');
                    }
                    const spin5 = p.spinner();
                    spin5.start('Installing Ollama...');
                    const ok = await installOllama({ update: (m) => spin5.message(m) }, ollamaDir);
                    spin5.stop(ok ? 'Ollama installed' : chalk.red('Ollama install failed'));
                    if (ok) ollama.installed = true;
                }
            }

            if (ollama.installed && !ollamaReady) {
                const spin6 = p.spinner();
                spin6.start('Starting Ollama...');
                ollamaReady = await ensureOllamaRunning({ update: (m) => spin6.message(m) }, ollamaDir);
                spin6.stop(ollamaReady ? 'Ollama running' : chalk.red('Could not start Ollama'));
            }

            if (ollamaReady) {
                let modelName = 'llama3.1:8b';

                if (installLocal === 'pick') {
                    modelName = guard(await p.select({
                        message: 'Choose a local model',
                        options: [
                            ...RECOMMENDED_MODELS,
                            { value: 'custom', label: 'Custom', hint: 'Enter model name' },
                        ],
                        initialValue: 'llama3.1:8b',
                    }));

                    if (modelName === 'custom') {
                        modelName = guard(await p.text({ message: 'Model name' }));
                    }
                }

                providerConfig.localModel = modelName;

                const alreadyHas = await hasModel(modelName);
                if (!alreadyHas) {
                    const spin7 = p.spinner();
                    spin7.start(`Pulling ${modelName}...`);
                    const ok = await pullModel(modelName, { update: (m) => spin7.message(m) }, ollamaDir);
                    spin7.stop(ok ? `${modelName} ready` : chalk.red(`Failed to pull ${modelName}`));
                } else {
                    p.log.success(`${modelName} already installed`);
                }

                // Also pull embedding model
                const hasEmbed = await hasModel(EMBEDDING_MODEL);
                if (!hasEmbed) {
                    const spin8 = p.spinner();
                    spin8.start(`Pulling embedding model (${EMBEDDING_MODEL})...`);
                    const ok = await pullEmbeddingModel({ update: (m) => spin8.message(m) }, ollamaDir);
                    spin8.stop(ok ? 'Embedding model ready' : chalk.red('Failed to pull embedding model'));
                }
            }
        }
    }

    // --- Step 4: Voice setup ---
    const activationMode = nonInteractive
        ? 'wakeWord'
        : guard(await p.select({
            message: 'Voice activation mode',
            options: [
                { value: 'wakeWord', label: 'Wake Word (Recommended)', hint: 'Say "Hey Claude" to activate' },
                { value: 'pushToTalk', label: 'Push to Talk', hint: 'Hold key to speak' },
            ],
            initialValue: 'wakeWord',
        }));

    // --- Step 5: Python backend setup ---
    p.log.info('Setting up Python backend (this may take a moment)...');
    const spin9 = p.spinner();
    spin9.start('Creating Python virtual environment...');

    const venvResult = createVenv(PROJECT_DIR, { update: (m) => spin9.message(m) });
    if (!venvResult.ok) {
        spin9.stop(chalk.red('Python setup failed'));
        p.log.error(venvResult.error);
    } else {
        const pipResult = installRequirements(venvResult.binary, PROJECT_DIR, { update: (m) => spin9.message(m) });
        if (pipResult.ok) {
            spin9.stop('Python backend ready');

            // Download TTS models if missing
            if (!detectTTSModel(PROJECT_DIR)) {
                const spin9b = p.spinner();
                spin9b.start('Downloading TTS models...');
                const ttsResult = await downloadTTSModels(venvResult.binary, PROJECT_DIR, { update: (m) => spin9b.message(m) });
                spin9b.stop(ttsResult.ok ? 'TTS models ready' : chalk.yellow('TTS models download skipped (will auto-download on first run)'));
            }
        } else {
            spin9.stop(chalk.yellow('Python deps partially installed'));
            p.log.warn(pipResult.error);
        }
    }

    // --- Step 6: Optional features ---
    const features = nonInteractive
        ? []
        : guard(await p.multiselect({
            message: 'Optional features (Space to toggle, Enter to confirm)',
            options: [
                { value: 'browser', label: 'Browser automation', hint: 'Installs Chromium (~200MB)' },
                { value: 'voiceClone', label: 'Voice cloning', hint: 'Requires ffmpeg' },
                { value: 'n8n', label: 'n8n integration', hint: 'Requires running n8n instance' },
            ],
            required: false,
        }));

    if (features.includes('browser')) {
        const spin10 = p.spinner();
        spin10.start('Installing Chromium...');
        const result = installChromium(PROJECT_DIR, { update: (m) => spin10.message(m) });
        spin10.stop(result.ok ? 'Chromium installed' : chalk.yellow('Chromium install failed'));
    }

    if (features.includes('voiceClone') && !detectFfmpeg()) {
        p.log.warn('ffmpeg is required for voice cloning. Install it with your package manager:');
        p.log.warn('  Linux: sudo apt install ffmpeg');
        p.log.warn('  macOS: brew install ffmpeg');
    }

    // --- Step 7: MCP server setup ---
    if (!detectMCPServerDeps(PROJECT_DIR)) {
        const spin11 = p.spinner();
        spin11.start('Installing MCP server dependencies...');
        const result = installMCPDeps(PROJECT_DIR, { update: (m) => spin11.message(m) });
        spin11.stop(result.ok ? 'MCP server ready' : chalk.yellow('MCP server install failed'));
    }

    // --- Write config ---
    const config = buildConfig(providerConfig, activationMode, features, existingConfig, userName);
    writeConfig(config);

    // --- Desktop shortcut ---
    if (!nonInteractive) {
        const wantShortcut = guard(await p.confirm({
            message: 'Create a desktop shortcut?',
            initialValue: true,
        }));
        if (wantShortcut) {
            const result = createDesktopShortcut(PROJECT_DIR);
            if (result.ok) {
                p.log.success(`Desktop shortcut created → ${result.path}`);
            } else {
                p.log.warn(`Could not create desktop shortcut: ${result.error}`);
            }
        }
    }

    // --- Summary ---
    printSummary(config);
    p.outro(chalk.green('Setup complete! Run: voice-mirror start'));
}

/**
 * Run dependency setup only (for existing config).
 */
async function runDependencySetup(config) {
    const venv = detectPythonVenv(PROJECT_DIR);
    if (!venv.exists) {
        const spin = p.spinner();
        spin.start('Setting up Python backend...');
        const result = createVenv(PROJECT_DIR, { update: (m) => spin.message(m) });
        if (result.ok) {
            installRequirements(result.binary, PROJECT_DIR, { update: (m) => spin.message(m) });
        }
        spin.stop('Python ready');
    }

    if (!detectMCPServerDeps(PROJECT_DIR)) {
        const spin = p.spinner();
        spin.start('Installing MCP server dependencies...');
        installMCPDeps(PROJECT_DIR, { update: (m) => spin.message(m) });
        spin.stop('MCP server ready');
    }
}

/**
 * Locate the user's Desktop folder across platforms.
 * Handles OneDrive redirection (Windows), XDG (Linux), and standard paths.
 * @returns {string|null} Desktop path or null if not found
 */
export function findDesktopFolder() {
    const os = platform();
    const home = homedir();

    if (os === 'win32') {
        // 1. Try reading from Windows registry (canonical source)
        try {
            const regOutput = execSync(
                'reg query "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Shell Folders" /v Desktop',
                { stdio: ['pipe', 'pipe', 'pipe'], encoding: 'utf-8', timeout: 5000 }
            );
            const match = regOutput.match(/Desktop\s+REG_SZ\s+(.+)/);
            if (match) {
                const regDesktop = match[1].trim();
                if (existsSync(regDesktop)) return regDesktop;
            }
        } catch { /* registry read failed, try fallbacks */ }

        // 2. Fallback: check common locations
        const candidates = [
            join(home, 'Desktop'),
            join(home, 'OneDrive', 'Desktop'),
            join(home, 'OneDrive - Personal', 'Desktop'),
        ];
        for (const dir of candidates) {
            if (existsSync(dir)) return dir;
        }
        return null;
    }

    if (os === 'linux') {
        // 1. Check XDG_DESKTOP_DIR env var
        if (process.env.XDG_DESKTOP_DIR) {
            const xdg = process.env.XDG_DESKTOP_DIR.replace(/\$HOME/g, home);
            if (existsSync(xdg)) return xdg;
        }
        // 2. Parse ~/.config/user-dirs.dirs
        try {
            const userDirs = readFileSync(join(home, '.config', 'user-dirs.dirs'), 'utf-8');
            const match = userDirs.match(/XDG_DESKTOP_DIR="(.+)"/);
            if (match) {
                const xdg = match[1].replace(/\$HOME/g, home);
                if (existsSync(xdg)) return xdg;
            }
        } catch { /* file not found */ }
        // 3. Standard fallback
        const std = join(home, 'Desktop');
        if (existsSync(std)) return std;
        return null;
    }

    // macOS — always ~/Desktop
    const std = join(home, 'Desktop');
    if (existsSync(std)) return std;
    return null;
}

/**
 * Resolve the Node.js binary path for use in shortcuts.
 * @returns {string} Absolute path to node executable
 */
function resolveNodeBin() {
    // process.execPath is the absolute path to the running node binary
    // (e.g., /usr/local/bin/node, C:\Program Files\nodejs\node.exe)
    return process.execPath;
}

/**
 * Create a desktop shortcut for Voice Mirror.
 * Returns { ok: boolean, path?: string, error?: string }
 */
function createDesktopShortcut(projectDir) {
    const os = platform();
    const desktop = findDesktopFolder();

    if (!desktop) {
        return { ok: false, error: `Desktop folder not found (checked registry, OneDrive, ~/Desktop)` };
    }

    const nodeBin = resolveNodeBin();
    const launchScript = join(projectDir, 'scripts', 'launch.js');

    if (!existsSync(launchScript)) {
        return { ok: false, error: `Launch script not found: ${launchScript}` };
    }

    try {
        if (os === 'win32') {
            return createWindowsShortcut(desktop, projectDir, nodeBin, launchScript);
        }
        if (os === 'darwin') {
            return createMacShortcut(desktop, projectDir, nodeBin, launchScript);
        }
        if (os === 'linux') {
            return createLinuxShortcut(desktop, projectDir, nodeBin, launchScript);
        }
        return { ok: false, error: `Unsupported platform: ${os}` };
    } catch (err) {
        return { ok: false, error: err.message };
    }
}

/**
 * Windows: Create .lnk via VBScript (always available, no PowerShell needed).
 */
function createWindowsShortcut(desktop, projectDir, nodeBin, launchScript) {
    const lnkPath = join(desktop, 'Voice Mirror.lnk');
    const vbsLauncher = join(projectDir, 'scripts', 'launch-hidden.vbs');
    const icoPath = join(projectDir, 'assets', 'icon-256.ico');

    // Use wscript.exe + launch-hidden.vbs for silent startup
    const target = existsSync(vbsLauncher)
        ? 'C:\\Windows\\System32\\wscript.exe'
        : nodeBin;
    const args = existsSync(vbsLauncher)
        ? `"${vbsLauncher}"`
        : `"${launchScript}"`;

    // Build VBScript to create the .lnk (avoids PowerShell entirely)
    const tmpVbs = join(process.env.TEMP || process.env.TMP || homedir(), `vm-shortcut-${Date.now()}.vbs`);
    // VBScript uses "" to escape double quotes inside strings
    // VBScript treats backslashes literally — no escaping needed.
    // Only double-quotes need escaping (handled by vbsQuote).
    const vbsLines = [
        `Set shell = CreateObject("WScript.Shell")`,
        `Set lnk = shell.CreateShortcut(${vbsQuote(lnkPath)})`,
        `lnk.TargetPath = ${vbsQuote(target)}`,
        `lnk.Arguments = ${vbsQuote(args)}`,
        `lnk.WorkingDirectory = ${vbsQuote(projectDir)}`,
        `lnk.Description = "Voice Mirror - Voice-controlled AI agent overlay"`,
        existsSync(icoPath) ? `lnk.IconLocation = ${vbsQuote(icoPath + ',0')}` : '',
        `lnk.Save()`,
    ].filter(Boolean);

    writeFileSync(tmpVbs, vbsLines.join('\r\n'), 'utf-8');

    try {
        execSync(`cscript //nologo "${tmpVbs}"`, { stdio: 'pipe', timeout: 10000 });
    } finally {
        try { unlinkSync(tmpVbs); } catch { /* cleanup best-effort */ }
    }

    // Verify the shortcut was actually created
    if (!existsSync(lnkPath)) {
        return { ok: false, error: 'VBScript ran but .lnk file was not created' };
    }
    return { ok: true, path: lnkPath };
}

/** Escape a string for VBScript double-quoted context */
function vbsQuote(str) {
    // VBScript escapes " as "" inside double-quoted strings
    return `"${str.replace(/"/g, '""')}"`;
}

/**
 * macOS: Create a .command file using absolute node path.
 */
function createMacShortcut(desktop, projectDir, nodeBin, launchScript) {
    const cmdPath = join(desktop, 'Voice Mirror.command');

    // Use #!/bin/sh for maximum compatibility (macOS ships sh always)
    // Use absolute node path so we don't depend on PATH
    const script = [
        `#!/bin/sh`,
        `# Voice Mirror launcher — created by setup wizard`,
        `cd "${projectDir}" || exit 1`,
        `exec "${nodeBin}" "${launchScript}"`,
        '',
    ].join('\n');

    writeFileSync(cmdPath, script, { mode: 0o755 });

    // Remove macOS quarantine flag so Gatekeeper won't prompt
    try {
        execSync(`xattr -d com.apple.quarantine "${cmdPath}"`, { stdio: 'ignore' });
    } catch { /* no quarantine xattr, or xattr not available */ }

    if (!existsSync(cmdPath)) {
        return { ok: false, error: 'Failed to write .command file' };
    }
    return { ok: true, path: cmdPath };
}

/**
 * Linux: Create a .desktop file with absolute paths and XDG compliance.
 */
function createLinuxShortcut(desktop, projectDir, nodeBin, launchScript) {
    const desktopFilePath = join(desktop, 'voice-mirror.desktop');
    const iconPath = join(projectDir, 'assets', 'icon-256.png');

    const entry = [
        `[Desktop Entry]`,
        `Version=1.0`,
        `Type=Application`,
        `Name=Voice Mirror`,
        `Comment=Voice-controlled AI agent overlay`,
        `Exec="${nodeBin}" "${launchScript}"`,
        existsSync(iconPath) ? `Icon=${iconPath}` : '',
        `Terminal=false`,
        `Categories=Utility;AudioVideo;`,
        `Keywords=voice;AI;assistant;`,
        `StartupWMClass=voice-mirror-electron`,
        '',
    ].filter(Boolean).join('\n');

    writeFileSync(desktopFilePath, entry, { mode: 0o755 });

    // Mark as trusted so desktop environments don't show "untrusted" warning
    // GNOME (gio)
    try {
        execSync(`gio set "${desktopFilePath}" metadata::trusted true`, { stdio: 'ignore', timeout: 5000 });
    } catch { /* gio not available or not GNOME */ }

    // Also install to ~/.local/share/applications for app launcher integration
    const appsDir = join(homedir(), '.local', 'share', 'applications');
    try {
        if (!existsSync(appsDir)) mkdirSync(appsDir, { recursive: true });
        writeFileSync(join(appsDir, 'voice-mirror.desktop'), entry, { mode: 0o755 });
    } catch { /* best-effort for app launcher */ }

    if (!existsSync(desktopFilePath)) {
        return { ok: false, error: 'Failed to write .desktop file' };
    }
    return { ok: true, path: desktopFilePath };
}

/**
 * Build config object from wizard selections.
 */
function buildConfig(providerConfig, activationMode, features, existing, userName) {
    const config = existing ? { ...existing } : {};

    config.ai = config.ai || {};
    config.ai.provider = providerConfig.provider;
    if (providerConfig.model) config.ai.model = providerConfig.model;
    if (providerConfig.apiKey) config.ai.apiKey = providerConfig.apiKey;
    if (providerConfig.localModel) config.ai.localModel = providerConfig.localModel;

    config.voice = config.voice || {};

    config.behavior = config.behavior || {};
    config.behavior.activationMode = activationMode;

    config.features = config.features || {};
    if (features.includes('browser')) config.features.browser = true;
    if (features.includes('voiceClone')) config.features.voiceClone = true;
    if (features.includes('n8n')) config.features.n8n = true;

    config.user = config.user || {};
    config.user.name = userName || existing?.user?.name || 'User';

    config.system = config.system || {};
    config.system.firstLaunchDone = true;
    config.system.setupVersion = getVersion();

    return config;
}

function getVersion() {
    try {
        const pkg = JSON.parse(readFileSync(join(PROJECT_DIR, 'package.json'), 'utf8'));
        return pkg.version || '0.1.0';
    } catch {
        return '0.1.0';
    }
}

/**
 * Write config to disk.
 */
function writeConfig(config) {
    const configPath = getConfigPath();
    const configDir = dirname(configPath);
    mkdirSync(configDir, { recursive: true });
    writeFileSync(configPath, JSON.stringify(config, null, 2));
    p.log.success(`Config saved to ${configPath}`);
}

/**
 * Print setup summary.
 */
function printSummary(config) {
    const lines = [
        `Provider:     ${config.ai?.provider || 'claude'}`,
    ];

    if (config.ai?.model) lines.push(`Model:        ${config.ai.model}`);
    if (config.ai?.localModel) lines.push(`Local LLM:    ${config.ai.localModel} (Ollama)`);

    lines.push(`Voice:        ${formatActivation(config.behavior?.activationMode)}`);
    lines.push(`TTS:          Kokoro (local)`);

    const feats = [];
    if (config.features?.browser) feats.push('Browser');
    if (config.features?.voiceClone) feats.push('Voice Clone');
    if (config.features?.n8n) feats.push('n8n');
    feats.push('Memory'); // always on
    if (feats.length > 0) lines.push(`Features:     ${feats.join(', ')}`);

    p.note(lines.join('\n'), 'Summary');
}

function formatActivation(mode) {
    switch (mode) {
        case 'pushToTalk': return 'Push to Talk';
        default: return 'Wake Word (Hey Claude)';
    }
}
