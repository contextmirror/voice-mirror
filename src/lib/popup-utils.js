/**
 * Set up click-outside and Escape-key closing for a context menu.
 * Uses capture-phase mousedown to catch clicks before they propagate.
 *
 * @param {HTMLElement} el - The menu element
 * @param {() => void} onClose - Called when user clicks outside or presses Escape
 * @returns {() => void} Cleanup function to remove listeners
 */
export function setupClickOutside(el, onClose) {
  function handleMousedown(e) {
    if (!el.contains(e.target)) onClose();
  }
  function handleKeydown(e) {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  }
  document.addEventListener('mousedown', handleMousedown, true);
  document.addEventListener('keydown', handleKeydown, true);
  return () => {
    document.removeEventListener('mousedown', handleMousedown, true);
    document.removeEventListener('keydown', handleKeydown, true);
  };
}
