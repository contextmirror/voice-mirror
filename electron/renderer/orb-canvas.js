/**
 * orb-canvas.js — Canvas orb renderer, direct port of wayland-orb/src/renderer.rs.
 *
 * Renders a 64×64 orb with radial gradient, state-based color shifts,
 * human silhouette (recording) and robot icon (speaking), anti-aliased edges.
 * Uses ImageData for per-pixel rendering matching the Rust implementation.
 */

import { getAmplitudeHistory } from './chat-input.js';
import { onOrbColorsChanged } from './theme-engine.js';

// --- State enum ---
const OrbState = Object.freeze({
    Idle: 'idle',
    Recording: 'recording',
    Speaking: 'speaking',
    Thinking: 'thinking',
    Dictating: 'dictating',
});

// --- Module state ---
let canvas = null;
let ctx = null;
let animFrame = null;
let currentState = OrbState.Idle;
let phaseStart = performance.now();
let currentOrbColors = null;  // Set by theme-engine via setOrbColors()

// Animation durations per state (ms)
const DURATIONS = {
    [OrbState.Idle]: 1500,
    [OrbState.Recording]: 500,
    [OrbState.Speaking]: 1000,
    [OrbState.Thinking]: 2000,
    [OrbState.Dictating]: 800,
};

// --- Math helpers ---
const TAU = Math.PI * 2;

function lerp(a, b, t) {
    return Math.round(a * (1 - t) + b * t);
}

function clamp(v, min, max) {
    return v < min ? min : v > max ? max : v;
}

function roundedRectSDF(px, py, halfW, halfH, cornerR) {
    const qx = Math.abs(px) - halfW + cornerR;
    const qy = Math.abs(py) - halfH + cornerR;
    const outside = Math.sqrt(Math.max(0, qx) ** 2 + Math.max(0, qy) ** 2);
    const inside = Math.min(Math.max(qx, qy), 0);
    return outside + inside - cornerR;
}

// --- Color ---
function applyStateColor(r, g, b, alpha, state) {
    let rf = r / 255;
    let gf = g / 255;
    let bf = b / 255;

    switch (state) {
        case OrbState.Idle:
            break;
        case OrbState.Recording:
            rf = Math.min(rf * 1.3 + 0.1, 1);
            gf *= 0.7;
            break;
        case OrbState.Speaking:
            bf = Math.min(bf * 1.2 + 0.1, 1);
            gf = Math.min(gf * 1.1 + 0.05, 1);
            rf *= 0.8;
            break;
        case OrbState.Thinking:
            gf = Math.min(gf * 1.2 + 0.1, 1);
            bf = Math.min(bf * 1.1, 1);
            rf *= 0.6;
            break;
        case OrbState.Dictating:
            bf = Math.min(bf * 1.3 + 0.1, 1);
            gf = Math.min(gf * 1.1, 1);
            break;
    }
    return [rf, gf, bf, alpha];
}

// --- Blend (premultiplied alpha over) ---
function blendOver(data, offset, sr, sg, sb, sa) {
    const dr = data[offset];
    const dg = data[offset + 1];
    const db = data[offset + 2];
    const da = data[offset + 3];
    data[offset]     = Math.min(255, sr * sa * 255 + dr * (1 - sa)) | 0;
    data[offset + 1] = Math.min(255, sg * sa * 255 + dg * (1 - sa)) | 0;
    data[offset + 2] = Math.min(255, sb * sa * 255 + db * (1 - sa)) | 0;
    data[offset + 3] = Math.min(255, sa * 255 + da * (1 - sa)) | 0;
}

// --- Icon renderers ---
function drawHumanIcon(imageData, width, height, cx, cy, innerRadius, state, colors = null) {
    const data = imageData.data;
    const iconScale = innerRadius * 0.55;
    const headCy = cy - iconScale * 0.3;
    const headR = iconScale * 0.32;
    const bodyCy = cy + iconScale * 0.35;
    const bodyRx = iconScale * 0.55;
    const bodyRy = iconScale * 0.45;

    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const px = x + 0.5;
            const py = y + 0.5;
            const odx = px - cx, ody = py - cy;
            if (Math.sqrt(odx * odx + ody * ody) > innerRadius) continue;

            let iconAlpha = 0;

            // Head
            const hdx = px - cx, hdy = py - headCy;
            const hdist = Math.sqrt(hdx * hdx + hdy * hdy);
            if (hdist < headR + 0.5) {
                iconAlpha = hdist > headR - 0.5 ? 1 - (hdist - (headR - 0.5)) : 1;
            }

            // Shoulders
            if (py > headCy + headR * 0.5) {
                const sdx = (px - cx) / bodyRx;
                const sdy = (py - bodyCy) / bodyRy;
                const sdist = Math.sqrt(sdx * sdx + sdy * sdy);
                if (sdist < 1 + 0.5 / bodyRx && py < bodyCy + bodyRy * 0.15) {
                    const sa = sdist > 1 - 0.5 / bodyRx
                        ? 1 - (sdist - (1 - 0.5 / bodyRx)) * bodyRx
                        : 1;
                    iconAlpha = Math.max(iconAlpha, clamp(sa, 0, 1));
                }
            }

            if (iconAlpha > 0) {
                const offset = (y * width + x) * 4;
                const ic = colors ? colors.iconRgb : [220, 220, 240];
                const [ir, ig, ib] = applyStateColor(ic[0], ic[1], ic[2], 1, state);
                const a = iconAlpha * 0.85;
                blendOver(data, offset, ir, ig, ib, a);
            }
        }
    }
}

