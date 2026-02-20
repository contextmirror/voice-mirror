<script>
  import LensToolbar from './LensToolbar.svelte';
  import LensPreview from './LensPreview.svelte';
  import SplitPanel from '../shared/SplitPanel.svelte';

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
              <div class="chat-messages">
                <div class="chat-session-info">
                  <p class="session-title">New session</p>
                  <div class="session-meta">
                    <span>
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
                      Voice Mirror
                    </span>
                    <span>
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="6" y1="3" x2="6" y2="15"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M18 9a9 9 0 0 1-9 9"/></svg>
                      dev
                    </span>
                  </div>
                </div>
              </div>
              <div class="chat-input-area">
                <div class="chat-input-box">
                  <span class="chat-input-placeholder">Ask anything...</span>
                  <button class="chat-input-send" title="Send">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
                  </button>
                </div>
              </div>
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
          <div class="terminal-tabs">
            <div class="terminal-tab active">
              <span>Terminal 1</span>
              <button class="terminal-tab-close" title="Close">x</button>
            </div>
            <button class="terminal-tab-add" title="New terminal">+</button>
          </div>
          <div class="terminal-content">
            <span class="terminal-prompt">$</span>
          </div>
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

  /* ── Chat Panel Skeleton ── */

  .chat-area {
    display: flex;
    flex-direction: column;
    height: 100%;
    overflow: hidden;
    background: var(--bg);
    border-right: 1px solid var(--border);
  }

  .chat-messages {
    flex: 1;
    overflow-y: auto;
    padding: 12px;
    display: flex;
    flex-direction: column;
    justify-content: flex-end;
  }

  .chat-session-info {
    color: var(--muted);
    font-size: 12px;
  }
  .session-title {
    font-size: 14px;
    color: var(--text);
    margin: 0 0 8px 0;
    font-weight: 500;
  }
  .session-meta {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .session-meta span {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .chat-input-area {
    padding: 8px;
    border-top: 1px solid var(--border);
  }
  .chat-input-box {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 12px;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--bg-elevated);
  }
  .chat-input-placeholder {
    flex: 1;
    font-size: 13px;
    color: var(--muted);
    opacity: 0.6;
  }
  .chat-input-send {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    border: none;
    border-radius: 6px;
    background: var(--accent);
    color: var(--bg);
    cursor: pointer;
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

  /* ── Terminal Panel Skeleton ── */

  .terminal-area {
    display: flex;
    flex-direction: column;
    height: 100%;
    overflow: hidden;
    background: var(--bg);
    border-top: 1px solid var(--border);
  }

  .terminal-tabs {
    display: flex;
    align-items: center;
    gap: 0;
    padding: 0 8px;
    height: 30px;
    flex-shrink: 0;
    border-bottom: 1px solid var(--border);
    background: var(--bg-elevated);
  }
  .terminal-tab {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px 10px;
    font-size: 12px;
    color: var(--text);
    border-bottom: 2px solid transparent;
  }
  .terminal-tab.active { border-bottom-color: var(--accent); }
  .terminal-tab-close {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 16px;
    height: 16px;
    border: none;
    border-radius: 3px;
    background: transparent;
    color: var(--muted);
    font-size: 11px;
    cursor: pointer;
    line-height: 1;
  }
  .terminal-tab-close:hover { background: var(--bg); color: var(--text); }
  .terminal-tab-add {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    border: none;
    border-radius: 4px;
    background: transparent;
    color: var(--muted);
    font-size: 14px;
    cursor: pointer;
  }
  .terminal-tab-add:hover { background: var(--bg); color: var(--text); }

  .terminal-content {
    flex: 1;
    padding: 8px 12px;
    font-family: var(--font-mono);
    font-size: 13px;
    color: var(--muted);
    overflow: hidden;
  }
  .terminal-prompt {
    color: var(--accent);
  }
</style>
