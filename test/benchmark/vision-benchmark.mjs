/**
 * Vision Benchmark — Evaluate Qwen3-VL (or any Ollama vision model) on desktop screenshots.
 *
 * Usage:
 *   node test/benchmark/vision-benchmark.mjs                    # capture desktop + run
 *   node test/benchmark/vision-benchmark.mjs --skip-capture     # use existing images only
 *   node test/benchmark/vision-benchmark.mjs --model gemma3:12b # test a different model
 */

import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from 'fs';
import { join, basename } from 'path';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const IMAGES_DIR = join(__dirname, 'images');
const RESULTS_DIR = join(__dirname, 'results');

// ── CLI args ───────────────────────────────────────────────────────
const args = process.argv.slice(2);
const MODEL = args.find(a => a.startsWith('--model='))?.split('=')[1]
    || (args.includes('--model') ? args[args.indexOf('--model') + 1] : null)
    || 'qwen3-vl:8b';
const SKIP_CAPTURE = args.includes('--skip-capture');
const ONLY_PROMPTS = args.find(a => a.startsWith('--only='))?.split('=')[1]?.split(',') || null;
const OLLAMA_URL = process.env.OLLAMA_URL || 'http://127.0.0.1:11434';

// ── Prompts (Voice Mirror relevant) ────────────────────────────────
const PROMPTS = [
    {
        id: 'describe',
        label: 'Describe Screen',
        prompt: 'What applications and windows are visible on this screen? Describe the layout briefly.',
    },
    {
        id: 'read-text',
        label: 'Read Text',
        prompt: 'Read all visible text on this screen. List it line by line.',
    },
    {
        id: 'identify-ui',
        label: 'Identify UI Elements',
        prompt: 'List all clickable buttons, menus, input fields, and interactive elements you can see. Include their approximate position (top-left, center, bottom-right, etc.).',
    },
    {
        id: 'identify-ui-nothink',
        label: 'Identify UI (no_think)',
        prompt: '/no_think List all clickable buttons, menus, input fields, and interactive elements you can see. Include their approximate position (top-left, center, bottom-right, etc.).',
    },
    {
        id: 'tool-call',
        label: 'Tool Calling',
        prompt: 'The user says "click the search bar" or "open the main menu". Identify the most likely target element on screen, describe where it is, and what action to take.',
    },
];

// ── Helpers ─────────────────────────────────────────────────────────

function ensureDirs() {
    for (const dir of [IMAGES_DIR, RESULTS_DIR]) {
        if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    }
}

/** Capture current desktop via PowerShell + GDI+ (Windows only) */
function captureDesktop() {
    if (process.platform !== 'win32') {
        console.log('  Desktop capture only supported on Windows, skipping.');
        return null;
    }

    const outPath = join(IMAGES_DIR, `desktop-${Date.now()}.png`);
    const script = `
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$screens = [System.Windows.Forms.Screen]::AllScreens
$s = $screens[0]
$bmp = New-Object System.Drawing.Bitmap($s.Bounds.Width, $s.Bounds.Height)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($s.Bounds.Location, [System.Drawing.Point]::Empty, $s.Bounds.Size)
$bmp.Save('${outPath.replace(/\\/g, '\\\\')}', [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose()
$bmp.Dispose()
Write-Output "$($s.Bounds.Width)x$($s.Bounds.Height)"
`;

    try {
        const out = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
            timeout: 10000, windowsHide: true, encoding: 'utf-8',
        }).trim();
        console.log(`  Captured desktop: ${basename(outPath)} (${out})`);
        return outPath;
    } catch (err) {
        console.error(`  Desktop capture failed: ${err.message}`);
        return null;
    }
}

