<script>
  import { onMount } from 'svelte';
  import { listen } from '@tauri-apps/api/event';
  import LensToolbar from './LensToolbar.svelte';
  import DesignToolbar from './DesignToolbar.svelte';
  import FindBar from './FindBar.svelte';
  import HistoryPanel from './HistoryPanel.svelte';
  import DownloadsPanel from './DownloadsPanel.svelte';
  import LensPreview from './LensPreview.svelte';
  import ElementInspector from './ElementInspector.svelte';
  import BrowserTabBar from './BrowserTabBar.svelte';
  import FileTree from './FileTree.svelte';
  import GroupTabBar from './GroupTabBar.svelte';
  import FileEditor from './FileEditor.svelte';
  import DiffViewer from './DiffViewer.svelte';
  import EditorPane from './EditorPane.svelte';
  import DevicePreview from './DevicePreview.svelte';
  import SandboxPreview from './SandboxPreview.svelte';
  import SplitPanel from '../shared/SplitPanel.svelte';
  import ChatPanel from '../chat/ChatPanel.svelte';
  import TerminalTabs from '../terminal/TerminalTabs.svelte';
  import { tabsStore } from '../../lib/stores/tabs.svelte.js';
  import { editorGroupsStore } from '../../lib/stores/editor-groups.svelte.js';
  import { layoutStore } from '../../lib/stores/layout.svelte.js';
  import { lensStore } from '../../lib/stores/lens.svelte.js';
  import { browserTabsStore } from '../../lib/stores/browser-tabs.svelte.js';
  import { browserHistoryStore } from '../../lib/stores/browser-history.svelte.js';
  import { downloadsStore } from '../../lib/stores/downloads.svelte.js';
  import { lensSetVisible, startFileWatching, stopFileWatching, lensCapturePreview, lspShutdown, lensSetZoom, lensGetZoom, designGetElement, lensOpenDevtools, lensCloseDevtools, lensResizeDevtools, lensSetDevtoolsVisible, findDevtoolsUrl, detectDevServers } from '../../lib/api.js';
  import { unwrapResult } from '../../lib/utils.js';
  import { navigationStore } from '../../lib/stores/navigation.svelte.js';
  import { attachmentsStore } from '../../lib/stores/attachments.svelte.js';
  import { projectStore } from '../../lib/stores/project.svelte.js';
  import { lspDiagnosticsStore } from '../../lib/stores/lsp-diagnostics.svelte.js';
  import { devicePreviewStore } from '../../lib/stores/device-preview.svelte.js';
  import { sandboxPreviewStore } from '../../lib/stores/sandbox-preview.svelte.js';
  import { devServerManager } from '../../lib/stores/dev-server-manager.svelte.js';
  import { LSP_EXTENSIONS } from '../../lib/editor-lsp.svelte.js';
  import { setActionHandler } from '../../lib/stores/shortcuts.svelte.js';

  let {
    onSend = () => {},
  } = $props();

  let lensPreviewRef;

  // Split ratios (will be persisted to config later)
  let chatRatio = $state(0.18);             // left column vs center+right
  // chatVerticalRatio removed — pixel agents placeholder removed, chat is full height
  let centerRatio = $state(0.75);           // editor/preview vs terminal
  let previewRatio = $state(0.78);          // center column vs file tree
  let devicePreviewRatio = $state(0.5);    // editor vs device preview
  let appPreviewRatio = $state(0.6);       // editor vs app preview (live app)

  // Sync local ratios → layout store (for workspace state persistence)
  $effect(() => { layoutStore.setChatRatio(chatRatio); });
  $effect(() => { layoutStore.setCenterRatio(centerRatio); });
  $effect(() => { layoutStore.setPreviewRatio(previewRatio); });
  $effect(() => { layoutStore.setDevicePreviewRatio(devicePreviewRatio); });

  // Initialize ratios from layout store on mount (restored workspace state)
  onMount(() => {
    if (layoutStore.chatRatio !== 0.18) chatRatio = layoutStore.chatRatio;
    if (layoutStore.centerRatio !== 0.75) centerRatio = layoutStore.centerRatio;
    if (layoutStore.previewRatio !== 0.78) previewRatio = layoutStore.previewRatio;
    if (layoutStore.devicePreviewRatio !== 0.5) devicePreviewRatio = layoutStore.devicePreviewRatio;
  });

  // Browser is a fixed UI element, not a tab — follows the first (leftmost) group
  let showBrowser = $state(false);
  let inspectorData = $state(null);
  let firstGroupId = $derived(editorGroupsStore.allGroupIds[0]);

  // ── Zoom ──
  const ZOOM_LEVELS = [25, 33, 50, 67, 75, 80, 90, 100, 110, 125, 150, 175, 200];
  let zoomLevel = $state(100);

  function getNextZoom(direction) {
    const current = zoomLevel;
    if (direction === 'in') {
      return ZOOM_LEVELS.find(z => z > current) ?? ZOOM_LEVELS[ZOOM_LEVELS.length - 1];
    } else {
      return [...ZOOM_LEVELS].reverse().find(z => z < current) ?? ZOOM_LEVELS[0];
    }
  }

  async function setZoom(factor) {
    const tabId = browserTabsStore.activeTabId;
    if (!tabId) return;
    try {
      const resp = await lensSetZoom(tabId, factor / 100);
      if (resp?.data?.zoomFactor) {
        zoomLevel = Math.round(resp.data.zoomFactor * 100);
      }
    } catch (err) {
      console.warn('[LensWorkspace] setZoom failed:', err);
    }
  }

  function handleZoomIn() { setZoom(getNextZoom('in')); }
  function handleZoomOut() { setZoom(getNextZoom('out')); }
  function handleZoomReset() { setZoom(100); }

  async function refreshZoomForTab(tabId) {
    if (!tabId) { zoomLevel = 100; return; }
    try {
      const resp = await lensGetZoom(tabId);
      zoomLevel = resp?.data?.zoomFactor ? Math.round(resp.data.zoomFactor * 100) : 100;
    } catch {
      zoomLevel = 100;
    }
  }

  // Listen for lens-zoom CustomEvent dispatched from App.svelte
  $effect(() => {
    function onLensZoom(e) {
      const dir = e.detail;
      if (dir === 'in') handleZoomIn();
      else if (dir === 'out') handleZoomOut();
      else if (dir === 'reset') handleZoomReset();
    }
    window.addEventListener('lens-zoom', onLensZoom);
    return () => window.removeEventListener('lens-zoom', onLensZoom);
  });

  // ── Find on Page ──
  let findBarVisible = $state(false);

  // ── History Panel ──
  let showHistory = $state(false);

  // ── Downloads Panel ──
  let showDownloads = $state(false);

  // ── DevTools Panel (native WebView2) ──
  let showDevtools = $state(false);
  let devtoolsContainerEl = $state(null);
  let devtoolsOpen = $state(false); // tracks whether the native WebView2 is created

  async function toggleDevtools() {
    if (showDevtools) {
      // Close
      showDevtools = false;
      devtoolsOpen = false;
      await lensCloseDevtools().catch(() => {});
    } else {
      // Discover the DevTools URL from the remote debugging port
      const devtoolsUrl = await findDevtoolsUrl();
      if (!devtoolsUrl) {
        console.warn('[LensWorkspace] No DevTools target found on remote debugging port');
        return;
      }
      // Open — show the container first so it gets measured, then create the WebView2
      showDevtools = true;
      // Wait for layout to settle
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
      if (devtoolsContainerEl) {
        const rect = devtoolsContainerEl.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
          try {
            await lensOpenDevtools(devtoolsUrl, rect.left, rect.top, rect.width, rect.height);
            devtoolsOpen = true;
          } catch (err) {
            console.warn('[LensWorkspace] Failed to open DevTools:', err);
            showDevtools = false;
          }
        }
      }
    }
  }

  // Sync DevTools WebView2 position on resize
  $effect(() => {
    if (!devtoolsContainerEl || !devtoolsOpen) return;
    const observer = new ResizeObserver(() => {
      if (!devtoolsContainerEl || !devtoolsOpen) return;
      const rect = devtoolsContainerEl.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        lensResizeDevtools(rect.left, rect.top, rect.width, rect.height).catch(() => {});
      }
    });
    observer.observe(devtoolsContainerEl);
    return () => observer.disconnect();
  });

  // Hide DevTools WebView2 when browser is hidden, show when visible
  $effect(() => {
    if (!devtoolsOpen) return;
    if (!showBrowser) {
      lensSetDevtoolsVisible(false).catch(() => {});
    } else {
      lensSetDevtoolsVisible(true).catch(() => {});
    }
  });

  // Close DevTools when navigating away
  $effect(() => {
    if (!showBrowser && devtoolsOpen) {
      showDevtools = false;
      devtoolsOpen = false;
      lensCloseDevtools().catch(() => {});
    }
  });

  // Freeze WebView2 when History or Downloads panels are open (airspace problem)
  $effect(() => {
    if (showHistory || showDownloads) {
      lensStore.freeze();
    } else {
      lensStore.unfreeze();
    }
  });

  function handleDownloadSettings() {
    navigationStore.setView('settings');
  }

  // Init browser history and downloads stores; destroy on cleanup
  $effect(() => {
    browserHistoryStore.init();
    downloadsStore.init();
    return () => {
      browserHistoryStore.destroy();
      downloadsStore.destroy();
    };
  });

  function toggleFind() {
    findBarVisible = !findBarVisible;
  }

  // Listen for lens-find-toggle CustomEvent dispatched from App.svelte (Ctrl+F in WebView2)
  $effect(() => {
    function onFindToggle() {
      findBarVisible = !findBarVisible;
    }
    window.addEventListener('lens-find-toggle', onFindToggle);
    return () => window.removeEventListener('lens-find-toggle', onFindToggle);
  });

  // Refresh zoom level when active tab changes
  $effect(() => {
    const tabId = browserTabsStore.activeTabId;
    refreshZoomForTab(tabId);
  });

  // ── Element Inspector events ──
  $effect(() => {
    let unlistenSelected;
    let unlistenDeselected;
    let unlistenUrlChanged;

    (async () => {
      unlistenSelected = await listen('element-selected', async () => {
        const result = await designGetElement();
        if (result?.success && result.data) {
          inspectorData = result.data;
        }
      });

      unlistenDeselected = await listen('element-deselected', () => {
        inspectorData = null;
      });

      unlistenUrlChanged = await listen('lens-url-changed', () => {
        inspectorData = null;
      });
    })();

    return () => {
      unlistenSelected?.();
      unlistenDeselected?.();
      unlistenUrlChanged?.();
    };
  });

  $effect(() => {
    if (!lensStore.designMode) {
      inspectorData = null;
    }
  });

  // ── Sandbox start/attach (MCP tools sandbox_start / sandbox_attach) ──
  // The backend emits these after the in-app agent calls the tool. `start`
  // launches the agent's project with a safe CDP port (we run detection + the
  // dev-server lifecycle here, which injects the debug port + registers the
  // active sandbox; the syncAuto effect then opens the preview). `attached`
  // opens the preview directly for an app the agent launched itself.
  $effect(() => {
    let unlistenStart;
    let unlistenAttached;

    (async () => {
      unlistenStart = await listen('sandbox-start-request', async (e) => {
        const path = e?.payload?.path || projectStore.root || projectStore.activeProject?.path;
        if (!path) {
          console.warn('[sandbox] start requested but no project path available');
          return;
        }
        try {
          const result = await detectDevServers(path);
          /** @type {{ servers?: any[], packageManager?: string }} */
          const data = unwrapResult(result) || {};
          const servers = Array.isArray(data.servers) ? data.servers : [];
          // Prefer a Tauri app (CDP-driveable); else the first detected server.
          const target =
            servers.find((s) => (s.framework || '').toLowerCase() === 'tauri') || servers[0];
          if (target) {
            devServerManager.startServer(target, path, data.packageManager);
          } else {
            console.warn('[sandbox] start: no dev server detected in', path);
          }
        } catch (err) {
          console.warn('[sandbox] start failed:', err);
        }
      });

      unlistenAttached = await listen('sandbox-attached', (e) => {
        const port = e?.payload?.port;
        if (port) {
          showBrowser = false;
          sandboxPreviewStore.open(port, { attached: true });
        }
      });
    })();

    return () => {
      unlistenStart?.();
      unlistenAttached?.();
    };
  });

  // Track drag state to suppress stop-sign cursor across the workspace
  let fileTreeDragging = $state(false);
  let tabDragging = $state(false);
  let anyDragging = $derived(fileTreeDragging || tabDragging);
  // Workspace-level ancestor drop zone (full-width top/bottom overlays)
  let ancestorDropZone = $state(null);

  $effect(() => {
    const onStart = () => { fileTreeDragging = true; };
    const onEnd = () => { fileTreeDragging = false; ancestorDropZone = null; };
    window.addEventListener('file-tree-drag-start', onStart);
    window.addEventListener('file-tree-drag-end', onEnd);
    return () => {
      window.removeEventListener('file-tree-drag-start', onStart);
      window.removeEventListener('file-tree-drag-end', onEnd);
    };
  });

  $effect(() => {
    const onStart = () => { tabDragging = true; };
    const onEnd = () => { tabDragging = false; ancestorDropZone = null; };
    window.addEventListener('tab-drag-start', onStart);
    window.addEventListener('tab-drag-end', onEnd);
    return () => {
      window.removeEventListener('tab-drag-start', onStart);
      window.removeEventListener('tab-drag-end', onEnd);
    };
  });

  /** Handle seam dragover — detect top/bottom half and show ancestor overlay */
  function handleSeamDragOver(e, seamDirection) {
    if (!anyDragging) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = tabDragging ? 'move' : 'copy';

    // For a horizontal seam (between left/right panes), detect top vs bottom half
    if (seamDirection === 'horizontal') {
      const rect = e.currentTarget.getBoundingClientRect();
      const y = (e.clientY - rect.top) / rect.height;
      ancestorDropZone = y > 0.5 ? 'bottom' : 'top';
    } else {
      const rect = e.currentTarget.getBoundingClientRect();
      const x = (e.clientX - rect.left) / rect.width;
      ancestorDropZone = x > 0.5 ? 'right' : 'left';
    }
  }

  function handleSeamDragLeave(e) {
    if (!e.currentTarget.contains(e.relatedTarget)) {
      ancestorDropZone = null;
    }
  }

  /** Handle drop on seam — create full-width/height ancestor split */
  function handleSeamDrop(e) {
    e.preventDefault();
    e.stopPropagation();

    const zone = ancestorDropZone;
    ancestorDropZone = null;
    if (!zone) return;

    // Try tab data first
    const tabRaw = e.dataTransfer.getData('application/x-voice-mirror-tab');
    if (tabRaw) {
      let tabData;
      try { tabData = JSON.parse(tabRaw); } catch { return; }
      if (!tabData?.tabId) return;

      const dir = (zone === 'top' || zone === 'bottom') ? 'vertical' : 'horizontal';
      const before = (zone === 'top' || zone === 'left') ? 'before' : undefined;
      const newId = editorGroupsStore.splitAncestor(editorGroupsStore.focusedGroupId, dir, before);
      tabsStore.moveTab(tabData.tabId, newId);
      window.dispatchEvent(new CustomEvent('tab-drag-end'));
      return;
    }

    // Fall through to file-tree data
    let raw = e.dataTransfer.getData('application/x-voice-mirror-file');
    if (!raw) return;

    let data;
    try { data = JSON.parse(raw); } catch { return; }
    if (data?.type !== 'file-tree' || !data.entry?.path) return;

    const dir = (zone === 'top' || zone === 'bottom') ? 'vertical' : 'horizontal';
    const before = (zone === 'top' || zone === 'left') ? 'before' : undefined;
    const newId = editorGroupsStore.splitAncestor(editorGroupsStore.focusedGroupId, dir, before);
    tabsStore.openFile(data.entry, newId);
    window.dispatchEvent(new CustomEvent('file-tree-drag-end'));
  }

  // Memoized project root path — $derived compares by value (Object.is),
  // so effects using this only re-trigger when the actual path string changes,
  // not when unrelated entry fields (lastBrowserUrl, etc.) are mutated.
  let projectRoot = $derived(projectStore.root);

  // Derive active file info for FileTree highlighting
  let focusedGroupId = $derived(editorGroupsStore.focusedGroupId);
  let focusedActiveTabId = $derived(editorGroupsStore.groups.get(focusedGroupId)?.activeTabId);
  let activeTab = $derived(focusedActiveTabId ? tabsStore.tabs.find(t => t.id === focusedActiveTabId) : null);
  let isFile = $derived(activeTab?.type === 'file');
  let isDiff = $derived(activeTab?.type === 'diff');
  let activeExt = $derived(activeTab?.path?.split('.').pop()?.toLowerCase());

  // Toggle browser webview visibility
  $effect(() => {
    if (!lensStore.webviewReady) return;
    lensSetVisible(showBrowser).catch(() => {});
  });

  // ── Sandbox live preview auto-open ──
  // When Voice Mirror has a running Tauri app with CDP enabled, auto-open the
  // live preview ONCE (per launch) so you see the real app window at true size.
  // The dedupe guard + user-hide handling live INSIDE the store (syncAuto), so a
  // remount of this component can't re-fire open() and pop the panel back up
  // after the user hid it (the old component-local `lastSandboxPort` bug).
  $effect(() => {
    let activeCdp = null;
    for (const [, s] of devServerManager.servers) {
      if (s?.cdpPort && (s.status === 'running' || s.status === 'idle')) {
        activeCdp = s.cdpPort;
        break;
      }
    }
    sandboxPreviewStore.syncAuto(activeCdp);
  });

  // The App Preview is a DOM panel; the native Lens browser WebView2 would paint
  // OVER it (airspace). So they're mutually exclusive: while the App Preview is
  // visible, hide the browser — editor on the left, live app on the right.
  $effect(() => {
    if (sandboxPreviewStore.visible) {
      showBrowser = false;
    }
  });

  // The MAXIMIZED App Preview is a full overlay over the editor. So when the user
  // focuses a different editor tab (opening a file from the tree/search, or clicking
  // an open tab), surface the editor by dropping the overlay (re-openable via the App
  // button). Only acts on a real tab CHANGE — not on mount, and not when toggling the
  // App/maximize buttons (those don't change the active tab), so it never fights them.
  let lastFocusedTabId;
  let tabRevealArmed = false;
  $effect(() => {
    const id = focusedActiveTabId;
    if (!tabRevealArmed) {
      tabRevealArmed = true;
      lastFocusedTabId = id;
      return;
    }
    if (id !== lastFocusedTabId) {
      lastFocusedTabId = id;
      if (id && sandboxPreviewStore.visible && sandboxPreviewStore.maximized) {
        sandboxPreviewStore.hide();
      }
    }
  });

  // Toggle the App Preview, making it mutually exclusive with the Browser.
  function toggleAppPreview() {
    if (sandboxPreviewStore.visible) {
      sandboxPreviewStore.hide();
    } else {
      showBrowser = false;
      sandboxPreviewStore.show();
    }
  }

  // Start/stop file watcher when entering Lens mode or switching projects.
  // Uses memoized projectRoot so unrelated entry mutations don't churn the watcher.
  $effect(() => {
    const path = projectRoot;
    if (!path) return;

    startFileWatching(path).catch((err) => {
      console.warn('[LensWorkspace] Failed to start file watcher:', err);
    });

    return () => {
      stopFileWatching().catch(() => {});
    };
  });

  /** Capture the annotated browser screenshot and add it as a chat attachment. */
  async function handleDesignSend() {
    try {
      const result = await lensCapturePreview();
      if (result?.success && result?.data) {
        attachmentsStore.add({
          path: result.data.path,
          dataUrl: result.data.dataUrl,
          type: 'image/png',
          name: 'Design Annotation',
        });
      } else {
        console.warn('[LensWorkspace] Design capture failed:', result?.error || result);
      }
    } catch (err) {
      console.error('[LensWorkspace] Design capture error:', err);
    }
    lensStore.setDesignMode(false);
  }

  /** Handle element selection from design toolbar — queue screenshot + context as pending attachment. */
  function handleElementSend({ imageDataUrl, contextText, name }) {
    // Queue the element capture as a pending attachment with hidden context
    attachmentsStore.add({
      path: 'element-capture',
      dataUrl: imageDataUrl,
      type: 'image/png',
      name: name || 'Selected Element',
      context: contextText,
    });

    // Ensure chat panel is visible and focus the input
    layoutStore.setShowChat(true);
    lensStore.setDesignMode(false);

    // Focus the chat input so the user can immediately type their instruction
    requestAnimationFrame(() => {
      const textarea = document.querySelector('.chat-input-bar textarea');
      if (textarea) /** @type {HTMLElement} */(textarea).focus();
    });
  }

  // Start/stop LSP diagnostics store listener on project switch.
  // Uses memoized projectRoot so unrelated entry mutations don't restart LSP.
  $effect(() => {
    const path = projectRoot;
    if (!path) return;

    // Shut down LSP servers from previous project before starting new ones
    lspShutdown().catch(() => {});

    lspDiagnosticsStore.clear();
    lspDiagnosticsStore.startListening(path).catch((err) => {
      console.warn('[LensWorkspace] Failed to start diagnostics listener:', err);
    });

    return () => {
      lspDiagnosticsStore.stopListening();
    };
  });

  // ── Action handlers for split-editor shortcuts ──
  onMount(() => {
    setActionHandler('split-editor', () => {
      if (editorGroupsStore.hasSplit) {
        // Close the focused group (if not group 1)
        if (editorGroupsStore.focusedGroupId !== 1) {
          editorGroupsStore.closeGroup(editorGroupsStore.focusedGroupId);
        }
      } else {
        const fId = editorGroupsStore.focusedGroupId;
        const focusedActiveTab = tabsStore.getActiveTabForGroup
          ? tabsStore.tabs.find(t => t.id === (editorGroupsStore.groups.get(fId)?.activeTabId))
          : tabsStore.activeTab;
        if (focusedActiveTab) {
          const newGroupId = editorGroupsStore.splitGroup(fId, 'horizontal');
          tabsStore.openFile({ name: focusedActiveTab.title, path: focusedActiveTab.path }, newGroupId);
        }
      }
    });

    setActionHandler('focus-group-1', () => editorGroupsStore.setFocusedGroup(1));
    setActionHandler('focus-group-2', () => {
      const ids = editorGroupsStore.allGroupIds;
      if (ids.length >= 2) editorGroupsStore.setFocusedGroup(ids[1]);
    });

    // Directional focus (Ctrl+K Ctrl+Arrow)
    setActionHandler('focus-group-left', () => editorGroupsStore.focusDirection('left'));
    setActionHandler('focus-group-right', () => editorGroupsStore.focusDirection('right'));
    setActionHandler('focus-group-up', () => editorGroupsStore.focusDirection('up'));
    setActionHandler('focus-group-down', () => editorGroupsStore.focusDirection('down'));

    // Even sizes (Ctrl+K Ctrl+=)
    setActionHandler('even-editor-sizes', () => editorGroupsStore.evenSizes());

    // Maximize group (Ctrl+K Ctrl+M)
    setActionHandler('maximize-editor-group', () => editorGroupsStore.toggleMaximize());
  });
