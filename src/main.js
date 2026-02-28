import { mount } from 'svelte';
import App from './App.svelte';

const app = mount(App, {
  target: document.getElementById('app'),
});

// ══════════════════════════════════════════════════════════════════════════════
// Global browser behavior suppression
// ══════════════════════════════════════════════════════════════════════════════
// Tauri renders the frontend in a WebView2 (Chromium) browser window.
// Without suppression, native browser behaviors leak through — context menus,
// refresh, print, find bar, text drag, etc. These break the "desktop app" feel.
// The LensPreview child WebView2 is a separate process and is NOT affected.

// ── Block native context menu globally ──
// We have custom context menus for terminals, file tree, editor, tabs, etc.
// This prevents the browser's "Back / Refresh / Save as / Print / Inspect"
// menu from appearing on any right-click that isn't handled by a component.
document.addEventListener('contextmenu', (e) => {
  const el = /** @type {HTMLElement} */ (e.target);
  const tag = el?.tagName;

  // Block context menu on ghostty-web's hidden textarea inside terminals.
  // ghostty-web creates an invisible <textarea> for keyboard input capture —
  // without this check, right-clicking the terminal shows the browser's
  // "Save image as / Copy image / Paste" menu.
  if (tag === 'TEXTAREA' || tag === 'CANVAS') {
    let parent = el?.parentElement;
    while (parent) {
      if (parent.classList?.contains('terminal-container')) {
        e.preventDefault();
        return;
      }
      parent = parent.parentElement;
    }
  }

  // Allow context menu in real textareas and inputs (for spell-check etc.)
  if (tag === 'TEXTAREA' || tag === 'INPUT') return;
  if (el?.isContentEditable) return;

  e.preventDefault();
}, true);

// ── Block browser keyboard shortcuts ──
// Prevents Ctrl+R (refresh), Ctrl+P (print), F5 (refresh), Ctrl+F (find bar),
// Ctrl+G (find next in browser), Ctrl+U (view source), Ctrl+S (save page),
// Ctrl+Shift+I (devtools), F7 (caret browsing), etc.
// Our own shortcuts (Ctrl+P for command palette, Ctrl+, for settings, etc.)
// are handled in shortcuts.svelte.js which runs BEFORE this suppression.
document.addEventListener('keydown', (e) => {
  // Never suppress inside an input/textarea that needs normal editing keys
  const tag = /** @type {HTMLElement} */ (e.target)?.tagName;
  const isEditable = tag === 'TEXTAREA' || tag === 'INPUT' || /** @type {HTMLElement} */ (e.target)?.isContentEditable;

  // Browser shortcuts to always block (regardless of focus)
  const blocked = [
    // Refresh
    e.key === 'F5',
    e.ctrlKey && e.key === 'r' && !e.shiftKey && !e.altKey,
    // Print
    e.ctrlKey && e.key === 'p' && !e.shiftKey && !e.altKey && !isEditable,
    // View source
    e.ctrlKey && e.key === 'u' && !e.shiftKey && !e.altKey,
    // Save page
    e.ctrlKey && e.key === 's' && !e.shiftKey && !e.altKey && !isEditable,
    // Browser find bar (our Ctrl+F should be editor find, not browser find)
    e.ctrlKey && e.key === 'f' && !e.shiftKey && !e.altKey && !isEditable,
    // Caret browsing
    e.key === 'F7',
  ];

  if (blocked.some(Boolean)) {
    e.preventDefault();
  }
}, true);

// ── Disable browser drag-and-drop of text/images ──
// Prevents the browser from showing a drag ghost when dragging selected text
// or images. Our own drag handlers (terminal sidebar reorder) use explicit
// draggable="true" and are not affected by this.
document.addEventListener('dragstart', (e) => {
  const el = /** @type {HTMLElement} */ (e.target);
  // Allow elements with explicit draggable="true" (our custom drag handlers)
  if (el?.getAttribute?.('draggable') === 'true') return;
  // Allow CodeMirror text drag-and-drop (select text → drag to move)
  if (el?.closest?.('.cm-editor')) return;
  e.preventDefault();
}, true);

// ── Block middle-click auto-scroll ──
// Middle-clicking in the browser shows an auto-scroll cursor. Block it
// everywhere except terminals (which may use middle-click paste).
document.addEventListener('mousedown', (e) => {
  if (e.button !== 1) return; // middle button only

  // Allow middle-click in terminal containers (for paste)
  let el = /** @type {HTMLElement|null} */ (e.target);
  while (el) {
    if (el.classList?.contains('terminal-container')) return;
    el = el.parentElement;
  }

  e.preventDefault();
}, true);

// ── Global scrollbar jump-to-click ──
// By default, clicking the scrollbar track pages up/down. This handler
// overrides that so clicking anywhere on the track jumps directly to that
// position — matching the DiffViewer behavior across the entire app.
document.addEventListener('mousedown', (e) => {
  if (e.button !== 0) return;

  // Walk up from the click target to find the nearest scrollable ancestor
  let el = /** @type {HTMLElement|null} */ (e.target);
  while (el && el !== document.documentElement) {
    if (el.scrollHeight > el.clientHeight) {
      const rect = el.getBoundingClientRect();
      // Check if click is in the rightmost 14px (scrollbar width from base.css)
      if (e.clientX >= rect.right - 14 && e.clientX <= rect.right) {
        e.preventDefault();
        e.stopPropagation();
        const clickY = e.clientY - rect.top;
        const ratio = clickY / rect.height;
        const target = el;
        target.style.scrollBehavior = 'auto';
        target.scrollTop = ratio * (target.scrollHeight - target.clientHeight);
        requestAnimationFrame(() => { target.style.scrollBehavior = ''; });
        return;
      }
    }
    el = el.parentElement;
  }
}, true);

export default app;
