# Layout Refactor Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Move the terminal from a full-width bottom panel into the center column (below editor/preview), VS Code style. Add Pixel Agents placeholder in bottom-left.

**Architecture:** Restructure SplitPanel nesting in LensWorkspace.svelte. The outermost split changes from vertical (top/bottom) to horizontal (left/right). Terminal moves into a vertical split within the center column. All terminal stores, toggle logic, and terminal components are unchanged.

**Tech Stack:** Svelte 5, SplitPanel component, source-inspection tests (node:test).

**Design doc:** `docs/plans/2026-02-26-layout-refactor-design.md`

---

### Task 1: Update tests for new layout structure

**Files:**
- Modify: `test/components/lens-workspace.test.cjs`

**Step 1: Update the failing test assertions**

Three tests need updating to match the new nesting:

1. **Line 44-46** — "has vertical split for main area vs terminal": The assertion `src.includes('direction="vertical"')` still passes (we still have vertical splits), but the comment is wrong. However, since we'll have 2 vertical splits now (chat column + center column), this test passes as-is. **No change needed.**

2. **Line 51-55** — "has split ratio state variables": Replace `verticalRatio` with `centerRatio` and add `chatVerticalRatio`:

Replace:
```js
  it('has split ratio state variables', () => {
    assert.ok(src.includes('verticalRatio'));
    assert.ok(src.includes('chatRatio'));
    assert.ok(src.includes('previewRatio'));
  });
```

With:
```js
  it('has split ratio state variables', () => {
    assert.ok(src.includes('centerRatio'));
    assert.ok(src.includes('chatRatio'));
    assert.ok(src.includes('previewRatio'));
    assert.ok(src.includes('chatVerticalRatio'));
  });
```

3. **Add new test** after line 110 (after "has terminal area wrapper with TerminalTabs"):

```js
  it('has pixel agents placeholder area', () => {
    assert.ok(src.includes('placeholder-area'), 'Should have placeholder-area div');
  });
```

**Step 2: Run tests to verify they fail**

Run: `npm test -- --test-name-pattern "split ratio state|pixel agents placeholder" 2>&1 | tail -10`
Expected: "split ratio state" FAILS (verticalRatio → centerRatio), "pixel agents placeholder" FAILS.

---

### Task 2: Restructure SplitPanel nesting in LensWorkspace.svelte

**Files:**
- Modify: `src/components/lens/LensWorkspace.svelte`

**Step 1: Update split ratio variables**

At line 34-37, replace:

```js
  // Split ratios (will be persisted to config later)
  let verticalRatio = $state(0.75);   // main area vs terminal
  let chatRatio = $state(0.18);       // chat vs center+right
  let previewRatio = $state(0.78);    // preview vs file tree
```

With:

```js
  // Split ratios (will be persisted to config later)
  let chatRatio = $state(0.18);             // left column vs center+right
  let chatVerticalRatio = $state(0.80);     // chat vs pixel agents placeholder
  let centerRatio = $state(0.75);           // editor/preview vs terminal
  let previewRatio = $state(0.78);          // center column vs file tree
```

**Step 2: Replace the entire template block (lines 277-351)**

Replace everything from `<div class="lens-workspace"` through the closing `</div>` of `.workspace-content` with:

