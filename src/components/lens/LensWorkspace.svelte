<script>
  import { onMount } from 'svelte';
  import LensToolbar from './LensToolbar.svelte';
  import DesignToolbar from './DesignToolbar.svelte';
  import LensPreview from './LensPreview.svelte';
  import BrowserTabBar from './BrowserTabBar.svelte';
  import FileTree from './FileTree.svelte';
  import GroupTabBar from './GroupTabBar.svelte';
  import FileEditor from './FileEditor.svelte';
  import DiffViewer from './DiffViewer.svelte';
  import EditorPane from './EditorPane.svelte';
  import SplitPanel from '../shared/SplitPanel.svelte';
  import ChatPanel from '../chat/ChatPanel.svelte';
  import TerminalTabs from '../terminal/TerminalTabs.svelte';
  import { tabsStore } from '../../lib/stores/tabs.svelte.js';
  import { editorGroupsStore } from '../../lib/stores/editor-groups.svelte.js';
  import { layoutStore } from '../../lib/stores/layout.svelte.js';
  import { lensStore } from '../../lib/stores/lens.svelte.js';
  import { browserTabsStore } from '../../lib/stores/browser-tabs.svelte.js';
  import { lensSetVisible, startFileWatching, stopFileWatching, lensCapturePreview } from '../../lib/api.js';
  import { attachmentsStore } from '../../lib/stores/attachments.svelte.js';
  import { projectStore } from '../../lib/stores/project.svelte.js';
  import { lspDiagnosticsStore } from '../../lib/stores/lsp-diagnostics.svelte.js';
  import { LSP_EXTENSIONS } from '../../lib/editor-lsp.svelte.js';
  import { setActionHandler } from '../../lib/stores/shortcuts.svelte.js';

  let {
    onSend = () => {},
  } = $props();

  let lensPreviewRef;

  // Split ratios (will be persisted to config later)
  let verticalRatio = $state(0.75);   // main area vs terminal
  let chatRatio = $state(0.18);       // chat vs center+right
  let previewRatio = $state(0.78);    // preview vs file tree

  // Browser is a fixed UI element, not a tab
  let showBrowser = $state(false);

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
    const path = projectStore.activeProject?.path;
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

  // Start/stop LSP diagnostics store listener on project switch
  $effect(() => {
    const path = projectStore.activeProject?.path;
    if (!path) return;

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
  });
</script>

{#snippet renderNode(node)}
  {#if node.type === 'leaf'}
    <EditorPane groupId={node.groupId} showBrowser={node.groupId === 1 ? showBrowser : false} onBrowserClick={node.groupId === 1 ? () => { showBrowser = !showBrowser; } : null} />
  {:else}
    <SplitPanel direction={node.direction} bind:ratio={node.ratio} minA={150} minB={150}>
      {#snippet panelA()}
        {@render renderNode(node.children[0])}
      {/snippet}
      {#snippet panelB()}
        {@render renderNode(node.children[1])}
      {/snippet}
    </SplitPanel>
  {/if}
{/snippet}



<div class="lens-workspace">
  <div class="workspace-content">
    <!-- Vertical split: main panels (top) | terminal (bottom) -->
    <SplitPanel direction="vertical" bind:ratio={verticalRatio} minA={200} minB={80} collapseB={!layoutStore.showTerminal}>
      {#snippet panelA()}
        <!-- Horizontal split: chat (left) | center+right -->
        <SplitPanel direction="horizontal" bind:ratio={chatRatio} minA={180} minB={400} collapseA={!layoutStore.showChat}>
          {#snippet panelA()}
            <div class="chat-area">
              <ChatPanel {onSend} />
            </div>
          {/snippet}
          {#snippet panelB()}
            <!-- Horizontal split: preview (center) | file tree (right) -->
            <SplitPanel direction="horizontal" bind:ratio={previewRatio} minA={300} minB={140} collapseB={!layoutStore.showFileTree}>
              {#snippet panelA()}
                <div class="preview-area">
                  <!-- Editor Grid: always visible so GroupTabBar stays accessible -->
                  <div class="editor-grid">
                    {@render renderNode(editorGroupsStore.gridRoot)}
                  </div>

                  <!-- Browser layer: overlays editor content when visible (tab bar stays above) -->
                  <div class="preview-layer" class:visible={showBrowser}>
                    <BrowserTabBar onNewTab={() => lensPreviewRef?.createNewTab()} />
                    <LensToolbar />
                    {#if lensStore.designMode}
                      <DesignToolbar
                        onSend={handleDesignSend}
                        onClose={() => lensStore.setDesignMode(false)}
                      />
                    {/if}
                    <LensPreview bind:this={lensPreviewRef} />
                  </div>
                </div>
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
      {/snippet}
      {#snippet panelB()}
        <div class="terminal-area">
          <TerminalTabs />
        </div>
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

  /* Editor grid: recursive SplitPanel tree — always visible for GroupTabBar */
  .editor-grid {
    display: flex;
    flex: 1;
    overflow: hidden;
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
    border-right: 1px solid var(--border);
    border-radius: var(--radius-lg) 0 0 0;
  }

  /* -- Terminal Panel -- */

  .terminal-area {
    display: flex;
    flex-direction: column;
    height: 100%;
    overflow: hidden;
    background: var(--bg);
    border-top: 1px solid var(--border);
  }
</style>
