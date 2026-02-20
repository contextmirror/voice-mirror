<script>
  import LensToolbar from './LensToolbar.svelte';
  import LensPreview from './LensPreview.svelte';
  import SplitPanel from '../shared/SplitPanel.svelte';
  import ChatPanel from '../chat/ChatPanel.svelte';
  import Terminal from '../terminal/Terminal.svelte';

  let {
    onSend = () => {},
  } = $props();

  // Split ratios (will be persisted to config later)
  let verticalRatio = $state(0.75);   // main area vs terminal
  let chatRatio = $state(0.18);       // chat vs center+right
  let previewRatio = $state(0.78);    // preview vs file tree
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
                  <div class="tab-strip">
                    <button class="tab-add" title="Open file">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                    </button>
                  </div>
                  <LensToolbar />
                  <LensPreview />
                </div>
              {/snippet}
              {#snippet panelB()}
                <div class="files-area">
                  <div class="files-header">
                    <button class="files-tab active">All files</button>
                    <button class="files-tab">0 Changes</button>
                  </div>
                  <div class="files-tree">
                    <div class="tree-item folder"><span class="tree-icon">></span> .github</div>
                    <div class="tree-item folder"><span class="tree-icon">></span> docs</div>
                    <div class="tree-item folder"><span class="tree-icon">></span> src</div>
                    <div class="tree-item folder"><span class="tree-icon">></span> src-tauri</div>
                    <div class="tree-item folder"><span class="tree-icon">></span> test</div>
                    <div class="tree-item file"><span class="tree-icon-file"></span> .gitignore</div>
                    <div class="tree-item file"><span class="tree-icon-file"></span> CLAUDE.md</div>
                    <div class="tree-item file"><span class="tree-icon-file"></span> index.html</div>
                    <div class="tree-item file"><span class="tree-icon-file"></span> package.json</div>
                    <div class="tree-item file"><span class="tree-icon-file"></span> README.md</div>
                    <div class="tree-item file"><span class="tree-icon-file"></span> vite.config.js</div>
                  </div>
                </div>
              {/snippet}
            </SplitPanel>
          {/snippet}
        </SplitPanel>
      {/snippet}
      {#snippet panelB()}
        <div class="terminal-area">
          <Terminal />
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

  /* ── Tab Strip ── */

  .tab-strip {
    display: flex;
    align-items: center;
    height: 30px;
    flex-shrink: 0;
    padding: 0 8px;
    background: var(--bg-elevated);
    border-bottom: 1px solid var(--border);
    -webkit-app-region: no-drag;
  }

  .tab-add {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    border: none;
    border-radius: 4px;
    background: transparent;
    color: var(--muted);
    cursor: pointer;
  }
  .tab-add:hover { background: var(--bg); color: var(--text); }

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

  /* ── Files Panel Skeleton ── */

  .files-area {
    display: flex;
    flex-direction: column;
    height: 100%;
    overflow: hidden;
    background: var(--bg);
    border-left: 1px solid var(--border);
  }

  .files-header {
    display: flex;
    gap: 0;
    padding: 0 8px;
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
  }
  .files-tab {
    padding: 6px 10px;
    font-size: 12px;
    border: none;
    background: transparent;
    color: var(--muted);
    cursor: pointer;
    border-bottom: 2px solid transparent;
  }
  .files-tab.active {
    color: var(--text);
    border-bottom-color: var(--accent);
  }
  .files-tab:hover:not(.active) { color: var(--text); }

  .files-tree {
    flex: 1;
    overflow-y: auto;
    padding: 4px 0;
  }
  .tree-item {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 3px 12px;
    font-size: 12px;
    color: var(--text);
    cursor: pointer;
    font-family: var(--font-mono);
  }
  .tree-item:hover { background: var(--bg-elevated); }
  .tree-icon {
    width: 14px;
    text-align: center;
    color: var(--muted);
    font-size: 10px;
  }
  .tree-icon-file {
    width: 14px;
  }
  .tree-item.folder { color: var(--text); }
  .tree-item.file { color: var(--muted); padding-left: 20px; }

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
