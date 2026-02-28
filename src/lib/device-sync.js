/**
 * device-sync.js — Interaction sync scripts for device preview.
 *
 * SYNC_SCRIPT is injected into each device WebView2. It captures scroll, click,
 * and input events, storing them in window.__deviceSync.lastEvent for polling.
 *
 * Replay functions generate JS strings to replay events on sibling devices.
 */

/**
 * Injectable JS script that captures user interactions and exposes them
 * via window.__deviceSync for polling by the Rust coordinator.
 */
export const SYNC_SCRIPT = `
(function() {
  if (window.__deviceSync) return;

  var state = {
    lastEvent: null,
    rafPending: false
  };

  function buildSelector(el) {
    if (!el || el === document.body || el === document.documentElement) return 'body';
    if (el.id) return '#' + CSS.escape(el.id);
    var parts = [];
    var current = el;
    while (current && current !== document.body) {
      var tag = current.tagName.toLowerCase();
      if (current.id) {
        parts.unshift('#' + CSS.escape(current.id));
        break;
      }
      var parent = current.parentElement;
      if (parent) {
        var siblings = Array.from(parent.children).filter(function(c) { return c.tagName === current.tagName; });
        if (siblings.length > 1) {
          var idx = siblings.indexOf(current) + 1;
          tag += ':nth-of-type(' + idx + ')';
        }
      }
      parts.unshift(tag);
      current = current.parentElement;
    }
    return parts.join(' > ');
  }

  // Scroll capture (debounced via requestAnimationFrame)
  window.addEventListener('scroll', function() {
    if (state.rafPending) return;
    state.rafPending = true;
    requestAnimationFrame(function() {
      state.rafPending = false;
      var scrollTop = document.documentElement.scrollTop || document.body.scrollTop;
      var scrollHeight = Math.max(document.documentElement.scrollHeight, document.body.scrollHeight);
      var clientHeight = document.documentElement.clientHeight;
      var percent = scrollHeight > clientHeight ? scrollTop / (scrollHeight - clientHeight) : 0;
      state.lastEvent = { type: 'scroll', scrollPercent: Math.min(1, Math.max(0, percent)), ts: Date.now() };
    });
  }, true);

  // Click capture
  window.addEventListener('click', function(e) {
    var selector = buildSelector(e.target);
    state.lastEvent = { type: 'click', selector: selector, ts: Date.now() };
  }, true);

  // Input capture
  window.addEventListener('input', function(e) {
    if (!e.target || !e.target.tagName) return;
    var tag = e.target.tagName.toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select') {
      var selector = buildSelector(e.target);
      state.lastEvent = { type: 'input', selector: selector, value: e.target.value, ts: Date.now() };
    }
  }, true);

  window.__deviceSync = {
    get lastEvent() { return state.lastEvent; },
    consume: function() {
      var evt = state.lastEvent;
      state.lastEvent = null;
      return evt;
    }
  };
})();
`;

/**
 * Generate JS that scrolls the page to a given percentage (0.0 - 1.0).
 * @param {number} scrollPercent - Scroll position as a ratio
 * @returns {string} JS code string
 */
export function replayScrollScript(scrollPercent) {
  return '(function() {' +
    'var scrollHeight = Math.max(document.documentElement.scrollHeight, document.body.scrollHeight);' +
    'var clientHeight = document.documentElement.clientHeight;' +
    'var target = ' + scrollPercent + ' * (scrollHeight - clientHeight);' +
    'window.scrollTo({ top: target, behavior: "instant" });' +
  '})()';
}

/**
 * Generate JS that clicks the element matching the given CSS selector.
 * @param {string} selector - CSS selector path
 * @returns {string} JS code string
 */
export function replayClickScript(selector) {
  return '(function() {' +
    'var el = document.querySelector(' + JSON.stringify(selector) + ');' +
    'if (el) el.click();' +
  '})()';
}

/**
 * Generate JS that sets the value of an input element.
 * @param {string} selector - CSS selector path
 * @param {string} value - The value to set
 * @returns {string} JS code string
 */
export function replayInputScript(selector, value) {
  return '(function() {' +
    'var el = document.querySelector(' + JSON.stringify(selector) + ');' +
    'if (el) {' +
    'el.value = ' + JSON.stringify(value) + ';' +
    'el.dispatchEvent(new Event("input", { bubbles: true }));' +
    '}' +
  '})()';
}