/** Query Ollama vision model */
async function queryVision(imagePath, prompt) {
    const imageBase64 = readFileSync(imagePath).toString('base64');

    const noThink = prompt.startsWith('/no_think');
    const cleanPrompt = noThink ? prompt.replace('/no_think ', '') : prompt;

    const messages = [];
    if (noThink) {
        messages.push({ role: 'system', content: '/no_think' });
    }
    messages.push({ role: 'user', content: cleanPrompt, images: [imageBase64] });

    const body = {
        model: MODEL,
        messages,
        stream: false,
        think: false,
        options: {
            temperature: 0.1,
            num_predict: 16384,
        },
    };

    const start = performance.now();
    const res = await fetch(`${OLLAMA_URL}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });

    if (!res.ok) {
        const text = await res.text();
        throw new Error(`Ollama ${res.status}: ${text}`);
    }

    const data = await res.json();
    const elapsed = ((performance.now() - start) / 1000).toFixed(1);

    return {
        response: data.message?.content || '(no response)',
        elapsed_s: elapsed,
        eval_count: data.eval_count || 0,
        prompt_eval_count: data.prompt_eval_count || 0,
    };
}

/** Check Ollama is running and model is available */
async function preflight() {
    try {
        const res = await fetch(`${OLLAMA_URL}/api/tags`);
        const data = await res.json();
        const models = data.models?.map(m => m.name) || [];
        if (!models.some(m => m.startsWith(MODEL.split(':')[0]))) {
            console.error(`Model "${MODEL}" not found. Available: ${models.join(', ')}`);
            console.error(`Run: ollama pull ${MODEL}`);
            process.exit(1);
        }
    } catch {
        console.error(`Cannot reach Ollama at ${OLLAMA_URL}. Is it running?`);
        process.exit(1);
    }
}

// ── Main ────────────────────────────────────────────────────────────

async function main() {
    console.log(`\n  Vision Benchmark — ${MODEL}\n`);
    ensureDirs();
    await preflight();

    // Step 1: Gather images
    if (!SKIP_CAPTURE) {
        console.log('  Capturing desktop...');
        captureDesktop();
    }

    const images = readdirSync(IMAGES_DIR)
        .filter(f => /\.(png|jpg|jpeg|webp|bmp)$/i.test(f))
        .map(f => join(IMAGES_DIR, f));

    if (images.length === 0) {
        console.error('  No images found. Place screenshots in test/benchmark/images/ or run without --skip-capture');
        process.exit(1);
    }

    console.log(`  Found ${images.length} image(s)\n`);

    // Step 2: Run prompts against each image
    const allResults = [];
    let reportMd = `# Vision Benchmark Results — ${MODEL}\n`;
    reportMd += `Date: ${new Date().toISOString().split('T')[0]}\n\n`;

    for (const imagePath of images) {
        const name = basename(imagePath);
        console.log(`  === ${name} ===`);
        reportMd += `---\n## ${name}\n\n`;

        const imageResults = { image: name, prompts: [] };

        const activePrompts = ONLY_PROMPTS ? PROMPTS.filter(p => ONLY_PROMPTS.includes(p.id)) : PROMPTS;
        for (const p of activePrompts) {
            process.stdout.write(`    ${p.label}... `);
            try {
                const result = await queryVision(imagePath, p.prompt);
                console.log(`${result.elapsed_s}s (${result.eval_count} tokens)`);

                reportMd += `### ${p.label} (${result.elapsed_s}s, ${result.eval_count} tok)\n`;
                reportMd += `**Prompt:** ${p.prompt}\n\n`;
                reportMd += `**Response:**\n${result.response}\n\n`;

                imageResults.prompts.push({
                    id: p.id,
                    label: p.label,
                    prompt: p.prompt,
                    ...result,
                });
            } catch (err) {
                console.log(`FAILED: ${err.message}`);
                reportMd += `### ${p.label} — FAILED\n${err.message}\n\n`;
                imageResults.prompts.push({ id: p.id, error: err.message });
            }
        }

        allResults.push(imageResults);
        console.log('');
    }

    // Step 3: Write results
    const jsonPath = join(RESULTS_DIR, 'results.json');
    const mdPath = join(RESULTS_DIR, 'report.md');
    writeFileSync(jsonPath, JSON.stringify({ model: MODEL, date: new Date().toISOString(), results: allResults }, null, 2));
    writeFileSync(mdPath, reportMd);

    console.log(`  Results saved:`);
    console.log(`    ${mdPath}`);
    console.log(`    ${jsonPath}\n`);
}

main().catch(err => {
    console.error('Fatal:', err);
    process.exit(1);
});