```svelte
<div class="lens-workspace" ondragover={(e) => { if (fileTreeDragging) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; } }}>
  <div class="workspace-content">
    <!-- Horizontal split: left-column (chat) | center+right -->
    <SplitPanel direction="horizontal" bind:ratio={chatRatio} minA={180} minB={400} collapseA={!layoutStore.showChat}>
      {#snippet panelA()}
        <!-- Left column: chat (top) | pixel agents placeholder (bottom) -->
        <SplitPanel direction="vertical" bind:ratio={chatVerticalRatio} minA={200} minB={60}>
          {#snippet panelA()}
            <div class="chat-area">
              <ChatPanel {onSend} />
            </div>
          {/snippet}
          {#snippet panelB()}
            <div class="placeholder-area">
              <div class="placeholder-content">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="24" height="24">
                  <rect x="2" y="3" width="20" height="14" rx="2" />
                  <circle cx="8" cy="10" r="2" />
                  <circle cx="16" cy="10" r="2" />
                  <path d="M9 14h6" />
                </svg>
                <span>Pixel Agents</span>
              </div>
            </div>
          {/snippet}
        </SplitPanel>
      {/snippet}
      {#snippet panelB()}
        <!-- Horizontal split: center-column | file tree -->
        <SplitPanel direction="horizontal" bind:ratio={previewRatio} minA={300} minB={140} collapseB={!layoutStore.showFileTree}>
          {#snippet panelA()}
            <!-- Center column: editor/preview (top) | terminal (bottom) -->
            <SplitPanel direction="vertical" bind:ratio={centerRatio} minA={200} minB={80} collapseB={!layoutStore.showTerminal}>
              {#snippet panelA()}
                <div class="preview-area">
                  <!-- Editor Grid: always visible so GroupTabBar stays accessible -->
                  <div class="editor-grid">
                    {#if editorGroupsStore.maximizedGroupId !== null}
                      <EditorPane groupId={editorGroupsStore.maximizedGroupId} showBrowser={editorGroupsStore.maximizedGroupId === firstGroupId ? showBrowser : false} onBrowserClick={editorGroupsStore.maximizedGroupId === firstGroupId ? () => { showBrowser = !showBrowser; } : null} />
                    {:else}
                      {@render renderNode(editorGroupsStore.gridRoot)}
                    {/if}
                    <!-- Workspace-level drop zone overlay for full-width ancestor splits -->
                    {#if ancestorDropZone}
                      <div class="ancestor-drop-overlay">
                        <div class="ancestor-zone" class:top={ancestorDropZone === 'top'} class:bottom={ancestorDropZone === 'bottom'} class:left={ancestorDropZone === 'left'} class:right={ancestorDropZone === 'right'}></div>
                      </div>
                    {/if}
                  </div>

                  <!-- Browser layer: overlays editor content when visible (tab bar stays above) -->
                  <div class="preview-layer" class:visible={showBrowser}>
                    <BrowserTabBar onNewTab={() => lensPreviewRef?.createNewTab()} />
                    <LensToolbar />
                    {#if lensStore.designMode}
                      <DesignToolbar
                        onSend={handleDesignSend}
                        onElementSend={handleElementSend}
                        onClose={() => lensStore.setDesignMode(false)}
                      />
                    {/if}
                    <LensPreview bind:this={lensPreviewRef} />
                  </div>
                </div>
              {/snippet}
              {#snippet panelB()}
                <div class="terminal-area">
                  <TerminalTabs />
                </div>
              {/snippet}
            </SplitPanel>
          {/snippet}
          {#snippet panelB()}
            <FileTree
              onFileClick={(entry) => { showBrowser = false; tabsStore.openFile(entry, editorGroupsStore.focusedGroupId); }}
              onFileDblClick={(entry) => tabsStore.pinTab(entry.path)}
              onChangeClick={(change) => tabsStore.openDiff(change)}
              onChangeDblClick={(change) => tabsStore.pinTab(`diff:${change.path}`)}
              activeFilePath={isFile ? activeTab?.path : null}
              activeDiffPath={isDiff ? activeTab?.path : null}
              activeFileHasLsp={isFile && LSP_EXTENSIONS.has(activeExt)}
              onSymbolClick={({ line, character }) => {
                const gId = editorGroupsStore.focusedGroupId;
                const event = new CustomEvent(`lens-goto-position-${gId}`, { detail: { line, character } });
                window.dispatchEvent(event);
              }}
            />
          {/snippet}
        </SplitPanel>
      {/snippet}
    </SplitPanel>
  </div>
</div>
```

**Step 3: Update CSS — add placeholder-area styles**

After the existing `.terminal-area` block (line ~492), add:

```css
  /* -- Pixel Agents Placeholder -- */

  .placeholder-area {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 100%;
    overflow: hidden;
    background: var(--bg);
    border-top: 1px solid var(--border);
    border-right: 1px solid var(--border);
  }

  .placeholder-content {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    color: var(--muted);
    font-size: 12px;
    opacity: 0.5;
    user-select: none;
  }

  .placeholder-content svg {
    opacity: 0.6;
  }
```

**Step 4: Update chat-area border-radius**

The `.chat-area` currently has `border-radius: var(--radius-lg) 0 0 0`. Since chat no longer reaches the bottom-left corner, remove the border-radius. Replace:

```css
  .chat-area {
    display: flex;
    flex-direction: column;
    height: 100%;
    overflow: hidden;
    background: var(--bg);
    border-right: 1px solid var(--border);
    border-radius: var(--radius-lg) 0 0 0;
  }
```

With:

```css
  .chat-area {
    display: flex;
    flex-direction: column;
    height: 100%;
    overflow: hidden;
    background: var(--bg);
    border-right: 1px solid var(--border);
  }
```

**Step 5: Run tests**

Run: `npm test 2>&1 | tail -8`
Expected: All tests pass.

**Step 6: Commit**

```bash
git add src/components/lens/LensWorkspace.svelte test/components/lens-workspace.test.cjs
git commit -m "feat: move terminal to center column (VS Code-style layout)

Restructure SplitPanel nesting so terminal shares the center column
with the editor/preview instead of spanning full width at the bottom.
Chat and file tree now extend full height. Adds Pixel Agents placeholder
in bottom-left corner of the left column."
```

---

### Task 3: Visual verification

**Step 1: Run dev server and verify layout**

Run: `npm run dev`

Verify:
- [ ] Terminal appears below editor/preview in the center column only
- [ ] Chat panel extends full height on the left
- [ ] File tree extends full height on the right
- [ ] Pixel Agents placeholder visible in bottom-left with muted icon+text
- [ ] Toggle terminal button (top-right) still shows/hides the terminal
- [ ] Command palette "Toggle Terminal" works
- [ ] Terminal tabs (AI, shell, dev-server) all function normally
- [ ] SplitPanel drag handles work for all 4 split points
- [ ] Browser preview still appears correctly in the center area
- [ ] Design mode overlay still works

**Step 2: Run full test suite**

Run: `npm test`
Expected: All 4100+ tests pass.

---

## Summary of Changes

| File | Change | Lines |
|------|--------|-------|
| `src/components/lens/LensWorkspace.svelte` | Restructure SplitPanel nesting, rename verticalRatio→centerRatio, add chatVerticalRatio, add placeholder, adjust CSS | ~30 changed, ~25 added |
| `test/components/lens-workspace.test.cjs` | Update ratio name assertions, add placeholder test | ~5 changed, ~3 added |
