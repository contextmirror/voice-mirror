/**
 * Voice Mirror Electron - Custom Font Manager
 *
 * Manages user-uploaded custom fonts (TTF, OTF, WOFF, WOFF2).
 * Stores font files in a `fonts/` subdirectory under the config directory
 * with a JSON manifest for metadata.
 */

const path = require('path');
const fs = require('fs');
const fsPromises = fs.promises;
const crypto = require('crypto');

// Magic bytes for font format validation
const FONT_SIGNATURES = {
    ttf: Buffer.from([0x00, 0x01, 0x00, 0x00]),
    otf: Buffer.from([0x4F, 0x54, 0x54, 0x4F]),   // "OTTO"
    woff: Buffer.from([0x77, 0x4F, 0x46, 0x46]),   // "wOFF"
    woff2: Buffer.from([0x77, 0x4F, 0x46, 0x32]),   // "wOF2"
};

const ALLOWED_EXTENSIONS = ['.ttf', '.otf', '.woff', '.woff2'];
const MAX_FONT_SIZE = 10 * 1024 * 1024; // 10 MB
const MAX_FONTS = 20;

let fontsDir = null;
let manifest = { version: 1, fonts: [] };

/**
 * Initialize the font manager.
 * @param {string} configDir - The app's config directory (from config.getConfigDir())
 */
function init(configDir) {
    fontsDir = path.join(configDir, 'fonts');
    if (!fs.existsSync(fontsDir)) {
        fs.mkdirSync(fontsDir, { recursive: true });
    }
    loadManifest();
}

/**
 * Load the font manifest from disk.
 */
function loadManifest() {
    const manifestPath = path.join(fontsDir, 'fonts.json');
    try {
        if (fs.existsSync(manifestPath)) {
            manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
        }
    } catch (error) {
        console.error('[FontManager] Error loading manifest:', error.message);
        manifest = { version: 1, fonts: [] };
    }
}

/**
 * Save the font manifest to disk (atomic write).
 */
async function saveManifest() {
    const manifestPath = path.join(fontsDir, 'fonts.json');
    const tempPath = manifestPath + '.tmp';

    try {
        const json = JSON.stringify(manifest, null, 2);
        await fsPromises.writeFile(tempPath, json, 'utf8');
        await fsPromises.rename(tempPath, manifestPath);
    } catch (error) {
        console.error('[FontManager] Error saving manifest:', error.message);
        try { await fsPromises.unlink(tempPath); } catch { /* ignore */ }
    }
}

/**
 * Validate a font file by extension, size, and magic bytes.
 * @param {string} filePath - Absolute path to the font file
 * @returns {{ valid: boolean, format?: string, error?: string }}
 */
function validateFontFile(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    if (!ALLOWED_EXTENSIONS.includes(ext)) {
        return { valid: false, error: `Unsupported format "${ext}". Allowed: ${ALLOWED_EXTENSIONS.join(', ')}` };
    }

    let stat;
    try {
        stat = fs.statSync(filePath);
    } catch {
        return { valid: false, error: 'File not found or inaccessible' };
    }

    if (stat.size > MAX_FONT_SIZE) {
        return { valid: false, error: `File too large (${(stat.size / 1024 / 1024).toFixed(1)} MB). Max: ${MAX_FONT_SIZE / 1024 / 1024} MB` };
    }

    // Read first 4 bytes to check magic bytes
    let header;
    try {
        const fd = fs.openSync(filePath, 'r');
        header = Buffer.alloc(4);
        fs.readSync(fd, header, 0, 4, 0);
        fs.closeSync(fd);
    } catch {
        return { valid: false, error: 'Could not read file header' };
    }

    for (const [format, signature] of Object.entries(FONT_SIGNATURES)) {
        if (header.compare(signature, 0, 4, 0, 4) === 0) {
            return { valid: true, format };
        }
    }

    return { valid: false, error: 'Invalid font file (magic bytes do not match any known font format)' };
}

/**
 * Derive a display name from a font filename.
 * Strips extension, converts camelCase/hyphens/underscores to spaces.
 * @param {string} filename - Original filename
 * @returns {string}
 */
