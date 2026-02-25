<script>
  import { tabsStore } from '../../lib/stores/tabs.svelte.js';
  import { editorGroupsStore } from '../../lib/stores/editor-groups.svelte.js';
  import GroupTabBar from './GroupTabBar.svelte';
  import FileEditor from './FileEditor.svelte';
  import DiffViewer from './DiffViewer.svelte';
  import DropZoneOverlay from './DropZoneOverlay.svelte';

  let { groupId = 1, showBrowser = false, onBrowserClick = null } = $props();

  let activeTabId = $derived(editorGroupsStore.groups.get(groupId)?.activeTabId);
  let activeTab = $derived(activeTabId ? tabsStore.tabs.find(t => t.id === activeTabId) : null);

  let fileTreeDragActive = $state(false);
  let dragOverThis = $state(false);
  let dropZone = $state('center');
  let paneEl;

  const EDGE_THRESHOLD = 0.22;

  $effect(() => {
    function onDragStart() {
      fileTreeDragActive = true;
    }
    function onDragEnd() {
      fileTreeDragActive = false;
      dragOverThis = false;
    }
    window.addEventListener('file-tree-drag-start', onDragStart);
    window.addEventListener('file-tree-drag-end', onDragEnd);
    return () => {
      window.removeEventListener('file-tree-drag-start', onDragStart);
      window.removeEventListener('file-tree-drag-end', onDragEnd);
    };
  });

  function detectZone(e) {
    if (!paneEl) return 'center';
    const rect = paneEl.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return 'center';
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;
    if (x < EDGE_THRESHOLD) return 'left';
    if (x > 1 - EDGE_THRESHOLD) return 'right';
    if (y < EDGE_THRESHOLD) return 'top';
    if (y > 1 - EDGE_THRESHOLD) return 'bottom';
    return 'center';
  }

  function handleDragOver(e) {
    if (!fileTreeDragActive) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    dragOverThis = true;
    dropZone = detectZone(e);
  }

  function handleDragLeave(e) {
    if (!paneEl?.contains(e.relatedTarget)) {
      dragOverThis = false;
    }
  }

  function handleDrop(e) {
    e.preventDefault();
    dragOverThis = false;

    let raw = e.dataTransfer.getData('application/x-voice-mirror-file');
    if (!raw) raw = e.dataTransfer.getData('text/plain');
    if (!raw) return;

    let data;
    try { data = JSON.parse(raw); } catch { return; }
    if (data?.type !== 'file-tree' || !data.entry?.path) return;

    const zone = detectZone(e);
    const entry = data.entry;

    if (zone === 'center') {
      tabsStore.openFile(entry, groupId);
    } else if (zone === 'right') {
      const newId = editorGroupsStore.splitGroup(groupId, 'horizontal');
      tabsStore.openFile(entry, newId);
    } else if (zone === 'left') {
      const newId = editorGroupsStore.splitGroup(groupId, 'horizontal');
      tabsStore.openFile(entry, newId);
      editorGroupsStore.swapChildren(groupId);
    } else if (zone === 'bottom') {
      const newId = editorGroupsStore.splitGroup(groupId, 'vertical');
      tabsStore.openFile(entry, newId);
    } else if (zone === 'top') {
      const newId = editorGroupsStore.splitGroup(groupId, 'vertical');
      tabsStore.openFile(entry, newId);
      editorGroupsStore.swapChildren(groupId);
    }

    window.dispatchEvent(new CustomEvent('file-tree-drag-end'));
  }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="editor-pane"
     class:focused={editorGroupsStore.focusedGroupId === groupId}
     bind:this={paneEl}
     onclick={() => editorGroupsStore.setFocusedGroup(groupId)}
     ondragover={handleDragOver}
     ondragleave={handleDragLeave}
     ondrop={handleDrop}>

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

  <DropZoneOverlay active={dragOverThis} zone={dropZone} />
</div>

<style>
  .editor-pane {
    display: flex;
    flex-direction: column;
    flex: 1;
    overflow: hidden;
    min-width: 0;
    min-height: 0;
    position: relative;
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