function drawRobotIcon(imageData, width, height, cx, cy, innerRadius, state, colors = null) {
    const data = imageData.data;
    const iconScale = innerRadius * 0.5;
    const headW = iconScale * 0.7;
    const headH = iconScale * 0.55;
    const headCy = cy + iconScale * 0.05;
    const headCornerR = iconScale * 0.1;

    const antennaX = cx;
    const antennaTop = headCy - headH - iconScale * 0.25;
    const antennaBottom = headCy - headH;
    const antennaW = iconScale * 0.06;
    const antennaBallR = iconScale * 0.1;

    const eyeY = headCy - headH * 0.15;
    const eyeSpacing = headW * 0.4;
    const eyeR = iconScale * 0.12;

    const bodyTop = headCy + headH + iconScale * 0.05;
    const bodyW = headW * 0.85;
    const bodyH = iconScale * 0.35;
    const bodyCornerR = iconScale * 0.06;

    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const px = x + 0.5;
            const py = y + 0.5;
            const odx = px - cx, ody = py - cy;
            if (Math.sqrt(odx * odx + ody * ody) > innerRadius) continue;

            let iconAlpha = 0;

            // Antenna stick
            if (Math.abs(px - antennaX) < antennaW && py >= antennaTop && py <= antennaBottom) {
                iconAlpha = 1;
            }

            // Antenna ball
            const adx = px - antennaX, ady = py - antennaTop;
            const adist = Math.sqrt(adx * adx + ady * ady);
            if (adist < antennaBallR + 0.5) {
                const aa = adist > antennaBallR - 0.5 ? 1 - (adist - (antennaBallR - 0.5)) : 1;
                iconAlpha = Math.max(iconAlpha, clamp(aa, 0, 1));
            }

            // Head (rounded rect)
            const inHead = roundedRectSDF(px - cx, py - headCy, headW, headH, headCornerR);
            if (inHead < 0.5) {
                const ha = inHead > -0.5 ? 0.5 - inHead : 1;
                iconAlpha = Math.max(iconAlpha, clamp(ha, 0, 1));
            }

            // Eyes
            let isEye = false;
            for (const ex of [cx - eyeSpacing, cx + eyeSpacing]) {
                const edx = px - ex, edy = py - eyeY;
                if (Math.sqrt(edx * edx + edy * edy) < eyeR + 0.5) {
                    isEye = true;
                }
            }

            // Body (rounded rect)
            const inBody = roundedRectSDF(px - cx, py - (bodyTop + bodyH), bodyW, bodyH, bodyCornerR);
            if (inBody < 0.5) {
                const ba = inBody > -0.5 ? 0.5 - inBody : 1;
                iconAlpha = Math.max(iconAlpha, clamp(ba, 0, 1));
            }

            if (iconAlpha > 0) {
                const offset = (y * width + x) * 4;
                if (isEye) {
                    const ec = colors ? colors.eyeRgb : [20, 15, 40];
                    const [ir, ig, ib] = applyStateColor(ec[0], ec[1], ec[2], 1, state);
                    blendOver(data, offset, ir, ig, ib, 0.9);
                } else {
                    const ic = colors ? colors.iconRgb : [220, 220, 240];
                    const [ir, ig, ib] = applyStateColor(ic[0], ic[1], ic[2], 1, state);
                    blendOver(data, offset, ir, ig, ib, iconAlpha * 0.85);
                }
            }
        }
    }
}

// --- Waveform bar renderer for dictation ---
function drawWaveformBars(imageData, width, height, cx, cy, innerRadius) {
    const data = imageData.data;
    const history = getAmplitudeHistory();
    if (!history || history.length === 0) return;

    const barCount = 7;
    const barWidth = 3;
    const barGap = 2;
    const totalWidth = barCount * barWidth + (barCount - 1) * barGap;
    const startX = Math.round(cx - totalWidth / 2);
    const maxBarHeight = Math.round(innerRadius * 1.4); // ~70% of diameter
    const minBarHeight = 4;

    // Sample evenly from amplitude history
    const step = Math.max(1, Math.floor(history.length / barCount));
    const offset = Math.max(0, history.length - step * barCount);

    for (let i = 0; i < barCount; i++) {
        const idx = offset + i * step;
        const amplitude = idx < history.length ? history[idx] : 0;
        const barHeight = Math.round(minBarHeight + amplitude * (maxBarHeight - minBarHeight));
        const bx = startX + i * (barWidth + barGap);
        const byTop = Math.round(cy - barHeight / 2);
        const byBottom = byTop + barHeight;

        for (let y = byTop; y < byBottom; y++) {
            if (y < 0 || y >= height) continue;
            for (let x = bx; x < bx + barWidth; x++) {
                if (x < 0 || x >= width) continue;
                // Only draw inside the orb circle
                const dx = x + 0.5 - cx, dy = y + 0.5 - cy;
                if (Math.sqrt(dx * dx + dy * dy) > innerRadius) continue;
                const off = (y * width + x) * 4;
                blendOver(data, off, 0.71, 0.86, 1.0, 0.85); // cyan/white (180, 220, 255)
            }
        }
    }
}