</script>

{#snippet renderNode(node)}
  {#if node.type === 'leaf'}
    <EditorPane groupId={node.groupId} showBrowser={node.groupId === firstGroupId ? showBrowser : false} onBrowserClick={node.groupId === firstGroupId ? () => { showBrowser = !showBrowser; if (showBrowser) sandboxPreviewStore.hide(); } : null} onDevicePreviewClick={node.groupId === firstGroupId ? () => { devicePreviewStore.toggle(); } : null} showDevicePreview={node.groupId === firstGroupId ? devicePreviewStore.isOpen : false} onAppPreviewClick={node.groupId === firstGroupId && sandboxPreviewStore.active ? toggleAppPreview : null} showAppPreview={node.groupId === firstGroupId ? sandboxPreviewStore.visible : false} />
  {:else}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="grid-branch" class:horizontal={node.direction === 'horizontal'} class:vertical={node.direction === 'vertical'}>
      <SplitPanel direction={node.direction} bind:ratio={node.ratio} minA={150} minB={150}>
        {#snippet panelA()}
          {@render renderNode(node.children[0])}
        {/snippet}
        {#snippet panelB()}
          {@render renderNode(node.children[1])}
        {/snippet}
      </SplitPanel>
      <!-- Seam drop zone: invisible overlay on the divider, active during file-tree drags -->
      {#if anyDragging}
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div
          class="seam-drop-zone"
          class:horizontal={node.direction === 'horizontal'}
          class:vertical={node.direction === 'vertical'}
          style={node.direction === 'horizontal'
            ? `left: calc(${node.ratio * 100}% - 20px); width: 40px; top: 0; bottom: 0;`
            : `top: calc(${node.ratio * 100}% - 20px); height: 40px; left: 0; right: 0;`}
          ondragover={(e) => handleSeamDragOver(e, node.direction)}
          ondragleave={handleSeamDragLeave}
          ondrop={handleSeamDrop}
        ></div>
      {/if}
    </div>
  {/if}
{/snippet}



<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="lens-workspace" ondragover={(e) => { if (anyDragging) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; } }}>
  <div class="workspace-content">
    <!-- Horizontal split: left-column (chat) | center+right -->
    <SplitPanel direction="horizontal" bind:ratio={chatRatio} minA={180} minB={400} collapseA={!layoutStore.showChat}>
      {#snippet panelA()}
        <!-- Left column: chat (full height) -->
        <div class="chat-area">
          <ChatPanel {onSend} />
        </div>
      {/snippet}
      {#snippet panelB()}
        <!-- Horizontal split: center-column | file tree -->
        <SplitPanel direction="horizontal" bind:ratio={previewRatio} minA={300} minB={140} collapseB={!layoutStore.showFileTree}>
          {#snippet panelA()}
            <!-- Center column: editor/preview (top) | terminal (bottom) -->
            <SplitPanel direction="vertical" bind:ratio={centerRatio} minA={200} minB={80} collapseB={!layoutStore.showTerminal}>
              {#snippet panelA()}
                <div class="preview-area">
                 <SplitPanel direction="horizontal" bind:ratio={appPreviewRatio} minA={300} minB={240} collapseB={!sandboxPreviewStore.visible || sandboxPreviewStore.maximized}>
                  {#snippet panelA()}
                  <SplitPanel direction="horizontal" bind:ratio={devicePreviewRatio} minA={300} minB={200} collapseB={!devicePreviewStore.isOpen}>
                    {#snippet panelA()}
                      <div class="editor-with-browser">
                        <!-- Editor Grid: always visible so GroupTabBar stays accessible -->
                        <div class="editor-grid">
                          {#if editorGroupsStore.maximizedGroupId !== null}
                            <EditorPane groupId={editorGroupsStore.maximizedGroupId} showBrowser={editorGroupsStore.maximizedGroupId === firstGroupId ? showBrowser : false} onBrowserClick={editorGroupsStore.maximizedGroupId === firstGroupId ? () => { showBrowser = !showBrowser; if (showBrowser) sandboxPreviewStore.hide(); } : null} onDevicePreviewClick={editorGroupsStore.maximizedGroupId === firstGroupId ? () => { devicePreviewStore.toggle(); } : null} showDevicePreview={editorGroupsStore.maximizedGroupId === firstGroupId ? devicePreviewStore.isOpen : false} onAppPreviewClick={editorGroupsStore.maximizedGroupId === firstGroupId && sandboxPreviewStore.active ? toggleAppPreview : null} showAppPreview={editorGroupsStore.maximizedGroupId === firstGroupId ? sandboxPreviewStore.visible : false} />
                          {:else}
                            {@render renderNode(editorGroupsStore.gridRoot)}
                          {/if}
                          <!-- Workspace-level drop zone overlay for full-width ancestor splits -->
                          {#if ancestorDropZone}
                            <div class="ancestor-drop-overlay">
                              <div class="ancestor-zone" class:top={ancestorDropZone === 'top'} class:bottom={ancestorDropZone === 'bottom'} class:left={ancestorDropZone === 'left'} class:right={ancestorDropZone === 'right'}></div>
                            </div>
                          {/if}
                        </div>

                        <!-- Browser layer: overlays editor content when visible (tab bar stays above) -->
                        <div class="preview-layer" class:visible={showBrowser}>
                          <BrowserTabBar onNewTab={() => lensPreviewRef?.createNewTab()} />
                          <LensToolbar
                            {zoomLevel}
                            onZoomIn={handleZoomIn}
                            onZoomOut={handleZoomOut}
                            onZoomReset={handleZoomReset}
                            onHistory={() => showHistory = true}
                            onDownloads={() => showDownloads = true}
                            onDownloadSettings={handleDownloadSettings}
                            onDevtools={toggleDevtools}
                            devtoolsActive={showDevtools}
                          />
                          {#if lensStore.designMode}
                            <DesignToolbar
                              onSend={handleDesignSend}
                              onElementSend={handleElementSend}
                              onClose={() => lensStore.setDesignMode(false)}
                            />
                          {/if}
                          <FindBar visible={findBarVisible} onClose={() => { findBarVisible = false; }} />
                          <div class="browser-with-inspector">
                            <LensPreview bind:this={lensPreviewRef} />
                            {#if inspectorData}
                              <ElementInspector
                                elementData={inspectorData}
                                onClose={() => { inspectorData = null; }}
                                onUpdateData={(data) => { inspectorData = data; }}
                              />
                            {/if}
                            {#if showDevtools}
                              <div class="devtools-container" bind:this={devtoolsContainerEl}></div>
                            {/if}
                          </div>
                          {#if showHistory}
                            <HistoryPanel onClose={() => showHistory = false} />
                          {/if}
                          {#if showDownloads}
                            <DownloadsPanel onClose={() => showDownloads = false} />
                          {/if}
                        </div>

                        <!-- App Preview layer (maximized mode): fills the same
                             center region as the Browser overlay. Safe as a plain
                             DOM overlay because the live app is an <img> MJPEG
                             stream (no native WebView2 airspace). Mutually
                             exclusive with the Browser. -->
                        <div class="preview-layer app-preview-layer" class:visible={sandboxPreviewStore.visible && sandboxPreviewStore.maximized}>
                          {#if sandboxPreviewStore.maximized}
                            <SandboxPreview />
                          {/if}
                        </div>
                      </div>
                    {/snippet}
                    {#snippet panelB()}
                      <DevicePreview />
                    {/snippet}
                  </SplitPanel>
                  {/snippet}
                  {#snippet panelB()}
                    <!-- App Preview (restored / side-panel mode): a real,
                         resizable panel beside the editor (the live app via WGC).
                         When maximized, it renders as a center overlay instead
                         (see .app-preview-layer below), so only mount one. -->
                    {#if !sandboxPreviewStore.maximized}
                      <SandboxPreview />
                    {/if}
                  {/snippet}
                 </SplitPanel>
                </div>
              {/snippet}
              {#snippet panelB()}
                <div class="terminal-area">
                  <TerminalTabs />
                </div>
              {/snippet}
            </SplitPanel>
          {/snippet}
          {#snippet panelB()}
            <FileTree
              onFileClick={(entry) => { showBrowser = false; tabsStore.openFile(entry, editorGroupsStore.focusedGroupId); }}
              onOpenToSide={(entry) => { showBrowser = false; tabsStore.openFileToSide(entry); }}
              onFileDblClick={(entry) => tabsStore.pinTab(entry.path)}
              onChangeClick={(change) => tabsStore.openDiff(change)}
              onChangeDblClick={(change) => tabsStore.pinTab(`diff:${change.path}`)}
              activeFilePath={isFile ? activeTab?.path : null}
              activeDiffPath={isDiff ? activeTab?.path : null}
              activeFileHasLsp={isFile && LSP_EXTENSIONS.has(activeExt)}
              onSymbolClick={({ line, character }) => {
                const gId = editorGroupsStore.focusedGroupId;
                const event = new CustomEvent(`lens-goto-position-${gId}`, { detail: { line, character } });
                window.dispatchEvent(event);
              }}
            />
          {/snippet}
        </SplitPanel>
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

  /* -- Workspace Content -- */

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


  .editor-with-browser {
    display: flex;
    flex-direction: column;
    height: 100%;
    overflow: hidden;
    position: relative;
  }

  /* Editor grid: recursive SplitPanel tree — always visible for GroupTabBar */
  .editor-grid {
    display: flex;
    flex: 1;
    overflow: hidden;
    position: relative;
  }

  /* Workspace-level drop zone overlay for full-width ancestor splits */
  .ancestor-drop-overlay {
    position: absolute;
    inset: 0;
    z-index: 10000;
    pointer-events: none;
  }

  .ancestor-zone {
    position: absolute;
    left: 8px;
    right: 8px;
    height: calc(50% - 12px);
    background: color-mix(in srgb, var(--accent) 20%, transparent);
    border: 2px dashed var(--accent);
    border-radius: 4px;
    opacity: 1;
    transition: opacity 70ms ease-out;
  }

  .ancestor-zone.bottom {
    bottom: 8px;
  }

  .ancestor-zone.top {
    top: 8px;
  }

  .ancestor-zone.left {
    top: 8px;
    bottom: 8px;
    left: 8px;
    right: auto;
    height: auto;
    width: calc(50% - 12px);
  }

  .ancestor-zone.right {
    top: 8px;
    bottom: 8px;
    right: 8px;
    left: auto;
    height: auto;
    width: calc(50% - 12px);
  }

  /* Grid branch wrapper — needed for seam drop zone positioning */
  .grid-branch {
    display: flex;
    flex: 1;
    position: relative;
    min-width: 0;
    min-height: 0;
    overflow: hidden;
  }

  /* Seam drop zone: invisible overlay on the SplitPanel divider */
  .seam-drop-zone {
    position: absolute;
    z-index: 9999;
    pointer-events: auto;
  }

  /* Browser layer: overlays editor content below the tab bars */
  .preview-layer {
    display: none;
    flex-direction: column;
    position: absolute;
    top: 36px;  /* below GroupTabBar height */
    left: 0;
    right: 0;
    bottom: 0;
    z-index: 10;
  }

  .preview-layer.visible {
    display: flex;
  }

  /* App Preview overlay shares the Browser's center region; sits just above it
     (they're mutually exclusive, so this is only belt-and-braces). */
  .app-preview-layer {
    z-index: 11;
  }

  /* Editor pane styles are in EditorPane.svelte */

  /* -- Chat Panel -- */

  .chat-area {
    display: flex;
    flex-direction: column;
    height: 100%;
    overflow: hidden;
    background: var(--bg);
  }

  /* -- Terminal Panel -- */

  .terminal-area {
    display: flex;
    flex-direction: column;
    height: 100%;
    overflow: hidden;
    background: var(--bg);
  }

  .browser-with-inspector {
    display: flex;
    flex: 1;
    min-height: 0;
    overflow: hidden;
  }

  .browser-with-inspector :global(.lens-preview) {
    flex: 1;
    min-width: 0;
  }

  .devtools-container {
    width: 45%;
    min-width: 300px;
    height: 100%;
    /* Native WebView2 renders here — this div is just a positioning placeholder */
  }

</style>
