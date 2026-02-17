/**
 * Voice cloning handlers: clone_voice, clear_voice_clone, list_voice_clones
 */

const fs = require('fs');
const path = require('path');
const { HOME_DATA_DIR } = require('../paths');

const VOICES_DIR = path.join(HOME_DATA_DIR, 'voices');
const VOICE_CLONE_REQUEST_PATH = path.join(HOME_DATA_DIR, 'voice_clone_request.json');
const VOICE_CLONE_RESPONSE_PATH = path.join(HOME_DATA_DIR, 'voice_clone_response.json');

// Ensure voices directory exists
if (!fs.existsSync(VOICES_DIR)) {
    fs.mkdirSync(VOICES_DIR, { recursive: true });
}

/**
 * Watch for a response file using fs.watch with poll fallback
 * @param {string} responsePath - Path to the response file
 * @param {number} timeoutMs - Max wait time
 * @returns {Promise<{response: object|null, timedOut: boolean}>}
 */
function watchForResponse(responsePath, timeoutMs) {
    const dir = path.dirname(responsePath);
    const expectedFilename = path.basename(responsePath);

    return new Promise((resolve) => {
        let settled = false;
        let watcher = null;
        let fallbackInterval = null;
        let fallbackTimeout = null;

        function tryRead() {
            if (settled) return;
            if (fs.existsSync(responsePath)) {
                try {
                    const data = JSON.parse(fs.readFileSync(responsePath, 'utf-8'));
                    settled = true;
                    cleanup();
                    resolve({ response: data, timedOut: false });
                } catch {
                    // Partial write, wait for next event
                }
            }
        }

        function cleanup() {
            if (watcher) { try { watcher.close(); } catch {} watcher = null; }
            if (fallbackInterval) { clearInterval(fallbackInterval); fallbackInterval = null; }
            if (fallbackTimeout) { clearTimeout(fallbackTimeout); fallbackTimeout = null; }
        }

        try {
            watcher = fs.watch(dir, (event, filename) => {
                if (filename === expectedFilename) tryRead();
            });
            watcher.on('error', () => {});
        } catch {}

        fallbackInterval = setInterval(tryRead, 500);

        fallbackTimeout = setTimeout(() => {
            if (!settled) {
                settled = true;
                cleanup();
                resolve({ response: null, timedOut: true });
            }
        }, timeoutMs);

        tryRead();
    });
}

/**
 * Validate a URL to prevent SSRF attacks.
 * Only allows http/https schemes and blocks private/internal IP ranges.
 */
function validateAudioUrl(urlStr) {
    let parsed;
    try {
        parsed = new URL(urlStr);
    } catch {
        return 'Invalid URL format';
    }

    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        return `Unsupported URL scheme: ${parsed.protocol} (only http/https allowed)`;
    }

    const hostname = parsed.hostname.toLowerCase();

    // Block localhost and loopback
    if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1' || hostname === '[::1]') {
        return 'URLs pointing to localhost/loopback are not allowed';
    }

    // Block private IP ranges (10.x, 172.16-31.x, 192.168.x, 169.254.x)
    const ipv4Match = hostname.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
    if (ipv4Match) {
        const [, a, b] = ipv4Match.map(Number);
        if (a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254) || a === 0) {
            return 'URLs pointing to private/internal networks are not allowed';
        }
    }

    return null; // valid
}

/**
 * Validate an audio file path to prevent path traversal.
 * Resolved path must be within HOME_DATA_DIR or common user directories.
 */
function validateAudioPath(filePath) {
    const resolved = path.resolve(filePath);

    // Allow paths within HOME_DATA_DIR (app data) or user's home directory
    const homeDir = require('os').homedir();
    const allowedRoots = [
        path.resolve(HOME_DATA_DIR),
        path.resolve(homeDir)
    ];

    const withinAllowed = allowedRoots.some(root => resolved.startsWith(root + path.sep) || resolved === root);
    if (!withinAllowed) {
        return `Path not allowed: must be within user home directory or app data directory`;
    }

    return null; // valid
}

/**
 * Validate voice name to prevent path traversal in constructed file paths.
 */
