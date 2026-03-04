<script>
  import { onMount } from 'svelte';
  import { listen } from '@tauri-apps/api/event';
  import LensToolbar from './LensToolbar.svelte';
  import DesignToolbar from './DesignToolbar.svelte';
  import LensPreview from './LensPreview.svelte';
  import BrowserTabBar from './BrowserTabBar.svelte';
  import FileTree from './FileTree.svelte';
  import GroupTabBar from './GroupTabBar.svelte';
  import FileEditor from './FileEditor.svelte';
  import DiffViewer from './DiffViewer.svelte';
  import EditorPane from './EditorPane.svelte';
  import DevicePreview from './DevicePreview.svelte';
  import SplitPanel from '../shared/SplitPanel.svelte';
  import ChatPanel from '../chat/ChatPanel.svelte';
  import TerminalTabs from '../terminal/TerminalTabs.svelte';
  import { tabsStore } from '../../lib/stores/tabs.svelte.js';
  import { editorGroupsStore } from '../../lib/stores/editor-groups.svelte.js';
  import { layoutStore } from '../../lib/stores/layout.svelte.js';
  import { lensStore } from '../../lib/stores/lens.svelte.js';
  import { browserTabsStore } from '../../lib/stores/browser-tabs.svelte.js';
  import { lensSetVisible, startFileWatching, stopFileWatching, lensCapturePreview, lspShutdown } from '../../lib/api.js';
  import { attachmentsStore } from '../../lib/stores/attachments.svelte.js';
  import { projectStore } from '../../lib/stores/project.svelte.js';
  import { lspDiagnosticsStore } from '../../lib/stores/lsp-diagnostics.svelte.js';
  import { devicePreviewStore } from '../../lib/stores/device-preview.svelte.js';
  import { LSP_EXTENSIONS } from '../../lib/editor-lsp.svelte.js';
  import { setActionHandler } from '../../lib/stores/shortcuts.svelte.js';

  let {
    onSend = () => {},
  } = $props();

  let lensPreviewRef;

  // Split ratios (will be persisted to config later)
  let chatRatio = $state(0.18);             // left column vs center+right
  // chatVerticalRatio removed — pixel agents placeholder removed, chat is full height
  let centerRatio = $state(0.75);           // editor/preview vs terminal
  let previewRatio = $state(0.78);          // center column vs file tree
  let devicePreviewRatio = $state(0.5);    // editor vs device preview

  // Browser is a fixed UI element, not a tab — follows the first (leftmost) group
  let showBrowser = $state(false);
  let firstGroupId = $derived(editorGroupsStore.allGroupIds[0]);

  // Track file-tree drag state to suppress stop-sign cursor across the workspace
  let fileTreeDragging = $state(false);
  // Workspace-level ancestor drop zone (full-width top/bottom overlays)
  let ancestorDropZone = $state(null);

  $effect(() => {
    const onStart = () => { fileTreeDragging = true; };
    const onEnd = () => { fileTreeDragging = false; ancestorDropZone = null; };
    window.addEventListener('file-tree-drag-start', onStart);
    window.addEventListener('file-tree-drag-end', onEnd);
    return () => {
      window.removeEventListener('file-tree-drag-start', onStart);
      window.removeEventListener('file-tree-drag-end', onEnd);
    };
  });

  /** Handle seam dragover — detect top/bottom half and show ancestor overlay */
  function handleSeamDragOver(e, seamDirection) {
    if (!fileTreeDragging) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'copy';

    // For a horizontal seam (between left/right panes), detect top vs bottom half
    if (seamDirection === 'horizontal') {
      const rect = e.currentTarget.getBoundingClientRect();
      const y = (e.clientY - rect.top) / rect.height;
      ancestorDropZone = y > 0.5 ? 'bottom' : 'top';
    } else {
      const rect = e.currentTarget.getBoundingClientRect();
      const x = (e.clientX - rect.left) / rect.width;
      ancestorDropZone = x > 0.5 ? 'right' : 'left';
    }
  }

  function handleSeamDragLeave(e) {
    if (!e.currentTarget.contains(e.relatedTarget)) {
      ancestorDropZone = null;
    }
  }

  /** Handle drop on seam — create full-width/height ancestor split */
  function handleSeamDrop(e) {
    e.preventDefault();
    e.stopPropagation();

    let raw = e.dataTransfer.getData('application/x-voice-mirror-file');
    if (!raw) raw = e.dataTransfer.getData('text/plain');
    if (!raw) return;

    let data;
    try { data = JSON.parse(raw); } catch { return; }
    if (data?.type !== 'file-tree' || !data.entry?.path) return;

    const zone = ancestorDropZone;
    ancestorDropZone = null;

    if (zone === 'bottom') {
      const newId = editorGroupsStore.splitAncestor(editorGroupsStore.focusedGroupId, 'vertical');
      tabsStore.openFile(data.entry, newId);
    } else if (zone === 'top') {
      const newId = editorGroupsStore.splitAncestor(editorGroupsStore.focusedGroupId, 'vertical', 'before');
      tabsStore.openFile(data.entry, newId);
    } else if (zone === 'right') {
      const newId = editorGroupsStore.splitAncestor(editorGroupsStore.focusedGroupId, 'horizontal');
      tabsStore.openFile(data.entry, newId);
    } else if (zone === 'left') {
      const newId = editorGroupsStore.splitAncestor(editorGroupsStore.focusedGroupId, 'horizontal', 'before');
      tabsStore.openFile(data.entry, newId);
    }

    window.dispatchEvent(new CustomEvent('file-tree-drag-end'));
  }

  // Derive active file info for FileTree highlighting
  let focusedGroupId = $derived(editorGroupsStore.focusedGroupId);
  let focusedActiveTabId = $derived(editorGroupsStore.groups.get(focusedGroupId)?.activeTabId);
  let activeTab = $derived(focusedActiveTabId ? tabsStore.tabs.find(t => t.id === focusedActiveTabId) : null);
  let isFile = $derived(activeTab?.type === 'file');
  let isDiff = $derived(activeTab?.type === 'diff');
  let activeExt = $derived(activeTab?.path?.split('.').pop()?.toLowerCase());

  // Toggle browser webview visibility
  $effect(() => {
    if (!lensStore.webviewReady) return;
    lensSetVisible(showBrowser).catch(() => {});
  });

  // Start/stop file watcher when entering Lens mode or switching projects
  $effect(() => {
    const path = projectStore.root;
    if (!path) return;

    startFileWatching(path).catch((err) => {
      console.warn('[LensWorkspace] Failed to start file watcher:', err);
    });

    return () => {
      stopFileWatching().catch(() => {});
    };
  });

  /** Capture the annotated browser screenshot and add it as a chat attachment. */
  async function handleDesignSend() {
    try {
      const result = await lensCapturePreview();
      if (result?.success && result?.data) {
        attachmentsStore.add({
          path: result.data.path,
          dataUrl: result.data.dataUrl,
          type: 'image/png',
          name: 'Design Annotation',
        });
      } else {
        console.warn('[LensWorkspace] Design capture failed:', result?.error || result);
      }
    } catch (err) {
      console.error('[LensWorkspace] Design capture error:', err);
    }
    lensStore.setDesignMode(false);
  }

  /** Handle element selection from design toolbar — queue screenshot + context as pending attachment. */
  function handleElementSend({ imageDataUrl, contextText, name }) {
    // Queue the element capture as a pending attachment with hidden context
    attachmentsStore.add({
      path: 'element-capture',
      dataUrl: imageDataUrl,
      type: 'image/png',
      name: name || 'Selected Element',
      context: contextText,
    });

    // Ensure chat panel is visible and focus the input
    layoutStore.setShowChat(true);
    lensStore.setDesignMode(false);

    // Focus the chat input so the user can immediately type their instruction
    requestAnimationFrame(() => {
      const textarea = document.querySelector('.chat-input-bar textarea');
      if (textarea) /** @type {HTMLElement} */(textarea).focus();
    });
  }

  // Start/stop LSP diagnostics store listener on project switch
  $effect(() => {
    const path = projectStore.root;
    if (!path) return;

    // Shut down LSP servers from previous project before starting new ones
    lspShutdown().catch(() => {});

    lspDiagnosticsStore.clear();
    lspDiagnosticsStore.startListening(path).catch((err) => {
      console.warn('[LensWorkspace] Failed to start diagnostics listener:', err);
    });

    return () => {
      lspDiagnosticsStore.stopListening();
    };
  });

  // ── Action handlers for split-editor shortcuts ──
  onMount(() => {
    setActionHandler('split-editor', () => {
      if (editorGroupsStore.hasSplit) {
        // Close the focused group (if not group 1)
        if (editorGroupsStore.focusedGroupId !== 1) {
          editorGroupsStore.closeGroup(editorGroupsStore.focusedGroupId);
        }
      } else {
        const fId = editorGroupsStore.focusedGroupId;
        const focusedActiveTab = tabsStore.getActiveTabForGroup
          ? tabsStore.tabs.find(t => t.id === (editorGroupsStore.groups.get(fId)?.activeTabId))
          : tabsStore.activeTab;
        if (focusedActiveTab) {
          const newGroupId = editorGroupsStore.splitGroup(fId, 'horizontal');
          tabsStore.openFile({ name: focusedActiveTab.title, path: focusedActiveTab.path }, newGroupId);
        }
      }
    });

    setActionHandler('focus-group-1', () => editorGroupsStore.setFocusedGroup(1));
    setActionHandler('focus-group-2', () => {
      const ids = editorGroupsStore.allGroupIds;
      if (ids.length >= 2) editorGroupsStore.setFocusedGroup(ids[1]);
    });

    // Directional focus (Ctrl+K Ctrl+Arrow)
    setActionHandler('focus-group-left', () => editorGroupsStore.focusDirection('left'));
    setActionHandler('focus-group-right', () => editorGroupsStore.focusDirection('right'));
    setActionHandler('focus-group-up', () => editorGroupsStore.focusDirection('up'));
    setActionHandler('focus-group-down', () => editorGroupsStore.focusDirection('down'));

    // Even sizes (Ctrl+K Ctrl+=)
    setActionHandler('even-editor-sizes', () => editorGroupsStore.evenSizes());

    // Maximize group (Ctrl+K Ctrl+M)
    setActionHandler('maximize-editor-group', () => editorGroupsStore.toggleMaximize());
  });
