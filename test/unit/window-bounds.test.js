/**
 * Tests for window bounds clamping logic.
 *
 * The clampToVisibleArea() helper ensures windows stay within visible display
 * bounds, preventing off-screen positioning from stale config, multi-monitor
 * changes, or edge-case positioning.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

// clampToVisibleArea is a pure function that accepts a screenApi mock,
// so we can test it without Electron.
const { clampToVisibleArea } = require('../../electron/window/index');

/**
 * Create a mock screen API that returns a single display with the given workArea.
 */
function mockScreen(workArea) {
    return {
        getDisplayNearestPoint: () => ({ workArea })
    };
}

/**
 * Create a mock screen API with multiple displays.
 * Returns the display whose workArea center is nearest to the query point.
 */
function mockMultiScreen(displays) {
    return {
        getDisplayNearestPoint: (point) => {
            let best = displays[0];
            let bestDist = Infinity;
            for (const d of displays) {
                const cx = d.workArea.x + d.workArea.width / 2;
                const cy = d.workArea.y + d.workArea.height / 2;
                const dist = Math.hypot(point.x - cx, point.y - cy);
                if (dist < bestDist) {
                    bestDist = dist;
                    best = d;
                }
            }
            return best;
        }
    };
}

describe('clampToVisibleArea', () => {
    const primaryWorkArea = { x: 0, y: 0, width: 1920, height: 1080 };

    describe('window fully inside display', () => {
        it('should not move a window already inside the display', () => {
            const api = mockScreen(primaryWorkArea);
            const result = clampToVisibleArea(500, 300, 400, 500, api);
            assert.deepStrictEqual(result, { x: 500, y: 300 });
        });

        it('should not move an orb in the bottom-right corner', () => {
            const api = mockScreen(primaryWorkArea);
            const result = clampToVisibleArea(1836, 996, 64, 64, api);
            assert.deepStrictEqual(result, { x: 1836, y: 996 });
        });

        it('should not move a window at origin', () => {
            const api = mockScreen(primaryWorkArea);
            const result = clampToVisibleArea(0, 0, 400, 500, api);
            assert.deepStrictEqual(result, { x: 0, y: 0 });
        });
    });

    describe('window off-screen left/top (negative coordinates)', () => {
        it('should clamp a window far off-screen left', () => {
            const api = mockScreen(primaryWorkArea);
            const result = clampToVisibleArea(-500, 300, 400, 500, api);
            // Minimum x: wa.x - width + minVisible = 0 - 400 + 100 = -300
            assert.strictEqual(result.x, -300);
            assert.strictEqual(result.y, 300);
        });

        it('should clamp a window far off-screen top', () => {
            const api = mockScreen(primaryWorkArea);
            const result = clampToVisibleArea(500, -800, 400, 500, api);
            // Minimum y: wa.y - height + minVisible = 0 - 500 + 100 = -400
            assert.strictEqual(result.x, 500);
            assert.strictEqual(result.y, -400);
        });

        it('should clamp a window far off-screen top-left', () => {
            const api = mockScreen(primaryWorkArea);
            const result = clampToVisibleArea(-1000, -1000, 64, 64, api);
            // Minimum x: 0 - 64 + 64 = 0 (effectiveMinVisible = min(100, 64) = 64)
            // Minimum y: 0 - 64 + 64 = 0
            assert.strictEqual(result.x, 0);
            assert.strictEqual(result.y, 0);
        });
    });

    describe('window off-screen right/bottom', () => {
        it('should clamp a window off-screen right', () => {
            const api = mockScreen(primaryWorkArea);
            const result = clampToVisibleArea(2000, 300, 400, 500, api);
            // Maximum x: wa.x + wa.width - minVisible = 0 + 1920 - 100 = 1820
            assert.strictEqual(result.x, 1820);
            assert.strictEqual(result.y, 300);
        });

        it('should clamp a window off-screen bottom', () => {
            const api = mockScreen(primaryWorkArea);
            const result = clampToVisibleArea(500, 1200, 400, 500, api);
            // Maximum y: wa.y + wa.height - minVisible = 0 + 1080 - 100 = 980
            assert.strictEqual(result.x, 500);
            assert.strictEqual(result.y, 980);
        });

        it('should clamp an orb off-screen bottom-right', () => {
            const api = mockScreen(primaryWorkArea);
            const result = clampToVisibleArea(3000, 3000, 64, 64, api);
            // effectiveMinVisible = min(100, 64) = 64
            // Max x: 1920 - 64 = 1856, Max y: 1080 - 64 = 1016
            assert.strictEqual(result.x, 1856);
            assert.strictEqual(result.y, 1016);
        });
    });

    describe('stale config values (from disconnected monitor)', () => {
        it('should clamp orbX=-500 to visible area', () => {
            const api = mockScreen(primaryWorkArea);
            const result = clampToVisibleArea(-500, 500, 64, 64, api);
            // effectiveMinVisible = 64, min x = 0 - 64 + 64 = 0
            assert.strictEqual(result.x, 0);
        });

        it('should clamp position from a previously-connected 4K right monitor', () => {
            const api = mockScreen(primaryWorkArea);
            // Window was at x=2500 on a second monitor that's now gone
            const result = clampToVisibleArea(2500, 500, 400, 500, api);
            assert.strictEqual(result.x, 1820); // 1920 - 100
            assert.strictEqual(result.y, 500);
        });
    });

    describe('work area with offset (taskbar, etc.)', () => {
        it('should respect work area offset from top taskbar', () => {
            const api = mockScreen({ x: 0, y: 48, width: 1920, height: 1032 });
            const result = clampToVisibleArea(500, 20, 400, 500, api);
            // Min y: 48 - 500 + 100 = -352 ... 20 > -352 so y stays
            // But actually 20 is within the allowed range since part of window is visible
            assert.strictEqual(result.y, 20);
        });

        it('should respect work area offset from left dock', () => {
            const api = mockScreen({ x: 72, y: 0, width: 1848, height: 1080 });
            const result = clampToVisibleArea(10, 500, 400, 500, api);
            // Min x: 72 - 400 + 100 = -228, 10 > -228 so stays
            assert.strictEqual(result.x, 10);
        });
    });

    describe('multi-monitor scenarios', () => {
        const leftDisplay = { workArea: { x: 0, y: 0, width: 1920, height: 1080 } };
        const rightDisplay = { workArea: { x: 1920, y: 0, width: 2560, height: 1440 } };

        it('should clamp to left display when window center is on left display', () => {
            const api = mockMultiScreen([leftDisplay, rightDisplay]);
            const result = clampToVisibleArea(500, 300, 400, 500, api);
            assert.deepStrictEqual(result, { x: 500, y: 300 });
        });

        it('should clamp to right display when window center is on right display', () => {
            const api = mockMultiScreen([leftDisplay, rightDisplay]);
            const result = clampToVisibleArea(2500, 300, 400, 500, api);
            assert.deepStrictEqual(result, { x: 2500, y: 300 });
        });

        it('should use right display work area for expand positioning', () => {
            const api = mockMultiScreen([leftDisplay, rightDisplay]);
            // Simulate expand position on right display: waX + waWidth - panelWidth - 20
            const expandX = 1920 + 2560 - 400 - 20; // 4060
            const expandY = 1440 - 500 - 50; // 890
            const result = clampToVisibleArea(expandX, expandY, 400, 500, api);
            assert.strictEqual(result.x, 4060);
            assert.strictEqual(result.y, 890);
        });

        it('should clamp window that overflows right display', () => {
            const api = mockMultiScreen([leftDisplay, rightDisplay]);
            // Window near right edge of right display, overflowing
            const result = clampToVisibleArea(4500, 300, 400, 500, api);
            // Right display max x: 1920 + 2560 - 100 = 4380
            assert.strictEqual(result.x, 4380);
        });
    });

    describe('small window (minVisible capped to window size)', () => {
        it('should cap effectiveMinVisible to window width for tiny windows', () => {
            const api = mockScreen(primaryWorkArea);
            // 32px window: effectiveMinVisible = min(100, 32) = 32
            const result = clampToVisibleArea(2000, 2000, 32, 32, api);
            // Max x: 1920 - 32 = 1888, Max y: 1080 - 32 = 1048
            assert.strictEqual(result.x, 1888);
            assert.strictEqual(result.y, 1048);
        });
    });

    describe('default minVisible parameter', () => {
        it('should use 100px minVisible by default', () => {
            const api = mockScreen(primaryWorkArea);
            const result = clampToVisibleArea(2000, 300, 400, 500, api);
            // Max x: 1920 - 100 = 1820
            assert.strictEqual(result.x, 1820);
        });

        it('should respect custom minVisible', () => {
            const api = mockScreen(primaryWorkArea);
            const result = clampToVisibleArea(2000, 300, 400, 500, api, 200);
            // Max x: 1920 - 200 = 1720
            assert.strictEqual(result.x, 1720);
        });
    });

    describe('rounds coordinates to integers', () => {
        it('should round float coordinates', () => {
            const api = mockScreen(primaryWorkArea);
            const result = clampToVisibleArea(500.7, 300.3, 400, 500, api);
            assert.strictEqual(result.x, 501);
            assert.strictEqual(result.y, 300);
        });
    });
});
