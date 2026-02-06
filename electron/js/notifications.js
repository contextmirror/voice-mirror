/**
 * notifications.js - Toast notification system
 */

const toastIcons = {
    info: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>`,
    success: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>`,
    warning: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`,
    error: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>`,
    loading: `<div class="toast-spinner"></div>`
};

/**
 * Show a toast notification
 * @param {string} message - Toast message
 * @param {string} type - Type: info, success, warning, error, loading
 * @param {number} duration - Duration in ms (0 for no auto-dismiss)
 * @param {Object} options - Additional options
 * @param {string} options.actionText - Text for action button
 * @param {Function} options.onAction - Callback when action button clicked
 * @returns {HTMLElement} - The toast element
 */
export function showToast(message, type = 'info', duration = 4000, options = {}) {
    const toastContainer = document.getElementById('toast-container');

    const toast = document.createElement('div');
    toast.className = `toast ${type}`;

    const iconSpan = document.createElement('span');
    iconSpan.className = 'toast-icon';
    iconSpan.innerHTML = toastIcons[type] || toastIcons.info;

    const msgSpan = document.createElement('span');
    msgSpan.className = 'toast-message';
    msgSpan.textContent = message;

    toast.appendChild(iconSpan);
    toast.appendChild(msgSpan);

    // Add action button if provided
    if (options.actionText && options.onAction) {
        const actionBtn = document.createElement('button');
        actionBtn.className = 'toast-action';
        actionBtn.textContent = options.actionText;
        actionBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            options.onAction(toast);
        });
        toast.appendChild(actionBtn);
    }

    const closeBtn = document.createElement('button');
    closeBtn.className = 'toast-close';
    closeBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
    </svg>`;
    closeBtn.addEventListener('click', () => window.dismissToast(toast));
    toast.appendChild(closeBtn);

    toastContainer.appendChild(toast);

    // Auto-dismiss (except loading toasts)
    if (duration > 0 && type !== 'loading') {
        setTimeout(() => dismissToast(toast), duration);
    }

    return toast;
}

/**
 * Dismiss a toast notification
 */
export function dismissToast(toast) {
    if (!toast || toast.classList.contains('exiting')) return;
    toast.classList.add('exiting');
    setTimeout(() => toast.remove(), 150);
}

/**
 * Update an existing toast (useful for loading -> success)
 */
export function updateToast(toast, message, type) {
    if (!toast) return;

    toast.className = `toast ${type}`;
    toast.querySelector('.toast-icon').innerHTML = toastIcons[type] || toastIcons.info;
    toast.querySelector('.toast-message').textContent = message;

    // Auto-dismiss after update (loading/error toasts stay until manually closed)
    if (type !== 'loading' && type !== 'error') {
        setTimeout(() => dismissToast(toast), 3000);
    }
}

// Expose dismissToast globally for onclick handlers
window.dismissToast = dismissToast;
