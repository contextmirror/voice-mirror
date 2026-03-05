/**
 * Smart tooltip/popup positioning matching VS Code's ContentHoverWidget strategy.
 *
 * VS Code logic (resizableContentWidget.ts):
 * - Measures available space above and below the anchor line
 * - Uses TOP_HEIGHT (30px) and BOTTOM_HEIGHT (24px) safety margins
 * - Default: prefer below, flip to above if not enough room
 * - Hover: prefer above, flip to below if not enough room
 *
 * @param {HTMLElement} el - The popup element (must be rendered to measure height)
 * @param {{ above: number, below: number }} anchor - The y positions for above/below placement
 * @param {{ prefer?: 'above' | 'below' }} [options]
 * @returns {{ top: number, placement: 'above' | 'below' }}
 */
export function smartPosition(el, anchor, options = {}) {
  const TOP_MARGIN = 30;
  const BOTTOM_MARGIN = 24;
  const prefer = options.prefer || 'below';

  const height = el.offsetHeight;
  const spaceAbove = anchor.above - TOP_MARGIN;
  const spaceBelow = window.innerHeight - anchor.below - BOTTOM_MARGIN;

  let placement;
  if (prefer === 'above') {
    placement = spaceAbove >= height ? 'above' : 'below';
  } else {
    placement = spaceBelow >= height ? 'below' : 'above';
  }

  const top = placement === 'above' ? anchor.above : anchor.below;
  return { top, placement };
}

/**
 * Apply smart positioning to an element's style.
 * Sets top and transform based on placement.
 *
 * @param {HTMLElement} el
 * @param {{ above: number, below: number }} anchor
 * @param {{ prefer?: 'above' | 'below', x?: number }} [options]
 */
export function applySmartPosition(el, anchor, options = {}) {
  const { top, placement } = smartPosition(el, anchor, options);
  el.style.top = `${top}px`;
  el.style.transform = placement === 'above' ? 'translateY(-100%)' : '';
  if (options.x != null) {
    const maxX = window.innerWidth - el.offsetWidth - 4;
    el.style.left = `${Math.max(4, Math.min(options.x, maxX))}px`;
  }
}