function deriveDisplayName(filename) {
    let name = path.basename(filename, path.extname(filename));
    // Insert space before uppercase letters in camelCase (e.g. "OpenSans" -> "Open Sans")
    name = name.replace(/([a-z])([A-Z])/g, '$1 $2');
    // Replace hyphens and underscores with spaces
    name = name.replace(/[-_]+/g, ' ');
    // Collapse multiple spaces
    name = name.replace(/\s+/g, ' ').trim();
    return name;
}

/**
 * Sanitize a filename for safe filesystem storage.
 * @param {string} name - Name to sanitize
 * @returns {string}
 */
function sanitizeFileName(name) {
    return name.replace(/[^a-zA-Z0-9._-]/g, '_').toLowerCase();
}

/**
 * Add a custom font file.
 * @param {string} sourcePath - Absolute path to the source font file
 * @param {'ui'|'mono'} type - Font type category
 * @returns {Promise<{ success: boolean, font?: object, error?: string }>}
 */
async function addFont(sourcePath, type) {
    if (!fontsDir) {
        return { success: false, error: 'Font manager not initialized' };
    }

    if (manifest.fonts.length >= MAX_FONTS) {
        return { success: false, error: `Maximum of ${MAX_FONTS} custom fonts reached. Remove one first.` };
    }

    const validation = validateFontFile(sourcePath);
    if (!validation.valid) {
        return { success: false, error: validation.error };
    }

    const originalName = path.basename(sourcePath);
    const displayName = deriveDisplayName(originalName);
    const familyName = `VM Custom ${displayName}`;
    const id = crypto.randomBytes(4).toString('hex');
    const ext = path.extname(originalName).toLowerCase();
    const fileName = `${id}-${sanitizeFileName(path.basename(originalName, ext))}${ext}`;
    const destPath = path.join(fontsDir, fileName);

    try {
        await fsPromises.copyFile(sourcePath, destPath);
    } catch (error) {
        return { success: false, error: `Failed to copy font file: ${error.message}` };
    }

    const fontEntry = {
        id,
        fileName,
        originalName,
        familyName,
        displayName,
        format: validation.format,
        type,
        addedAt: new Date().toISOString()
    };

    manifest.fonts.push(fontEntry);
    await saveManifest();

    console.log(`[FontManager] Added font: ${displayName} (${id})`);
    return { success: true, font: fontEntry };
}

/**
 * Remove a custom font by ID.
 * @param {string} fontId - The font's 8-character hex ID
 * @returns {Promise<{ success: boolean, error?: string }>}
 */
async function removeFont(fontId) {
    if (!fontsDir) {
        return { success: false, error: 'Font manager not initialized' };
    }

    const index = manifest.fonts.findIndex(f => f.id === fontId);
    if (index === -1) {
        return { success: false, error: 'Font not found' };
    }

    const entry = manifest.fonts[index];

    // Delete the font file (best-effort)
    try {
        await fsPromises.unlink(path.join(fontsDir, entry.fileName));
    } catch { /* best-effort */ }

    manifest.fonts.splice(index, 1);
    await saveManifest();

    console.log(`[FontManager] Removed font: ${entry.displayName} (${fontId})`);
    return { success: true };
}

/**
 * List all custom fonts.
 * @returns {Array} Array of font entry objects
 */
function listFonts() {
    return manifest.fonts;
}

/**
 * Get the absolute file path for a font by ID.
 * @param {string} fontId - The font's 8-character hex ID
 * @returns {string|null} Absolute path or null if not found
 */
function getFontFilePath(fontId) {
    if (!fontsDir) return null;
    const entry = manifest.fonts.find(f => f.id === fontId);
    if (!entry) return null;
    return path.join(fontsDir, entry.fileName);
}

module.exports = {
    init,
    validateFontFile,
    addFont,
    removeFont,
    listFonts,
    getFontFilePath,
    // Exposed for testing
    ALLOWED_EXTENSIONS,
    MAX_FONT_SIZE,
    MAX_FONTS,
    FONT_SIGNATURES
};
