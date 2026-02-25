<script>
  import { tabsStore } from '../../lib/stores/tabs.svelte.js';
  import { editorGroupsStore } from '../../lib/stores/editor-groups.svelte.js';
  import GroupTabBar from './GroupTabBar.svelte';
  import FileEditor from './FileEditor.svelte';
  import DiffViewer from './DiffViewer.svelte';

  let { groupId = 1, showBrowser = false, onBrowserClick = () => {} } = $props();

  let activeTabId = $derived(editorGroupsStore.groups.get(groupId)?.activeTabId);
  let activeTab = $derived(activeTabId ? tabsStore.tabs.find(t => t.id === activeTabId) : null);
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="editor-pane"
     class:focused={editorGroupsStore.focusedGroupId === groupId}
     onclick={() => editorGroupsStore.setFocusedGroup(groupId)}>

  <GroupTabBar {groupId} {onBrowserClick} {showBrowser} />

  <div class="pane-content" class:hidden={showBrowser}>
    {#if activeTab?.type === 'file'}
      <FileEditor tab={activeTab} {groupId} />
    {:else if activeTab?.type === 'diff'}
      <DiffViewer tab={activeTab} />
    {:else}
      <div class="empty-pane">
        <svg class="empty-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="32" height="32">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
          <polyline points="14 2 14 8 20 8"/>
        </svg>
        <span class="empty-text">Open a file to start editing</span>
      </div>
    {/if}
  </div>
</div>

<style>
  .editor-pane {
    display: flex;
    flex-direction: column;
    flex: 1;
    overflow: hidden;
    min-width: 0;
    min-height: 0;
  }

  .editor-pane.focused {
    /* Focus is shown via the GroupTabBar accent border */
  }

  .pane-content {
    display: flex;
    flex-direction: column;
    flex: 1;
    overflow: hidden;
    min-height: 0;
  }
  .pane-content.hidden {
    display: none;
  }

  .empty-pane {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    flex: 1;
    color: var(--muted);
    gap: 8px;
  }
  .empty-pane .empty-icon {
    opacity: 0.5;
  }
  .empty-pane .empty-text {
    font-size: 13px;
    font-family: var(--font-family);
  }
</style>