function validateVoiceName(name) {
    if (!name || typeof name !== 'string') return 'voice_name is required';
    if (/[\/\\:*?"<>|]/.test(name) || name.includes('..')) {
        return 'voice_name contains invalid characters';
    }
    if (name.length > 64) return 'voice_name too long (max 64 characters)';
    return null; // valid
}

/**
 * clone_voice - Clone a voice from audio sample
 * Uses file-based IPC to communicate with Python voice agent
 */
async function handleCloneVoice(args) {
    const { execFileSync } = require('child_process');

    try {
        const audioUrl = args?.audio_url;
        const audioPath = args?.audio_path;
        const voiceName = args?.voice_name || 'custom';
        const transcript = args?.transcript;

        if (!audioUrl && !audioPath) {
            return {
                content: [{ type: 'text', text: 'Error: Either audio_url or audio_path is required' }],
                isError: true
            };
        }

        // Validate voice_name to prevent path traversal in constructed file paths
        const nameErr = validateVoiceName(voiceName);
        if (nameErr) {
            return { content: [{ type: 'text', text: `Error: ${nameErr}` }], isError: true };
        }

        // Validate URL to prevent SSRF
        if (audioUrl) {
            const urlErr = validateAudioUrl(audioUrl);
            if (urlErr) {
                return { content: [{ type: 'text', text: `Error: ${urlErr}` }], isError: true };
            }
        }

        // Validate file path to prevent path traversal
        if (audioPath) {
            const pathErr = validateAudioPath(audioPath);
            if (pathErr) {
                return { content: [{ type: 'text', text: `Error: ${pathErr}` }], isError: true };
            }
        }

        let sourceAudioPath = audioPath;
        let downloadedFile = null;

        // Download audio if URL provided
        if (audioUrl) {
            console.error(`[clone_voice] Downloading audio from: ${audioUrl}`);
            const downloadPath = path.join(VOICES_DIR, `download_${Date.now()}.tmp`);

            try {
                // Try yt-dlp first (handles YouTube, SoundCloud, etc.)
                const mediaDomains = ['youtube.com', 'youtu.be', 'soundcloud.com', 'vimeo.com'];
                const urlHostname = new URL(audioUrl).hostname;
                const isMediaSite = mediaDomains.some(d => urlHostname === d || urlHostname.endsWith('.' + d));
                if (isMediaSite) {
                    execFileSync('yt-dlp', [
                        '-x', '--audio-format', 'wav',
                        '-o', `${downloadPath}.%(ext)s`,
                        audioUrl
                    ], { encoding: 'utf-8', timeout: 60000 });
                    // Find the downloaded file
                    const files = fs.readdirSync(VOICES_DIR).filter(f => f.startsWith(`download_${downloadPath.split('_').pop()}`));
                    if (files.length > 0) {
                        sourceAudioPath = path.join(VOICES_DIR, files[0]);
                        downloadedFile = sourceAudioPath;
                    }
                } else {
                    // Use HTTPS for external downloads to prevent cleartext transmission
                    if (!audioUrl.startsWith('https')) {
                        throw new Error('HTTPS required for audio downloads from external URLs');
                    }
                    // Try curl first (fast, follows redirects), fall back to Node.js https
                    try {
                        execFileSync('curl', ['-L', '-o', downloadPath, audioUrl], { timeout: 30000 });
                    } catch {
                        const https = require('https');
                        await new Promise((resolve, reject) => {
                            const follow = (url) => {
                                https.get(url, (res) => {
                                    if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                                        // Only follow HTTPS redirects
                                        if (!res.headers.location.startsWith('https')) {
                                            return reject(new Error('Redirect to non-HTTPS URL not allowed'));
                                        }
                                        follow(res.headers.location);
                                        return;
                                    }
                                    res.pipe(fs.createWriteStream(downloadPath)).on('finish', resolve).on('error', reject);
                                }).on('error', reject);
                            };
                            follow(audioUrl);
                        });
                    }
                    sourceAudioPath = downloadPath;
                    downloadedFile = downloadPath;
                }
            } catch (dlErr) {
                return {
                    content: [{ type: 'text', text: `Failed to download audio: ${dlErr.message}` }],
                    isError: true
                };
            }
        }

        // Verify source file exists
        if (!fs.existsSync(sourceAudioPath)) {
            return {
                content: [{ type: 'text', text: `Audio file not found: ${sourceAudioPath}` }],
                isError: true
            };
        }

        // Process audio: convert to WAV 16kHz mono, trim to 3 seconds
        const processedPath = path.join(VOICES_DIR, `${voiceName}_processed.wav`);
        console.error(`[clone_voice] Processing audio to: ${processedPath}`);

        try {
            execFileSync('ffmpeg', [
                '-y', '-i', sourceAudioPath,
                '-ar', '16000', '-ac', '1', '-t', '5',
                '-af', 'silenceremove=1:0:-50dB,loudnorm',
                processedPath
            ], { encoding: 'utf-8', timeout: 30000 });
        } catch (ffmpegErr) {
            if (downloadedFile && fs.existsSync(downloadedFile)) {
                fs.unlinkSync(downloadedFile);
            }
            return {
                content: [{ type: 'text', text: `Failed to process audio with ffmpeg: ${ffmpegErr.message}` }],
                isError: true
            };
        }

        // Clean up downloaded file (keep processed file)
        if (downloadedFile && fs.existsSync(downloadedFile) && downloadedFile !== processedPath) {
            fs.unlinkSync(downloadedFile);
        }

        // Delete old response file if exists
        if (fs.existsSync(VOICE_CLONE_RESPONSE_PATH)) {
            fs.unlinkSync(VOICE_CLONE_RESPONSE_PATH);
        }

        // Write request for Python voice agent
        const request = {
            action: 'clone',
            audio_path: processedPath,
            voice_name: voiceName,
            transcript: transcript || null,
            timestamp: new Date().toISOString()
        };
        fs.writeFileSync(VOICE_CLONE_REQUEST_PATH, JSON.stringify(request, null, 2), 'utf-8');
        console.error(`[clone_voice] Request written, waiting for Python response...`);

        // Wait for Python response (up to 60 seconds) using fs.watch + poll fallback
        const cloneResult = await watchForResponse(VOICE_CLONE_RESPONSE_PATH, 60000);

        if (cloneResult.timedOut) {
            return {
                content: [{
                    type: 'text',
                    text: 'Voice cloning request timed out. Is the Python voice agent running with Qwen3-TTS?'
                }],
                isError: true
            };
        }

        const response = cloneResult.response;
        if (response.success) {
            const voiceMetaPath = path.join(VOICES_DIR, `${voiceName}.json`);
            fs.writeFileSync(voiceMetaPath, JSON.stringify({
                name: voiceName,
                audio_path: processedPath,
                transcript: response.transcript || transcript,
                created_at: new Date().toISOString()
            }, null, 2), 'utf-8');

            return {
                content: [{
                    type: 'text',
                    text: `Voice "${voiceName}" cloned successfully!\n` +
                          `Audio: ${processedPath}\n` +
                          `Transcript: "${response.transcript || transcript}"\n\n` +
                          `The TTS will now use this voice. Try speaking to hear it!`
                }]
            };
        } else {
            return {
                content: [{ type: 'text', text: `Voice cloning failed: ${response.error}` }],
                isError: true
            };
        }

    } catch (err) {
        return {
            content: [{ type: 'text', text: `Error: ${err.message}` }],
            isError: true
        };
    }
}