</script>

{#snippet renderNode(node)}
  {#if node.type === 'leaf'}
    <EditorPane groupId={node.groupId} showBrowser={node.groupId === firstGroupId ? showBrowser : false} onBrowserClick={node.groupId === firstGroupId ? () => { showBrowser = !showBrowser; } : null} onDevicePreviewClick={node.groupId === firstGroupId ? () => { devicePreviewStore.toggle(); } : null} showDevicePreview={node.groupId === firstGroupId ? devicePreviewStore.isOpen : false} />
  {:else}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="grid-branch" class:horizontal={node.direction === 'horizontal'} class:vertical={node.direction === 'vertical'}>
      <SplitPanel direction={node.direction} bind:ratio={node.ratio} minA={150} minB={150}>
        {#snippet panelA()}
          {@render renderNode(node.children[0])}
        {/snippet}
        {#snippet panelB()}
          {@render renderNode(node.children[1])}
        {/snippet}
      </SplitPanel>
      <!-- Seam drop zone: invisible overlay on the divider, active during file-tree drags -->
      {#if fileTreeDragging}
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div
          class="seam-drop-zone"
          class:horizontal={node.direction === 'horizontal'}
          class:vertical={node.direction === 'vertical'}
          style={node.direction === 'horizontal'
            ? `left: calc(${node.ratio * 100}% - 20px); width: 40px; top: 0; bottom: 0;`
            : `top: calc(${node.ratio * 100}% - 20px); height: 40px; left: 0; right: 0;`}
          ondragover={(e) => handleSeamDragOver(e, node.direction)}
          ondragleave={handleSeamDragLeave}
          ondrop={handleSeamDrop}
        ></div>
      {/if}
    </div>
  {/if}
{/snippet}



<div class="lens-workspace" ondragover={(e) => { if (fileTreeDragging) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; } }}>
  <div class="workspace-content">
    <!-- Horizontal split: left-column (chat) | center+right -->
    <SplitPanel direction="horizontal" bind:ratio={chatRatio} minA={180} minB={400} collapseA={!layoutStore.showChat}>
      {#snippet panelA()}
        <!-- Left column: chat (full height) -->
        <div class="chat-area">
          <ChatPanel {onSend} />
        </div>
      {/snippet}
      {#snippet panelB()}
        <!-- Horizontal split: center-column | file tree -->
        <SplitPanel direction="horizontal" bind:ratio={previewRatio} minA={300} minB={140} collapseB={!layoutStore.showFileTree}>
          {#snippet panelA()}
            <!-- Center column: editor/preview (top) | terminal (bottom) -->
            <SplitPanel direction="vertical" bind:ratio={centerRatio} minA={200} minB={80} collapseB={!layoutStore.showTerminal}>
              {#snippet panelA()}
                <div class="preview-area">
                  <SplitPanel direction="horizontal" bind:ratio={devicePreviewRatio} minA={300} minB={200} collapseB={!devicePreviewStore.isOpen}>
                    {#snippet panelA()}
                      <div class="editor-with-browser">
                        <!-- Editor Grid: always visible so GroupTabBar stays accessible -->
                        <div class="editor-grid">
                          {#if editorGroupsStore.maximizedGroupId !== null}
                            <EditorPane groupId={editorGroupsStore.maximizedGroupId} showBrowser={editorGroupsStore.maximizedGroupId === firstGroupId ? showBrowser : false} onBrowserClick={editorGroupsStore.maximizedGroupId === firstGroupId ? () => { showBrowser = !showBrowser; } : null} onDevicePreviewClick={editorGroupsStore.maximizedGroupId === firstGroupId ? () => { devicePreviewStore.toggle(); } : null} showDevicePreview={editorGroupsStore.maximizedGroupId === firstGroupId ? devicePreviewStore.isOpen : false} />
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
                      <DevicePreview />
                    {/snippet}
                  </SplitPanel>
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
              onOpenToSide={(entry) => { showBrowser = false; tabsStore.openFileToSide(entry); }}
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

<style>
  .lens-workspace {
    display: flex;
    flex-direction: column;
    height: 100%;
    overflow: hidden;
    background: var(--bg);
  }

  /* -- Workspace Content -- */

  .workspace-content {
    display: flex;
    flex-direction: column;
    flex: 1;
    overflow: hidden;
    min-height: 0;
    margin-right: 6px;
    margin-bottom: 6px;
  }

  .preview-area {
    display: flex;
    flex-direction: column;
    height: 100%;
    overflow: hidden;
    position: relative;
  }

  .editor-with-browser {
    display: flex;
    flex-direction: column;
    height: 100%;
    overflow: hidden;
    position: relative;
  }

  /* Editor grid: recursive SplitPanel tree — always visible for GroupTabBar */
  .editor-grid {
    display: flex;
    flex: 1;
    overflow: hidden;
    position: relative;
  }

  /* Workspace-level drop zone overlay for full-width ancestor splits */
  .ancestor-drop-overlay {
    position: absolute;
    inset: 0;
    z-index: 10000;
    pointer-events: none;
  }

  .ancestor-zone {
    position: absolute;
    left: 8px;
    right: 8px;
    height: calc(50% - 12px);
    background: color-mix(in srgb, var(--accent) 20%, transparent);
    border: 2px dashed var(--accent);
    border-radius: 4px;
    opacity: 1;
    transition: opacity 70ms ease-out;
  }

  .ancestor-zone.bottom {
    bottom: 8px;
  }

  .ancestor-zone.top {
    top: 8px;
  }

  .ancestor-zone.left {
    top: 8px;
    bottom: 8px;
    left: 8px;
    right: auto;
    height: auto;
    width: calc(50% - 12px);
  }

  .ancestor-zone.right {
    top: 8px;
    bottom: 8px;
    right: 8px;
    left: auto;
    height: auto;
    width: calc(50% - 12px);
  }

  /* Grid branch wrapper — needed for seam drop zone positioning */
  .grid-branch {
    display: flex;
    flex: 1;
    position: relative;
    min-width: 0;
    min-height: 0;
    overflow: hidden;
  }

  /* Seam drop zone: invisible overlay on the SplitPanel divider */
  .seam-drop-zone {
    position: absolute;
    z-index: 9999;
    pointer-events: auto;
  }

  /* Browser layer: overlays editor content below the tab bars */
  .preview-layer {
    display: none;
    flex-direction: column;
    position: absolute;
    top: 36px;  /* below GroupTabBar height */
    left: 0;
    right: 0;
    bottom: 0;
    z-index: 10;
  }

  .preview-layer.visible {
    display: flex;
  }

  /* Editor pane styles are in EditorPane.svelte */

  /* -- Chat Panel -- */

  .chat-area {
    display: flex;
    flex-direction: column;
    height: 100%;
    overflow: hidden;
    background: var(--bg);
  }

  /* -- Terminal Panel -- */

  .terminal-area {
    display: flex;
    flex-direction: column;
    height: 100%;
    overflow: hidden;
    background: var(--bg);
  }

</style>
