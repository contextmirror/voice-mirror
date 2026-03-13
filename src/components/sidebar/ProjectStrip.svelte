<script>
  import { projectStore } from '../../lib/stores/project.svelte.js';
  import { open } from '@tauri-apps/plugin-dialog';
  import EditProjectModal from './EditProjectModal.svelte';

  let entries = $derived(projectStore.entries);
  let activeIndex = $derived(projectStore.activeIndex);
  let iconCache = $derived(projectStore.iconCache);

  /** Context menu state */
  let contextMenu = $state({ visible: false, x: 0, y: 0, index: -1 });

  /** Edit modal state */
  let editingIndex = $state(-1);
  let showEditModal = $derived(editingIndex >= 0);

  async function handleSelect(i) {
    await projectStore.setActive(i);
  }

  async function handleAdd() {
    const selected = await open({ directory: true });
    if (selected) projectStore.addProject(selected);
  }

  function handleContextMenu(event, i) {
    event.preventDefault();
    contextMenu = { visible: true, x: event.clientX, y: event.clientY, index: i };
  }

  function hideContextMenu() {
    contextMenu = { visible: false, x: 0, y: 0, index: -1 };
  }

  function handleEdit() {
    editingIndex = contextMenu.index;
    hideContextMenu();
  }

  function handleRemove() {
    const i = contextMenu.index;
    hideContextMenu();
    if (i >= 0) projectStore.removeProject(i);
  }

  function handleDocumentClick() {
    if (contextMenu.visible) hideContextMenu();
  }

  function handleDocumentKeydown(e) {
    if (e.key === 'Escape' && contextMenu.visible) hideContextMenu();
  }
</script>

<svelte:document onclick={handleDocumentClick} onkeydown={handleDocumentKeydown} />

<div class="project-strip">
  {#each entries as entry, i}
    <button
      class="project-avatar"
      class:active={i === activeIndex}
      title="{entry.name} — {entry.path}"
      onclick={() => handleSelect(i)}
      oncontextmenu={(e) => handleContextMenu(e, i)}
      aria-label={entry.name}
      style="background: {entry.icon && iconCache[entry.icon] ? 'transparent' : entry.color};"
    >
      {#if entry.icon && iconCache[entry.icon]}
        <img src={iconCache[entry.icon]} alt={entry.name} class="avatar-icon" />
      {:else}
        {entry.name.charAt(0).toUpperCase()}
      {/if}
    </button>
  {/each}

  <button
    class="project-add"
    onclick={handleAdd}
    aria-label="Add project"
    data-tooltip="Add project"
  >+</button>
</div>

{#if contextMenu.visible}
  <div
    class="context-menu"
    style="left: {contextMenu.x}px; top: {contextMenu.y}px;"
    role="menu"
  >
    <button class="context-menu-item" onclick={handleEdit} role="menuitem">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
        <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
      </svg>
      Edit
    </button>
    <button class="context-menu-item danger" onclick={handleRemove} role="menuitem">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <polyline points="3 6 5 6 21 6"/>
        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
      </svg>
      Remove
    </button>
  </div>
{/if}

{#if showEditModal}
  <EditProjectModal
    projectIndex={editingIndex}
    onClose={() => { editingIndex = -1; }}
  />
{/if}

<style>
  @import '../../styles/context-menu.css';

  .project-strip {
    width: 54px;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    padding: 8px 0;
    border-right: 1px solid var(--border);
    flex-shrink: 0;
    overflow-y: auto;
    overflow-x: hidden;
  }

  .project-avatar {
    width: 40px;
    height: 40px;
    border-radius: 10px;
    border: 2px solid transparent;
    color: #fff;
    font-size: 18px;
    font-weight: 700;
    font-family: var(--font-family);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    transition: all var(--duration-fast) var(--ease-out);
    position: relative;
    padding: 0;
    overflow: hidden;
  }

  .avatar-icon {
    width: 100%;
    height: 100%;
    object-fit: cover;
    border-radius: 8px;
  }

  .project-avatar:hover {
    border-color: var(--border);
    background-color: var(--bg-hover);
  }

  .project-avatar.active {
    border-color: var(--text);
  }

  .project-add {
    width: 40px;
    height: 40px;
    border-radius: 10px;
    border: 1px dashed var(--muted);
    background: transparent;
    color: var(--muted);
    font-size: 18px;
    font-family: var(--font-family);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    transition: all var(--duration-fast) var(--ease-out);
  }

  .project-add:hover {
    border-color: var(--accent);
    color: var(--accent);
    background: var(--bg-hover);
  }

  /* Context Menu */

  .context-menu {
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-md);
  }

  .context-menu-item {
    gap: 8px;
    font-size: 13px;
    transition: background var(--duration-fast) var(--ease-out);
  }

  .context-menu-item:hover {
    background: var(--bg-hover);
    color: var(--text);
  }

  .context-menu-item.danger:hover {
    background: var(--danger-subtle);
    color: var(--danger);
  }

  .context-menu-item svg {
    width: 14px;
    height: 14px;
    flex-shrink: 0;
  }

  @media (prefers-reduced-motion: reduce) {
    .project-avatar,
    .project-add,
    .context-menu-item {
      transition: none;
    }
    .project-avatar:hover {
      transform: none;
    }
  }
</style>
