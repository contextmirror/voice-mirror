/**
 * layout.svelte.js -- Panel visibility and split ratio state for Lens workspace.
 *
 * Shared between TitleBar (toggle buttons), LensWorkspace (conditional rendering
 * and split sizes), and workspace-state (persistence).
 */

function createLayoutStore() {
  let showChat = $state(true);
  let showTerminal = $state(true);
  let showFileTree = $state(true);

  // Split ratios (previously local to LensWorkspace.svelte)
  let chatRatio = $state(0.18);
  let centerRatio = $state(0.75);
  let previewRatio = $state(0.78);
  let devicePreviewRatio = $state(0.5);

  return {
    get showChat() { return showChat; },
    get showTerminal() { return showTerminal; },
    get showFileTree() { return showFileTree; },
    get chatRatio() { return chatRatio; },
    get centerRatio() { return centerRatio; },
    get previewRatio() { return previewRatio; },
    get devicePreviewRatio() { return devicePreviewRatio; },

    setShowChat(v) { showChat = v; },
    setShowTerminal(v) { showTerminal = v; },
    setShowFileTree(v) { showFileTree = v; },
    setChatRatio(v) { chatRatio = v; },
    setCenterRatio(v) { centerRatio = v; },
    setPreviewRatio(v) { previewRatio = v; },
    setDevicePreviewRatio(v) { devicePreviewRatio = v; },

    toggleChat() { showChat = !showChat; },
    toggleTerminal() { showTerminal = !showTerminal; },
    toggleFileTree() { showFileTree = !showFileTree; },

    /**
     * Serialize layout state for persistence.
     * @returns {Object}
     */
    serialize() {
      return {
        showChat,
        showTerminal,
        showFileTree,
        chatRatio,
        centerRatio,
        previewRatio,
        devicePreviewRatio,
      };
    },

    /**
     * Restore layout state from persisted data.
     * @param {Object} data
     */
    restore(data) {
      if (!data) return;
      if (typeof data.showChat === 'boolean') showChat = data.showChat;
      if (typeof data.showTerminal === 'boolean') showTerminal = data.showTerminal;
      if (typeof data.showFileTree === 'boolean') showFileTree = data.showFileTree;
      if (typeof data.chatRatio === 'number') chatRatio = data.chatRatio;
      if (typeof data.centerRatio === 'number') centerRatio = data.centerRatio;
      if (typeof data.previewRatio === 'number') previewRatio = data.previewRatio;
      if (typeof data.devicePreviewRatio === 'number') devicePreviewRatio = data.devicePreviewRatio;
    },
  };
}

export const layoutStore = createLayoutStore();
