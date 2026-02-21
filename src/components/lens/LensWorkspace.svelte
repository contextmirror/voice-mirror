<script>
  import LensToolbar from './LensToolbar.svelte';
  import LensPreview from './LensPreview.svelte';
  import FileTree from './FileTree.svelte';
  import TabBar from './TabBar.svelte';
  import FileEditor from './FileEditor.svelte';
  import SplitPanel from '../shared/SplitPanel.svelte';
  import ChatPanel from '../chat/ChatPanel.svelte';
  import TerminalTabs from '../terminal/TerminalTabs.svelte';
  import { tabsStore } from '../../lib/stores/tabs.svelte.js';
  import { lensSetVisible } from '../../lib/api.js';

  let {
    onSend = () => {},
  } = $props();

  // Split ratios (will be persisted to config later)
  let verticalRatio = $state(0.75);   // main area vs terminal
  let chatRatio = $state(0.18);       // chat vs center+right
  let previewRatio = $state(0.78);    // preview vs file tree

  // Toggle browser webview visibility when switching between browser and file tabs
  $effect(() => {
    const isBrowser = tabsStore.activeTab?.type === 'browser';
    lensSetVisible(isBrowser).catch(() => {});
  });
</script>

<div class="lens-workspace">
  <div class="workspace-content">
    <!-- Vertical split: main panels (top) | terminal (bottom) -->
    <SplitPanel direction="vertical" bind:ratio={verticalRatio} minA={200} minB={80}>
      {#snippet panelA()}
        <!-- Horizontal split: chat (left) | center+right -->
        <SplitPanel direction="horizontal" bind:ratio={chatRatio} minA={180} minB={400}>
          {#snippet panelA()}
            <div class="chat-area">
              <ChatPanel {onSend} />
            </div>
          {/snippet}
          {#snippet panelB()}
            <!-- Horizontal split: preview (center) | file tree (right) -->
            <SplitPanel direction="horizontal" bind:ratio={previewRatio} minA={300} minB={140}>
              {#snippet panelA()}
                <div class="preview-area">
                  <TabBar />
                  {#if tabsStore.activeTab?.type === 'browser'}
                    <LensToolbar />
                    <LensPreview />
                  {:else if tabsStore.activeTab?.type === 'file'}
                    {#key tabsStore.activeTabId}
                      <FileEditor tab={tabsStore.activeTab} />
                    {/key}
                  {/if}
                </div>
              {/snippet}
              {#snippet panelB()}
                <FileTree onFileClick={(entry) => tabsStore.openFile(entry)} />
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
  }

  /* ── Chat Panel ── */

  .chat-area {
    display: flex;
    flex-direction: column;
    height: 100%;
    overflow: hidden;
    background: var(--bg);
    border-right: 1px solid var(--border);
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
