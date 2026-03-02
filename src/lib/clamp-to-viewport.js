/**
 * Reposition an absolutely/fixed-positioned element if it overflows the viewport.
 * Call from an $effect after the element is mounted and positioned.
 *
 * @param {HTMLElement} el - The element to clamp
 * @param {number} [pad=4] - Padding from viewport edges in px
 */
export function clampToViewport(el, pad = 4) {
  const rect = el.getBoundingClientRect();
  if (rect.bottom > window.innerHeight - pad) {
    el.style.top = `${Math.max(pad, window.innerHeight - rect.height - pad)}px`;
  }
  if (rect.right > window.innerWidth - pad) {
    el.style.left = `${Math.max(pad, window.innerWidth - rect.width - pad)}px`;
  }
}