/**
 * clear_voice_clone - Clear current voice clone
 */
async function handleClearVoiceClone(args) {
    try {
        if (fs.existsSync(VOICE_CLONE_RESPONSE_PATH)) {
            fs.unlinkSync(VOICE_CLONE_RESPONSE_PATH);
        }

        const request = {
            action: 'clear',
            timestamp: new Date().toISOString()
        };
        fs.writeFileSync(VOICE_CLONE_REQUEST_PATH, JSON.stringify(request, null, 2), 'utf-8');

        const clearResult = await watchForResponse(VOICE_CLONE_RESPONSE_PATH, 5000);

        if (!clearResult.timedOut && clearResult.response?.success) {
            return {
                content: [{
                    type: 'text',
                    text: 'Voice clone cleared. TTS will now use the default preset voice.'
                }]
            };
        }

        return {
            content: [{
                type: 'text',
                text: 'Voice clone clear request sent. The preset voice will be used for the next response.'
            }]
        };
    } catch (err) {
        return {
            content: [{ type: 'text', text: `Error: ${err.message}` }],
            isError: true
        };
    }
}

/**
 * list_voice_clones - List saved voice clones
 */
async function handleListVoiceClones(args) {
    try {
        if (!fs.existsSync(VOICES_DIR)) {
            return {
                content: [{ type: 'text', text: 'No voice clones saved yet.' }]
            };
        }

        const voiceFiles = fs.readdirSync(VOICES_DIR).filter(f => f.endsWith('.json'));

        if (voiceFiles.length === 0) {
            return {
                content: [{ type: 'text', text: 'No voice clones saved yet.' }]
            };
        }

        const voices = voiceFiles.map(f => {
            try {
                const meta = JSON.parse(fs.readFileSync(path.join(VOICES_DIR, f), 'utf-8'));
                return `- ${meta.name}: "${meta.transcript?.slice(0, 50) || 'No transcript'}..." (created: ${meta.created_at})`;
            } catch {
                return `- ${f.replace('.json', '')}: (metadata unavailable)`;
            }
        });

        return {
            content: [{
                type: 'text',
                text: `=== Saved Voice Clones ===\n\n${voices.join('\n')}`
            }]
        };
    } catch (err) {
        return {
            content: [{ type: 'text', text: `Error: ${err.message}` }],
            isError: true
        };
    }
}

module.exports = {
    handleCloneVoice,
    handleClearVoiceClone,
    handleListVoiceClones
};
