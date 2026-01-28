/**
 * Wayland Orb service for Voice Mirror Electron.
 * Spawns and manages the native Rust wayland-orb binary that renders
 * a layer-shell overlay orb on Wayland compositors (COSMIC, Sway, etc.).
 */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const readline = require('readline');

/**
 * Create a Wayland Orb service instance.
 * @param {Object} options
 * @param {Function} options.onExpandRequested - Called when user clicks the orb
 * @param {Function} options.onPositionChanged - Called when orb position changes
 * @param {Function} [options.onReady] - Called when orb binary is ready
 * @param {Function} [options.onExit] - Called when orb binary exits
 * @returns {Object} Wayland orb service
 */
function createWaylandOrb(options = {}) {
    const { onExpandRequested, onPositionChanged, onReady, onExit } = options;

    let proc = null;
    let ready = false;
    let outputListCallback = null;
    let currentOutputName = null;
    let intentionalRestart = false;

    /**
     * Find the wayland-orb binary path.
     * Checks release build first, then debug.
     * @returns {string|null} Path to binary or null
     */
    function findBinary() {
        const base = path.join(__dirname, '..', '..', 'wayland-orb', 'target');
        const release = path.join(base, 'release', 'wayland-orb');
        const debug = path.join(base, 'debug', 'wayland-orb');

        if (fs.existsSync(release)) return release;
        if (fs.existsSync(debug)) return debug;
        return null;
    }

    /**
     * Send a JSON message to the Rust binary via stdin.
     * @param {Object} msg - Message object
     */
    function send(msg) {
        if (proc && proc.stdin && !proc.stdin.destroyed) {
            proc.stdin.write(JSON.stringify(msg) + '\n');
        }
    }

    /**
     * Start the wayland-orb binary.
     * @param {string} [outputName] - Optional output/monitor name (e.g. 'DP-1')
     * @returns {boolean} True if started successfully
     */
    function start(outputName) {
        const binPath = findBinary();
        if (!binPath) {
            console.log('[WaylandOrb] Binary not found, skipping');
            return false;
        }

        // Only start on Wayland
        if (!process.env.WAYLAND_DISPLAY) {
            console.log('[WaylandOrb] Not running on Wayland, skipping');
            return false;
        }

        // Use provided output name or the last known one
        if (outputName !== undefined) {
            currentOutputName = outputName;
        }

        const args = [];
        if (currentOutputName) {
            args.push('--output', currentOutputName);
        }

        try {
            proc = spawn(binPath, args, {
                stdio: ['pipe', 'pipe', 'pipe'],
                env: { ...process.env }
            });

            // Parse JSON lines from stdout
            const rl = readline.createInterface({ input: proc.stdout });
            rl.on('line', (line) => {
                try {
                    const msg = JSON.parse(line);
                    handleMessage(msg);
                } catch (e) {
                    console.log('[WaylandOrb] Invalid JSON:', line);
                }
            });

            proc.stderr.on('data', (data) => {
                console.log('[WaylandOrb]', data.toString().trim());
            });

            proc.on('close', (code) => {
                console.log('[WaylandOrb] Exited with code', code);
                proc = null;
                ready = false;
                if (intentionalRestart) {
                    intentionalRestart = false;
                    console.log('[WaylandOrb] Restarting on output:', currentOutputName || 'default');
                    start();
                } else {
                    if (onExit) onExit(code);
                }
            });

            proc.on('error', (err) => {
                console.log('[WaylandOrb] Spawn error:', err.message);
                proc = null;
                ready = false;
            });

            console.log('[WaylandOrb] Started:', binPath);
            return true;
        } catch (e) {
            console.log('[WaylandOrb] Failed to start:', e.message);
            return false;
        }
    }

    /**
     * Handle a message from the Rust binary.
     * @param {Object} msg
     */
    function handleMessage(msg) {
        switch (msg.type) {
            case 'Ready':
                ready = true;
                console.log('[WaylandOrb] Ready');
                if (onReady) onReady();
                break;
            case 'ExpandRequested':
                if (onExpandRequested) onExpandRequested();
                break;
            case 'PositionChanged':
                if (onPositionChanged) onPositionChanged(msg.x, msg.y);
                break;
            case 'OutputList':
                if (outputListCallback) {
                    outputListCallback(msg.outputs || []);
                    outputListCallback = null;
                }
                break;
            case 'Error':
                console.log('[WaylandOrb] Error:', msg.message);
                break;
        }
    }

    /**
     * Stop the wayland-orb binary.
     */
    function stop() {
        if (proc) {
            const procToKill = proc;
            send({ type: 'Quit' });
            // Give it a moment to exit gracefully, then force-kill
            // Important: capture the specific process ref to avoid killing a restarted process
            setTimeout(() => {
                if (procToKill && !procToKill.killed) {
                    try { procToKill.kill('SIGTERM'); } catch (_) {}
                }
            }, 500);
        }
        ready = false;
    }

    /**
     * Set the orb visual state.
     * @param {string} state - One of: Idle, Recording, Speaking, Thinking
     */
    function setState(state) {
        send({ type: 'SetState', state });
    }

    /** Show the orb. */
    function show() { send({ type: 'Show' }); }

    /** Hide the orb. */
    function hide() { send({ type: 'Hide' }); }

    /**
     * Set orb size.
     * @param {number} size - Size in pixels
     */
    function setSize(size) { send({ type: 'SetSize', size }); }

    /**
     * Move orb to a specific output/monitor by restarting on that output.
     * @param {string} name - Output name (e.g. 'DP-1', 'HDMI-A-1')
     */
    function setOutput(name) {
        console.log('[WaylandOrb] Switching to output:', name);
        currentOutputName = name || null;
        if (proc) {
            intentionalRestart = true;
            stop();
        } else {
            start();
        }
    }

    /**
     * Request the list of available outputs from the Rust binary.
     * Returns a promise that resolves with the output list.
     * @returns {Promise<Array>}
     */
    function listOutputs() {
        return new Promise((resolve) => {
            // Store a one-shot listener
            outputListCallback = resolve;
            send({ type: 'ListOutputs' });
            // Timeout after 2s
            setTimeout(() => {
                if (outputListCallback === resolve) {
                    outputListCallback = null;
                    resolve([]);
                }
            }, 2000);
        });
    }

    /**
     * Check if the orb binary is running and ready.
     * @returns {boolean}
     */
    function isReady() { return ready; }

    /**
     * Check if a wayland-orb binary is available.
     * @returns {boolean}
     */
    function isAvailable() { return findBinary() !== null && !!process.env.WAYLAND_DISPLAY; }

    return {
        start,
        stop,
        setState,
        show,
        hide,
        setSize,
        setOutput,
        listOutputs,
        isReady,
        isAvailable
    };
}

module.exports = { createWaylandOrb };
