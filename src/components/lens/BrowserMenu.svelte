<script>
  import { lensEvalTabJs } from '../../lib/api.js';
  import { browserTabsStore } from '../../lib/stores/browser-tabs.svelte.js';

  const SHORTCUT_BASE = 'https://lens-shortcut.localhost/';

  let {
    zoomLevel = 100,
    onZoomIn,
    onZoomOut,
    onZoomReset,
    onDownloads,
    onHistory,
    onDownloadSettings,
  } = $props();

  let open = $state(false);
  let triggerEl = $state(null);

  // Map of shortcut actions → callbacks
  const actionMap = {
    'menu-zoom-in': () => { onZoomIn?.(); },
    'menu-zoom-out': () => { onZoomOut?.(); },
    'menu-zoom-reset': () => { onZoomReset?.(); },
    'menu-downloads': () => { closeMenu(); onDownloads?.(); },
    'menu-history': () => { closeMenu(); onHistory?.(); },
    'menu-download-settings': () => { closeMenu(); onDownloadSettings?.(); },
    'menu-close': () => { closeMenu(); },
  };

  function buildInjectScript(pct) {
    const ab = pct !== 100 ? '#007acc' : '#3c3c3c';
    const ac = pct !== 100 ? '#007acc' : '#ccc';
    const rc = pct !== 100 ? 'pointer' : 'default';
    const resetAttr = pct !== 100 ? ' data-action="menu-zoom-reset"' : '';

    // Uses data-action attributes + addEventListener (no inline onclick) to avoid CSP
    return `(function(){
var old=document.getElementById('vm-browser-menu-root');if(old)old.remove();
var r=document.createElement('div');r.id='vm-browser-menu-root';
r.innerHTML='<div id="vm-menu-backdrop" style="position:fixed;inset:0;z-index:999998;"></div>'
+'<div id="vm-browser-menu" style="position:fixed;top:8px;right:8px;z-index:999999;min-width:220px;background:#1e1e1e;border:1px solid #3c3c3c;border-radius:6px;box-shadow:0 6px 20px rgba(0,0,0,0.5);padding:4px 0;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;color:#ccc;font-size:13px;">'
+'<div style="display:flex;align-items:center;padding:4px 12px;gap:8px;"><span style="flex:1;">Zoom</span>'
+'<div style="display:flex;align-items:center;gap:2px;">'
+'<button data-action="menu-zoom-out" style="display:flex;align-items:center;justify-content:center;width:28px;height:28px;border:1px solid #3c3c3c;border-radius:4px;background:transparent;color:#ccc;cursor:pointer;" title="Zoom out">\\u2212</button>'
+'<button${resetAttr} style="min-width:48px;height:28px;padding:0 6px;border:1px solid ${ab};border-radius:4px;background:transparent;color:${ac};font-size:12px;font-family:monospace;text-align:center;cursor:${rc};">${pct}%</button>'
+'<button data-action="menu-zoom-in" style="display:flex;align-items:center;justify-content:center;width:28px;height:28px;border:1px solid #3c3c3c;border-radius:4px;background:transparent;color:#ccc;cursor:pointer;" title="Zoom in">+</button>'
+'</div></div>'
+'<div style="height:1px;background:#3c3c3c;margin:4px 0;"></div>'
+'<button data-action="menu-downloads" class="vmi" style="display:flex;align-items:center;width:100%;padding:7px 12px;border:none;background:transparent;color:#ccc;font-size:13px;cursor:pointer;text-align:left;font-family:inherit;">Downloads</button>'
+'<button data-action="menu-history" class="vmi" style="display:flex;align-items:center;width:100%;padding:7px 12px;border:none;background:transparent;color:#ccc;font-size:13px;cursor:pointer;text-align:left;font-family:inherit;">History</button>'
+'<div style="height:1px;background:#3c3c3c;margin:4px 0;"></div>'
+'<button data-action="menu-download-settings" class="vmi" style="display:flex;align-items:center;width:100%;padding:7px 12px;border:none;background:transparent;color:#ccc;font-size:13px;cursor:pointer;text-align:left;font-family:inherit;">Download settings</button>'
+'</div>'
+'<style>.vmi:hover{background:#2a2d2e!important;}button[data-action]:hover{background:#2a2d2e!important;}</style>';
document.body.appendChild(r);
r.addEventListener('click',function(e){var btn=e.target.closest('[data-action]');if(btn){new Image().src='${SHORTCUT_BASE}'+btn.getAttribute('data-action');return;}if(e.target.id==='vm-menu-backdrop'){new Image().src='${SHORTCUT_BASE}menu-close';}});
document.addEventListener('keydown',function vmEsc(e){if(e.key==='Escape'){e.preventDefault();new Image().src='${SHORTCUT_BASE}menu-close';document.removeEventListener('keydown',vmEsc,true);}},true);
})();`;
  }

  function buildRemoveScript() {
    return `(function(){var el=document.getElementById('vm-browser-menu-root');if(el)el.remove();})();`;
  }

  async function openMenu() {
    const tabId = browserTabsStore.activeTabId;
    if (!tabId) return;
    open = true;
    try {
      await lensEvalTabJs(tabId, buildInjectScript(zoomLevel));
    } catch (e) {
      console.warn('[BrowserMenu] Failed to inject menu:', e);
      open = false;
    }
  }

  async function closeMenu() {
    if (!open) return;
    open = false;
    const tabId = browserTabsStore.activeTabId;
    if (!tabId) return;
    try {
      await lensEvalTabJs(tabId, buildRemoveScript());
    } catch (e) { /* best effort */ }
  }

  // Re-inject menu when zoomLevel changes (after zoom in/out) to update the displayed %
  $effect(() => {
    const pct = zoomLevel;
    if (!open) return;
    const tabId = browserTabsStore.activeTabId;
    if (!tabId) return;
    lensEvalTabJs(tabId, buildInjectScript(pct)).catch(() => {});
  });

  function handleTriggerClick() {
    if (open) closeMenu();
    else openMenu();
  }

  function handleTriggerKeydown(e) {
    if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') {
      e.preventDefault();
      openMenu();
    }
  }

  // Listen for menu actions from the child webview via lens-shortcut
  $effect(() => {
    if (!open) return;
    function handleShortcut(e) {
      const action = e.detail?.key;
      if (action && actionMap[action]) {
        actionMap[action]();
      }
    }
    window.addEventListener('lens-shortcut', handleShortcut);
    return () => window.removeEventListener('lens-shortcut', handleShortcut);
  });

  // Escape from parent side too
  $effect(() => {
    if (!open) return;
    function handleEsc(e) {
      if (e.key === 'Escape') {
        e.preventDefault();
        closeMenu();
      }
    }
    document.addEventListener('keydown', handleEsc, true);
    return () => document.removeEventListener('keydown', handleEsc, true);
  });
</script>

<div class="browser-menu-wrapper">
  <button
    bind:this={triggerEl}
    class="nav-btn trigger-btn"
    class:active={open}
    onclick={handleTriggerClick}
    onkeydown={handleTriggerKeydown}
    title="Customize and control"
    aria-label="Open browser menu"
    aria-haspopup="menu"
    aria-expanded={open}
  >
    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
      <circle cx="8" cy="3" r="1.5"/>
      <circle cx="8" cy="8" r="1.5"/>
      <circle cx="8" cy="13" r="1.5"/>
    </svg>
  </button>
</div>

<style>
  .browser-menu-wrapper {
    position: relative;
    display: flex;
    align-items: center;
    flex-shrink: 0;
  }

  .nav-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    border: none;
    border-radius: 4px;
    background: transparent;
    color: var(--text);
    cursor: pointer;
    transition: background var(--duration-fast, 100ms) var(--ease-out, ease-out);
    flex-shrink: 0;
  }

  .nav-btn:hover:not(:disabled) {
    background: var(--bg);
  }

  .nav-btn.active {
    background: var(--bg);
  }
</style>
