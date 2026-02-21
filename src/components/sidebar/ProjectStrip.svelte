<script>
  import { projectStore } from '../../lib/stores/project.svelte.js';
  import { open } from '@tauri-apps/plugin-dialog';

  let entries = $derived(projectStore.entries);
  let activeIndex = $derived(projectStore.activeIndex);

  /** Context menu state */
  let contextMenu = $state({ visible: false, x: 0, y: 0, index: -1 });

  function handleSelect(i) {
    projectStore.setActive(i);
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
      data-tooltip={entry.name}
      onclick={() => handleSelect(i)}
      oncontextmenu={(e) => handleContextMenu(e, i)}
      aria-label={entry.name}
      style="background: {entry.color};"
    >
      {entry.name.charAt(0).toUpperCase()}
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
    <button class="context-menu-item danger" onclick={handleRemove} role="menuitem">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <polyline points="3 6 5 6 21 6"/>
        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
      </svg>
      Remove
    </button>
  </div>
{/if}

<style>
  .project-strip {
    width: 40px;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
    padding: 6px 0;
    border-right: 1px solid var(--border);
    flex-shrink: 0;
    overflow-y: auto;
    overflow-x: hidden;
  }

  .project-avatar {
    width: 32px;
    height: 32px;
    border-radius: 50%;
    border: none;
    color: #fff;
    font-size: 14px;
    font-weight: 600;
    font-family: var(--font-family);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    transition: all var(--duration-fast) var(--ease-out);
    position: relative;
    border-left: 2px solid transparent;
  }

  .project-avatar:hover {
    opacity: 0.85;
    transform: scale(1.05);
  }

  .project-avatar.active {
    border-left: 2px solid var(--accent);
    border-radius: 8px;
  }

  .project-add {
    width: 32px;
    height: 32px;
    border-radius: 50%;
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
    position: fixed;
    z-index: 10000;
    background: var(--bg-elevated);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    padding: 4px 0;
    min-width: 140px;
    box-shadow: var(--shadow-md);
  }

  .context-menu-item {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 6px 12px;
    background: none;
    border: none;
    color: var(--text);
    font-size: 13px;
    font-family: var(--font-family);
    cursor: pointer;
    text-align: left;
    transition: background var(--duration-fast) var(--ease-out);
  }

  .context-menu-item:hover {
    background: var(--bg-hover);
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
