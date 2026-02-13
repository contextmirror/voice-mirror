/**
 * navigation.js - Page routing and sidebar state
 * Handles navigation between Chat, Terminal, and Settings pages
 */

import { state } from './state.js';
import { createLog } from './log.js';
const log = createLog('[Navigation]');

// Context menu element
let contextMenu = null;

/**
 * Initialize navigation
 * Sets up nav click handlers and loads saved sidebar state
 */
export function initNavigation() {
    // Load saved sidebar state
    loadSidebarState();

    // Get context menu element
    contextMenu = document.getElementById('terminal-context-menu');

    // Set up nav item click handlers
    document.querySelectorAll('.nav-item').forEach(btn => {
        btn.addEventListener('click', () => {
            const page = btn.dataset.page;
            if (page) {
                navigateTo(page);
            }
        });

        // Add right-click handler for terminal nav item
        if (btn.dataset.page === 'terminal') {
            btn.addEventListener('contextmenu', (e) => {
                e.preventDefault();
                showTerminalContextMenu(e.clientX, e.clientY);
            });
        }
    });

    // Collapse button handler
    const collapseBtn = document.getElementById('sidebar-collapse-btn');
    if (collapseBtn) {
        collapseBtn.addEventListener('click', toggleSidebarCollapse);
    }

    // Set up context menu handlers
    setupContextMenu();

    // Close context menu on click outside
    document.addEventListener('click', (e) => {
        if (contextMenu && !contextMenu.contains(e.target)) {
            hideContextMenu();
        }
    });

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

/**
 * Show terminal context menu at position
 * @param {number} x - X coordinate
 * @param {number} y - Y coordinate
 */
function showTerminalContextMenu(x, y) {
    if (!contextMenu) return;

    // Update menu items based on current terminal location
    const snapItem = contextMenu.querySelector('[data-action="snap-to-chat"]');
    const fullscreenItem = contextMenu.querySelector('[data-action="show-fullscreen"]');

    if (state.terminalLocation === 'fullscreen') {
        // Currently fullscreen - show "Snap to Chat" option
        if (snapItem) snapItem.style.display = 'flex';
        if (fullscreenItem) fullscreenItem.style.display = 'none';
    } else {
        // Currently snapped - show "Show Fullscreen" option
        if (snapItem) snapItem.style.display = 'none';
        if (fullscreenItem) fullscreenItem.style.display = 'flex';
    }

    // Position menu
    contextMenu.style.left = `${x}px`;
    contextMenu.style.top = `${y}px`;
    contextMenu.classList.remove('hidden');

    // Ensure menu stays within viewport
    const rect = contextMenu.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    if (rect.right > viewportWidth) {
        contextMenu.style.left = `${viewportWidth - rect.width - 8}px`;
    }
    if (rect.bottom > viewportHeight) {
        contextMenu.style.top = `${viewportHeight - rect.height - 8}px`;
    }
}

/**
 * Hide terminal context menu
 */
function hideContextMenu() {
    if (contextMenu) {
        contextMenu.classList.add('hidden');
    }
}

/**
 * Set up context menu click handlers
 */
function setupContextMenu() {
    if (!contextMenu) return;

    contextMenu.querySelectorAll('.context-menu-item').forEach(item => {
        item.addEventListener('click', async () => {
            const action = item.dataset.action;

            if (action === 'snap-to-chat') {
                // Move terminal to chat page bottom
                if (window.relocateTerminal) {
                    await window.relocateTerminal('chat-bottom');
                    // Navigate to chat page to see it
                    navigateTo('chat');
                }
            } else if (action === 'show-fullscreen') {
                // Move terminal to fullscreen page
                if (window.relocateTerminal) {
                    await window.relocateTerminal('fullscreen');
                    // Navigate to terminal page to see it
                    navigateTo('terminal');
                }
            }

            hideContextMenu();
        });
    });
}
