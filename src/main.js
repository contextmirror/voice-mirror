import { mount } from 'svelte';
import App from './App.svelte';

const app = mount(App, {
  target: document.getElementById('app'),
});

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
        el.style.scrollBehavior = 'auto';
        el.scrollTop = ratio * (el.scrollHeight - el.clientHeight);
        requestAnimationFrame(() => { el.style.scrollBehavior = ''; });
        return;
      }
    }
    el = el.parentElement;
  }
}, true);

export default app;
