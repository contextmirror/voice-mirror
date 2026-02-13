const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

// Mock electron modules before requiring the watcher
// We need to test the display selection logic in isolation

describe('screen-capture display selection', () => {
    // Simulate the display selection logic from screen-capture-watcher.js
    function selectSource(sources, displays, primaryDisplay, requestedDisplay) {
        let source;

        if (requestedDisplay === 'all' && sources.length > 1) {
            source = sources.find(s => s.display_id === String(primaryDisplay.id)) || sources[0];
        } else {
            const displayIndex = parseInt(requestedDisplay, 10) || 0;

            if (sources.length === 1) {
                source = sources[0];
            } else {
                const targetDisplay = displays[displayIndex] || displays[0];
                source = sources.find(s => s.display_id === String(targetDisplay.id));
                if (!source) {
                    source = sources[displayIndex] || sources[0];
                }
            }
        }

        return source;
    }

    const mockDisplays = [
        { id: 12345, bounds: { x: 0, y: 0, width: 1920, height: 1080 }, size: { width: 1920, height: 1080 } },
        { id: 67890, bounds: { x: 1920, y: 0, width: 2560, height: 1440 }, size: { width: 2560, height: 1440 } },
    ];
    const mockPrimary = mockDisplays[0];

    const mockSources = [
        { name: 'Screen 1', display_id: '12345', thumbnail: { toDataURL: () => 'data:image/png;base64,abc' } },
        { name: 'Screen 2', display_id: '67890', thumbnail: { toDataURL: () => 'data:image/png;base64,def' } },
    ];

    it('selects display 0 by default when no display specified', () => {
        const source = selectSource(mockSources, mockDisplays, mockPrimary, undefined);
        assert.strictEqual(source.display_id, '12345');
    });

    it('selects display 0 when display=0', () => {
        const source = selectSource(mockSources, mockDisplays, mockPrimary, 0);
        assert.strictEqual(source.display_id, '12345');
    });

    it('selects display 1 when display=1', () => {
        const source = selectSource(mockSources, mockDisplays, mockPrimary, 1);
        assert.strictEqual(source.display_id, '67890');
    });

    it('falls back to display 0 for out-of-range index', () => {
        const source = selectSource(mockSources, mockDisplays, mockPrimary, 5);
        assert.strictEqual(source.display_id, '12345');
    });

    it('returns only source when only one source available regardless of index', () => {
        const singleSource = [mockSources[0]];
        const source = selectSource(singleSource, mockDisplays, mockPrimary, 1);
        assert.strictEqual(source.display_id, '12345');
    });

    it('selects primary display for display="all"', () => {
        const source = selectSource(mockSources, mockDisplays, mockPrimary, 'all');
        assert.strictEqual(source.display_id, '12345');
    });

    it('matches source by display_id not array index', () => {
        // Reverse source order - display_id matching should still work
        const reversedSources = [mockSources[1], mockSources[0]];
        const source = selectSource(reversedSources, mockDisplays, mockPrimary, 0);
        assert.strictEqual(source.display_id, '12345', 'Should match by display id, not array position');
    });

    it('falls back to array index when display_id does not match', () => {
        const unmatchedSources = [
            { name: 'Screen A', display_id: '99999', thumbnail: {} },
            { name: 'Screen B', display_id: '88888', thumbnail: {} },
        ];
        const source = selectSource(unmatchedSources, mockDisplays, mockPrimary, 1);
        assert.strictEqual(source.name, 'Screen B');
    });
});

describe('screen-capture MCP handler display passthrough', () => {
    it('passes display value through without coercing falsy values to 0', () => {
        // Simulating the fixed logic: args?.display != null ? args.display : 0
        function getDisplay(args) {
            return args?.display != null ? args.display : 0;
        }

        assert.strictEqual(getDisplay({}), 0);
        assert.strictEqual(getDisplay({ display: 1 }), 1);
        assert.strictEqual(getDisplay({ display: 0 }), 0);
        assert.strictEqual(getDisplay({ display: 'all' }), 'all');
        assert.strictEqual(getDisplay(undefined), 0);
    });
});
