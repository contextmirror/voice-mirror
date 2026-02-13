/**
 * Tests for terminal resize improvements.
 *
 * Verifies:
 * 1. ResizeObserver debounce is 150ms (not 50ms) to avoid intermediate-width renders
 * 2. CSS transition is dynamic (.transitioning class) — not always-on
 * 3. Post-resize term.refresh() is called to clean up stale line artifacts
 * 4. minimizeTerminal() adds/removes .transitioning class
 * 5. Terminal canvas is hidden during resize to prevent intermediate repaints (CPU savings)
 * 6. PTY resize is deduplicated — only sent when cols/rows actually change (prevents CLI redraw spam)
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const terminalSource = fs.readFileSync(
    path.join(__dirname, '../../electron/js/terminal.js'), 'utf-8'
);
const terminalCss = fs.readFileSync(
    path.join(__dirname, '../../electron/styles/terminal.css'), 'utf-8'
);

describe('Terminal resize debounce', () => {
    it('ResizeObserver debounce should be 300ms', () => {
        // The setTimeout in the ResizeObserver callback should use 300ms
        assert.ok(
            terminalSource.includes('}, 300);'),
            'ResizeObserver debounce should be 300ms (found }, 300;)'
        );
    });

    it('should NOT have the old 50ms main debounce on ResizeObserver', () => {
        // Ensure the main resize debounce is not 50ms (the old value).
        // Note: 50ms may appear inside the observer for the post-resize visibility
        // delay, which is fine — we only check the main setTimeout debounce.
        const resizeObserverBlock = terminalSource.match(
            /new ResizeObserver\(\(\) => \{[\s\S]*?\}\);[\s]*resizeObserver\.observe/
        );
        assert.ok(resizeObserverBlock, 'Should find ResizeObserver block');
        assert.ok(
            !resizeObserverBlock[0].includes('}, 50);  //'),
            'ResizeObserver main debounce should not be 50ms'
        );
        // Verify the main debounce comment mentions 300ms
        assert.ok(
            resizeObserverBlock[0].includes('300ms'),
            'ResizeObserver should reference 300ms debounce'
        );
    });
});

describe('Post-resize refresh', () => {
    it('should call term.refresh() after fitAddon.fit() in ResizeObserver', () => {
        // After fit(), we should refresh visible rows to clean up stale artifacts
        const resizeObserverBlock = terminalSource.match(
            /new ResizeObserver\(\(\) => \{[\s\S]*?\}\);[\s]*resizeObserver\.observe/
        );
        assert.ok(resizeObserverBlock, 'Should find ResizeObserver block');
        assert.ok(
            resizeObserverBlock[0].includes('term.refresh(0, term.rows - 1)'),
            'ResizeObserver should call term.refresh() after fit'
        );
    });

    it('term.refresh() should appear AFTER safeFit() in ResizeObserver', () => {
        const resizeObserverBlock = terminalSource.match(
            /new ResizeObserver\(\(\) => \{[\s\S]*?\}\);[\s]*resizeObserver\.observe/
        );
        assert.ok(resizeObserverBlock, 'Should find ResizeObserver block');
        const block = resizeObserverBlock[0];
        const fitIndex = block.indexOf('safeFit()');
        const refreshIndex = block.indexOf('term.refresh(0, term.rows - 1)');
        assert.ok(fitIndex > -1, 'Should find safeFit()');
        assert.ok(refreshIndex > -1, 'Should find term.refresh()');
        assert.ok(
            refreshIndex > fitIndex,
            'term.refresh() should come after safeFit()'
        );
    });
});

describe('CSS transition is dynamic (minimize-only)', () => {
    it('#terminal-container should NOT have a static transition property', () => {
        // Extract the #terminal-container rule (before any nested/modifier rules)
        const containerRule = terminalCss.match(
            /#terminal-container\s*\{[^}]+\}/
        );
        assert.ok(containerRule, 'Should find #terminal-container rule');
        assert.ok(
            !containerRule[0].includes('transition:'),
            '#terminal-container base rule should not have a static transition'
        );
    });

    it('should define .transitioning class with height transition', () => {
        assert.ok(
            terminalCss.includes('#terminal-container.transitioning'),
            'CSS should define #terminal-container.transitioning'
        );
        // The .transitioning rule should contain the height transition
        const transitionRule = terminalCss.match(
            /#terminal-container\.transitioning\s*\{[^}]+\}/
        );
        assert.ok(transitionRule, 'Should find .transitioning rule');
        assert.ok(
            transitionRule[0].includes('transition: height'),
            '.transitioning class should include transition: height'
        );
    });
});

describe('Terminal canvas suspension during resize', () => {
    // Extract the ResizeObserver block for all tests in this suite
    const resizeObserverBlock = terminalSource.match(
        /new ResizeObserver\(\(\) => \{[\s\S]*?\}\);[\s]*resizeObserver\.observe/
    )?.[0] || '';

    it('should hide terminal element immediately on resize start', () => {
        assert.ok(
            resizeObserverBlock.includes("term.element.style.visibility = 'hidden'"),
            'ResizeObserver should set visibility hidden on resize start'
        );
    });

    it('visibility hidden should be set BEFORE the debounce setTimeout', () => {
        const hideIndex = resizeObserverBlock.indexOf("visibility = 'hidden'");
        const timeoutIndex = resizeObserverBlock.indexOf('resizeTimeout = setTimeout');
        assert.ok(hideIndex > -1, 'Should find visibility hidden');
        assert.ok(timeoutIndex > -1, 'Should find setTimeout');
        assert.ok(
            hideIndex < timeoutIndex,
            'visibility hidden should come before setTimeout'
        );
    });

    it('should restore visibility after fit completes', () => {
        assert.ok(
            resizeObserverBlock.includes("term.element.style.visibility = ''"),
            'ResizeObserver should restore visibility after fit'
        );
    });

    it('visibility restore should appear AFTER term.refresh()', () => {
        const refreshIndex = resizeObserverBlock.indexOf('term.refresh(0, term.rows - 1)');
        const restoreIndex = resizeObserverBlock.indexOf("style.visibility = ''");
        assert.ok(refreshIndex > -1, 'Should find term.refresh()');
        assert.ok(restoreIndex > -1, 'Should find visibility restore');
        assert.ok(
            restoreIndex > refreshIndex,
            'visibility restore should come after term.refresh()'
        );
    });

    it('visibility restore should be delayed to let CLI process SIGWINCH', () => {
        // The visibility restore should be wrapped in a setTimeout (not immediate)
        // Check that setTimeout appears after refresh and contains the visibility restore
        const afterRefresh = resizeObserverBlock.slice(
            resizeObserverBlock.indexOf('term.refresh(0, term.rows - 1)')
        );
        assert.ok(
            afterRefresh.includes('setTimeout('),
            'Should have a setTimeout after term.refresh()'
        );
        // The setTimeout should contain the visibility restore
        const setTimeoutMatch = afterRefresh.match(/setTimeout\(\(\) => \{[\s\S]*?\}, \d+\)/);
        assert.ok(setTimeoutMatch, 'Should find setTimeout block after refresh');
        assert.ok(
            setTimeoutMatch[0].includes("visibility = ''"),
            'setTimeout should contain visibility restore'
        );
    });
});

describe('PTY resize deduplication', () => {
    it('should define resizePtyIfChanged helper function', () => {
        assert.ok(
            terminalSource.includes('function resizePtyIfChanged()'),
            'Should define resizePtyIfChanged function'
        );
    });

    it('resizePtyIfChanged should check lastPtyCols/lastPtyRows before sending', () => {
        const funcMatch = terminalSource.match(
            /function resizePtyIfChanged\(\)\s*\{[\s\S]*?\n\}/
        );
        assert.ok(funcMatch, 'Should find resizePtyIfChanged function');
        const body = funcMatch[0];
        assert.ok(body.includes('lastPtyCols'), 'Should check lastPtyCols');
        assert.ok(body.includes('lastPtyRows'), 'Should check lastPtyRows');
    });

    it('resizePtyIfChanged should skip resize when cols/rows unchanged', () => {
        const funcMatch = terminalSource.match(
            /function resizePtyIfChanged\(\)\s*\{[\s\S]*?\n\}/
        );
        assert.ok(funcMatch, 'Should find resizePtyIfChanged function');
        const body = funcMatch[0];
        // Should have early return when dimensions match
        assert.ok(
            body.includes('term.cols === lastPtyCols && term.rows === lastPtyRows'),
            'Should compare current cols/rows against last sent values'
        );
        assert.ok(
            body.includes('return'),
            'Should return early when dimensions unchanged'
        );
    });

    it('all resize calls should go through resizePtyIfChanged (no direct calls)', () => {
        // The only direct voiceMirror.claude.resize call should be inside resizePtyIfChanged
        const allResizeCalls = terminalSource.match(
            /voiceMirror\.claude\.resize\(/g
        );
        assert.ok(allResizeCalls, 'Should have at least one resize call');
        assert.strictEqual(
            allResizeCalls.length, 1,
            'Should have exactly one direct resize call (inside resizePtyIfChanged)'
        );
    });
});

describe('minimizeTerminal dynamic transition class', () => {
    it('minimizeTerminal should add .transitioning class before toggling', () => {
        // The function should add the transitioning class
        assert.ok(
            terminalSource.includes("classList.add('transitioning')"),
            'minimizeTerminal should add transitioning class'
        );
    });

    it('minimizeTerminal should remove .transitioning class after transition ends', () => {
        assert.ok(
            terminalSource.includes("classList.remove('transitioning')"),
            'minimizeTerminal should remove transitioning class'
        );
    });

    it('minimizeTerminal should have a fallback timeout to remove .transitioning', () => {
        // Extract the minimizeTerminal function body
        const funcMatch = terminalSource.match(
            /export function minimizeTerminal\(\)\s*\{[\s\S]*?^}/m
        );
        assert.ok(funcMatch, 'Should find minimizeTerminal function');
        const funcBody = funcMatch[0];

        // Should have a setTimeout fallback that removes the class
        assert.ok(
            funcBody.includes('setTimeout('),
            'minimizeTerminal should have a fallback setTimeout'
        );
        assert.ok(
            funcBody.includes("classList.remove('transitioning')"),
            'Fallback should remove transitioning class'
        );
    });
});
