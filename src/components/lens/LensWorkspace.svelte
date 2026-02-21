<script>
  import LensToolbar from './LensToolbar.svelte';
  import LensPreview from './LensPreview.svelte';
  import FileTree from './FileTree.svelte';
  import TabBar from './TabBar.svelte';
  import FileEditor from './FileEditor.svelte';
  import DiffViewer from './DiffViewer.svelte';
  import SplitPanel from '../shared/SplitPanel.svelte';
  import ChatPanel from '../chat/ChatPanel.svelte';
  import TerminalTabs from '../terminal/TerminalTabs.svelte';
  import { tabsStore } from '../../lib/stores/tabs.svelte.js';
  import { layoutStore } from '../../lib/stores/layout.svelte.js';
  import { lensStore } from '../../lib/stores/lens.svelte.js';
  import { lensSetVisible, startFileWatching, stopFileWatching } from '../../lib/api.js';
  import { projectStore } from '../../lib/stores/project.svelte.js';

  let {
    onSend = () => {},
  } = $props();

  // Split ratios (will be persisted to config later)
  let verticalRatio = $state(0.75);   // main area vs terminal
  let chatRatio = $state(0.18);       // chat vs center+right
  let previewRatio = $state(0.78);    // preview vs file tree

  // Derive active tab type for display switching
  let isBrowser = $derived(tabsStore.activeTab?.type === 'browser');
  let isFile = $derived(tabsStore.activeTab?.type === 'file');
  let isDiff = $derived(tabsStore.activeTab?.type === 'diff');

  // Toggle browser webview visibility when switching between browser and file tabs.
  // Guard on webviewReady so we never call before the webview exists.
  // When webviewReady transitions false→true, this effect re-fires and syncs visibility.
  $effect(() => {
    if (!lensStore.webviewReady) return;
    lensSetVisible(isBrowser).catch(() => {});
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
</script>

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
                  <TabBar />
                  <!-- Always mount all views, toggle visibility with CSS to avoid destroy/recreate -->
                  <div class="preview-layer" class:visible={isBrowser}>
                    <LensToolbar />
                    <LensPreview />
                  </div>
                  {#if isFile}
                    <FileEditor tab={tabsStore.activeTab} />
                  {/if}
                  {#if isDiff}
                    <DiffViewer tab={tabsStore.activeTab} />
                  {/if}
                </div>
              {/snippet}
              {#snippet panelB()}
                <FileTree
                  onFileClick={(entry) => tabsStore.openFile(entry)}
                  onFileDblClick={(entry) => tabsStore.pinTab(entry.path)}
                  onChangeClick={(change) => tabsStore.openDiff(change)}
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

  /* ── Workspace Content ── */

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

  /* Browser layer: always mounted, shown/hidden via CSS */
  .preview-layer {
    display: none;
    flex-direction: column;
    flex: 1;
    min-height: 0;
  }

  .preview-layer.visible {
    display: flex;
  }

  /* ── Chat Panel ── */

  .chat-area {
    display: flex;
    flex-direction: column;
    height: 100%;
    overflow: hidden;
    background: var(--bg);
    border-right: 1px solid var(--border);
    border-radius: var(--radius-lg) 0 0 0;
  }

  /* ── Terminal Panel ── */

  .terminal-area {
    display: flex;
    flex-direction: column;
    height: 100%;
    overflow: hidden;
    background: var(--bg);
    border-top: 1px solid var(--border);
  }
</style>