// --- Main orb render ---
function renderOrb(imageData, width, height, state, phase, colors = null) {
    const data = imageData.data;
    const cx = width / 2;
    const cy = height / 2;
    const maxRadius = Math.min(width, height) / 2 - 1;

    // Animation scale
    let scale;
    switch (state) {
        case OrbState.Idle:
            scale = 1 + 0.05 * Math.sin(phase * TAU);
            break;
        case OrbState.Recording:
            scale = 1 + 0.12 * Math.sin(phase * TAU);
            break;
        case OrbState.Speaking:
            scale = phase < 0.5
                ? 1 + 0.08 * Math.sin(phase * 2 * TAU)
                : 1 - 0.05 * Math.sin((phase - 0.5) * 2 * TAU);
            break;
        case OrbState.Thinking:
            scale = 1;
            break;
        case OrbState.Dictating:
            scale = 1 + 0.05 * Math.sin(phase * TAU);
            break;
        default:
            scale = 1;
    }

    const radius = maxRadius * clamp(scale, 0.5, 1);
    const borderRadius = radius;
    const innerRadius = radius - 2;

    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const px = x + 0.5;
            const py = y + 0.5;
            const dx = px - cx;
            const dy = py - cy;
            const dist = Math.sqrt(dx * dx + dy * dy);
            const offset = (y * width + x) * 4;

            if (dist > borderRadius + 0.5) {
                data[offset] = 0;
                data[offset + 1] = 0;
                data[offset + 2] = 0;
                data[offset + 3] = 0;
                continue;
            }

            const edgeAlpha = dist > borderRadius - 0.5
                ? 1 - (dist - (borderRadius - 0.5))
                : 1;

            let rf, gf, bf, af;

            if (dist > innerRadius) {
                // Border ring
                const borderAlpha = edgeAlpha * 0.5;
                const br = colors ? colors.borderRgb : [102, 126, 234];
                [rf, gf, bf, af] = applyStateColor(br[0], br[1], br[2], borderAlpha, state);
            } else {
                // Inner gradient
                const t = dist / innerRadius;
                const cc = colors ? colors.centerRgb : [0x2d, 0x1b, 0x4e];
                const ec = colors ? colors.edgeRgb : [0x0d, 0x0d, 0x1a];
                const rv = lerp(cc[0], ec[0], t);
                const gv = lerp(cc[1], ec[1], t);
                const bv = lerp(cc[2], ec[2], t);
                [rf, gf, bf, af] = applyStateColor(rv, gv, bv, edgeAlpha * 0.95, state);
            }

            // RGBA (Canvas ImageData is RGBA, not BGRA like Wayland SHM)
            data[offset]     = (rf * af * 255) | 0;
            data[offset + 1] = (gf * af * 255) | 0;
            data[offset + 2] = (bf * af * 255) | 0;
            data[offset + 3] = (af * 255) | 0;
        }
    }

    // Icons / overlays
    if (state === OrbState.Recording) {
        drawHumanIcon(imageData, width, height, cx, cy, innerRadius, state, colors);
    } else if (state === OrbState.Speaking) {
        drawRobotIcon(imageData, width, height, cx, cy, innerRadius, state, colors);
    } else if (state === OrbState.Dictating) {
        drawWaveformBars(imageData, width, height, cx, cy, innerRadius);
    }
}

// --- Animation loop ---
function tick() {
    if (!ctx || !canvas) return;

    const now = performance.now();
    const duration = DURATIONS[currentState] || 1500;
    const phase = ((now - phaseStart) % duration) / duration;

    const w = canvas.width;
    const h = canvas.height;
    const imageData = ctx.createImageData(w, h);
    renderOrb(imageData, w, h, currentState, phase, currentOrbColors);
    ctx.putImageData(imageData, 0, 0);

    animFrame = requestAnimationFrame(tick);
}

// --- Public API ---

/**
 * Initialize the canvas orb renderer.
 * @param {HTMLCanvasElement} canvasEl - The canvas element to render into
 */
export function initOrbCanvas(canvasEl) {
    canvas = canvasEl;
    ctx = canvas.getContext('2d');
    phaseStart = performance.now();
    animFrame = requestAnimationFrame(tick);
}

/**
 * Set the orb visual state.
 * @param {string} state - One of 'idle', 'recording', 'speaking', 'thinking'
 */
export function setOrbState(state) {
    if (state === currentState) return;
    currentState = state;
    phaseStart = performance.now();
}

export { renderOrb, DURATIONS };

// Wire theme-engine callback at module level
onOrbColorsChanged((colors) => { currentOrbColors = colors; });
