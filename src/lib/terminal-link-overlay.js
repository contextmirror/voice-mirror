/**
 * terminal-link-overlay.js -- Ctrl+click link detection for terminal.
 *
 * Detects URLs and file paths under the cursor when Ctrl is held,
 * shows an underline overlay, and handles Ctrl+click to open them.
 */

import { detectURLs, detectFilePaths } from './terminal-links.js';

/**
 * Create a link overlay controller for a ghostty-web terminal.
 *
 * @param {object} opts
 * @param {HTMLElement} opts.container - The .terminal-container element (contains the canvas)
 * @param {() => any} opts.getTerm - Getter for the ghostty-web Terminal instance
 * @param {(url: string) => void} opts.onOpenUrl - Callback to open a URL externally
 * @param {(match: {path: string, line?: number, col?: number}) => void} opts.onOpenFile - Callback to open a file in the editor
 * @param {() => string} opts.getCwd - Getter for the terminal's working directory
 * @returns {{ destroy: () => void }}
 */
export function createLinkOverlay({ container, getTerm, onOpenUrl, onOpenFile, getCwd }) {
  // Overlay element for underline decoration
  const overlay = document.createElement('div');
  overlay.className = 'terminal-link-overlay';
  overlay.style.cssText = 'position:absolute;pointer-events:none;display:none;z-index:1;';
  container.appendChild(overlay);

  // Tooltip element for showing link target
  const tooltip = document.createElement('div');
  tooltip.className = 'terminal-link-tooltip';
  tooltip.style.cssText = 'position:absolute;display:none;z-index:2;pointer-events:none;' +
    'background:var(--bg-elevated);color:var(--text);font-size:11px;padding:2px 6px;' +
    'border:1px solid var(--border, rgba(255,255,255,0.1));border-radius:3px;' +
    'white-space:nowrap;max-width:400px;overflow:hidden;text-overflow:ellipsis;';
  container.appendChild(tooltip);

  let currentMatch = null;
  let ctrlHeld = false;

  /**
   * Get cell dimensions from the terminal's rendered canvas.
   * Returns { cellWidth, cellHeight, offsetX, offsetY } or null.
   */
  function getCellDimensions() {
    const term = getTerm();
    if (!term || !term.cols || !term.rows) return null;

    // Find the screen element (the area where rows are rendered)
    const screen = container.querySelector('.xterm-screen') ||
                   container.querySelector('.ghostty-web') ||
                   container.querySelector('canvas')?.parentElement;
    if (!screen) return null;

    const rect = screen.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();

    return {
      cellWidth: rect.width / term.cols,
      cellHeight: rect.height / term.rows,
      // Offset from container edge to the rendering area
      offsetX: rect.left - containerRect.left,
      offsetY: rect.top - containerRect.top,
    };
  }

  /**
   * Convert mouse event to terminal cell coordinates (col, row in viewport).
   */
  function mouseToCell(e) {
    const dims = getCellDimensions();
    if (!dims) return null;

    const containerRect = container.getBoundingClientRect();
    const x = e.clientX - containerRect.left - dims.offsetX;
    const y = e.clientY - containerRect.top - dims.offsetY;

    const col = Math.floor(x / dims.cellWidth);
    const row = Math.floor(y / dims.cellHeight);

    const term = getTerm();
    if (!term || col < 0 || col >= term.cols || row < 0 || row >= term.rows) return null;

    return { col, row };
  }

  /**
   * Get the text content of a buffer line.
   */
  function getLineText(bufferRow) {
    const term = getTerm();
    if (!term) return null;
    const buffer = term.buffer?.active;
    if (!buffer) return null;
    const line = buffer.getLine(bufferRow);
    return line ? line.translateToString(true) : null;
  }

  /**
   * Find a link match at the given column in a line of text.
   */
  function findMatchAtCol(text, col) {
    const cwd = getCwd?.() || '';

    // Check URLs first
    const urls = detectURLs(text);
    for (const m of urls) {
      if (col >= m.start && col < m.end) {
        return { type: 'url', start: m.start, end: m.end, url: m.url };
      }
    }

    // Check file paths
    const files = detectFilePaths(text, cwd);
    for (const m of files) {
      if (col >= m.start && col < m.end) {
        return { type: 'file', start: m.start, end: m.end, path: m.path, line: m.line, col: m.col };
      }
    }

    return null;
  }

  /**
   * Show the underline overlay and tooltip for a matched link.
   */
  function showOverlay(viewportRow, match) {
    const dims = getCellDimensions();
    if (!dims) return;

    const left = dims.offsetX + match.start * dims.cellWidth;
    const width = (match.end - match.start) * dims.cellWidth;
    const top = dims.offsetY + viewportRow * dims.cellHeight;

    overlay.style.display = 'block';
    overlay.style.left = left + 'px';
    overlay.style.top = top + 'px';
    overlay.style.width = width + 'px';
    overlay.style.height = dims.cellHeight + 'px';
    overlay.style.borderBottom = '1px solid var(--accent)';
    overlay.style.background = 'rgba(86, 180, 233, 0.08)';

    // Show tooltip below the link
    const label = match.type === 'url'
      ? match.url
      : match.path + (match.line ? ':' + match.line : '') + (match.col ? ':' + match.col : '');
    tooltip.textContent = 'Ctrl+click to open: ' + label;
    tooltip.style.display = 'block';
    tooltip.style.left = left + 'px';
    tooltip.style.top = (top + dims.cellHeight + 2) + 'px';

    // Change cursor on the container
    container.style.cursor = 'pointer';
  }

  function hideOverlay() {
    overlay.style.display = 'none';
    tooltip.style.display = 'none';
    container.style.cursor = '';
    currentMatch = null;
  }

  // ---- Event handlers ----

  function handleMouseMove(e) {
    if (!ctrlHeld) {
      if (currentMatch) hideOverlay();
      return;
    }

    const cell = mouseToCell(e);
    if (!cell) {
      if (currentMatch) hideOverlay();
      return;
    }

    const term = getTerm();
    if (!term) return;

    const buffer = term.buffer?.active;
    if (!buffer) return;

    const bufferRow = (buffer.viewportY || 0) + cell.row;
    const text = getLineText(bufferRow);
    if (!text) {
      if (currentMatch) hideOverlay();
      return;
    }

    const match = findMatchAtCol(text, cell.col);
    if (match) {
      // Cache to avoid re-detection on click
      currentMatch = { ...match, viewportRow: cell.row };
      showOverlay(cell.row, match);
    } else if (currentMatch) {
      hideOverlay();
    }
  }

  function handleClick(e) {
    if (!ctrlHeld || !currentMatch) return;

    e.preventDefault();
    e.stopPropagation();

    if (currentMatch.type === 'url') {
      onOpenUrl(currentMatch.url);
    } else if (currentMatch.type === 'file') {
      onOpenFile({ path: currentMatch.path, line: currentMatch.line, col: currentMatch.col });
    }

    hideOverlay();
  }

  function handleKeyDown(e) {
    if (e.key === 'Control') {
      ctrlHeld = true;
    }
  }

  function handleKeyUp(e) {
    if (e.key === 'Control') {
      ctrlHeld = false;
      if (currentMatch) hideOverlay();
    }
  }

  function handleMouseLeave() {
    if (currentMatch) hideOverlay();
  }

  // Attach listeners
  container.addEventListener('mousemove', handleMouseMove);
  container.addEventListener('click', handleClick, true); // capture to beat terminal's click handler
  container.addEventListener('mouseleave', handleMouseLeave);
  document.addEventListener('keydown', handleKeyDown);
  document.addEventListener('keyup', handleKeyUp);

  return {
    destroy() {
      container.removeEventListener('mousemove', handleMouseMove);
      container.removeEventListener('click', handleClick, true);
      container.removeEventListener('mouseleave', handleMouseLeave);
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('keyup', handleKeyUp);
      overlay.remove();
      tooltip.remove();
    },
  };
}
