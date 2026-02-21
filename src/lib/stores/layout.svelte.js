/**
 * layout.svelte.js -- Panel visibility state for Lens workspace.
 *
 * Shared between TitleBar (toggle buttons) and LensWorkspace (conditional rendering).
 */

function createLayoutStore() {
  let showChat = $state(true);
  let showTerminal = $state(true);
  let showFileTree = $state(true);

  return {
    get showChat() { return showChat; },
    get showTerminal() { return showTerminal; },
    get showFileTree() { return showFileTree; },

    toggleChat() { showChat = !showChat; },
    toggleTerminal() { showTerminal = !showTerminal; },
    toggleFileTree() { showFileTree = !showFileTree; },
  };
}

export const layoutStore = createLayoutStore();
