/**
 * navigation.js - Page routing and sidebar state
 * Handles navigation between Chat, Terminal, and Settings pages
 */

import { state } from './state.js';
import { createLog } from './log.js';
const log = createLog('[Navigation]');

/**
 * Initialize navigation
 * Sets up nav click handlers and loads saved sidebar state
 */
export function initNavigation() {
    // Load saved sidebar state
    loadSidebarState();

    // Set up nav item click handlers
    document.querySelectorAll('.nav-item').forEach(btn => {
        btn.addEventListener('click', () => {
            const page = btn.dataset.page;
            if (page) {
                navigateTo(page);
            }
        });
    });

    // Collapse button handler
    const collapseBtn = document.getElementById('sidebar-collapse-btn');
    if (collapseBtn) {
        collapseBtn.addEventListener('click', toggleSidebarCollapse);
    }

    // Apply initial page state
    navigateTo(state.currentPage);
}

/**
 * Navigate to a specific page
 * @param {string} page - Page name: 'chat', 'terminal', or 'settings'
 */
export function navigateTo(page) {
    // Validate page
    const validPages = ['chat', 'terminal', 'browser', 'settings'];
    if (!validPages.includes(page)) {
        log.warn('Invalid page:', page);
        return;
    }

    // Update state
    state.currentPage = page;

    // Update nav active state
    document.querySelectorAll('.nav-item').forEach(btn => {
        const isActive = btn.dataset.page === page;
        btn.classList.toggle('active', isActive);
    });

    // Show/hide pages
    document.querySelectorAll('.page').forEach(p => {
        const pageId = p.id.replace('page-', '');
        p.classList.toggle('active', pageId === page);
    });

    // Special handling for terminal page - trigger resize for ghostty-web
    if (page === 'terminal' || page === 'chat') {
        setTimeout(() => {
            window.dispatchEvent(new Event('resize'));
        }, 50);
    }

    // Load settings UI when navigating to settings
    if (page === 'settings' && window.loadSettingsUI) {
        window.loadSettingsUI();
    }

    log.info('Navigated to:', page);
}

/**
 * Toggle sidebar collapsed state
 */
export function toggleSidebarCollapse() {
    const sidebar = document.getElementById('sidebar');
    if (!sidebar) return;

    state.sidebarCollapsed = !state.sidebarCollapsed;
    sidebar.classList.toggle('collapsed', state.sidebarCollapsed);

    // Save preference
    saveSidebarState();

    // Trigger resize for terminal fit
    setTimeout(() => {
        window.dispatchEvent(new Event('resize'));
    }, 250); // Wait for transition to complete
}

/**
 * Load sidebar state from config
 */
async function loadSidebarState() {
    try {
        const config = await window.voiceMirror.config.get();
        if (config.sidebar?.collapsed !== undefined) {
            state.sidebarCollapsed = config.sidebar.collapsed;
            const sidebar = document.getElementById('sidebar');
            if (sidebar) {
                sidebar.classList.toggle('collapsed', state.sidebarCollapsed);
            }
        }
    } catch (err) {
        log.error('Failed to load sidebar state:', err);
    }
}

/**
 * Save sidebar state to config
 */
async function saveSidebarState() {
    try {
        const config = await window.voiceMirror.config.get();
        config.sidebar = config.sidebar || {};
        config.sidebar.collapsed = state.sidebarCollapsed;
        await window.voiceMirror.config.set(config);
    } catch (err) {
        log.error('Failed to save sidebar state:', err);
    }
}
