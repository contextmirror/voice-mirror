/**
 * settings-dependencies.js — Dependencies settings tab sub-module
 *
 * Shows 3 sections: npm packages, system tools, and Python environment.
 * Hidden behind advanced.showDependencies feature flag.
 */

import { createLog } from './log.js';
const log = createLog('[Settings:Deps]');

let lastChecked = null;

function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

function setBadge(el, cls, text) {
    el.className = 'dep-badge ' + cls;
    el.textContent = text;
}

// --- Section 1: npm package cards ---

function updateCard(prefix, info) {
    const installedEl = document.getElementById(`dep-${prefix}-installed`);
    const latestEl = document.getElementById(`dep-${prefix}-latest`);
    const badgeEl = document.getElementById(`dep-${prefix}-badge`);
    const updateBtn = document.getElementById(`dep-${prefix}-update`);

    if (!installedEl || !badgeEl) return;

    latestEl.textContent = info.latest || '--';

    if (info.error) {
        installedEl.textContent = '--';
        setBadge(badgeEl, 'error', info.error);
        updateBtn.style.display = 'none';
        return;
    }

    if (info.notInstalled) {
        installedEl.textContent = 'Not installed';
        setBadge(badgeEl, 'not-installed', 'Not installed');
        updateBtn.style.display = 'none';
        return;
    }

    installedEl.textContent = info.installed || '--';

    if (info.updateAvailable) {
        setBadge(badgeEl, 'update-available', 'Update available');
        updateBtn.style.display = '';
    } else if (!info.installed) {
        // CLI exists on PATH but version couldn't be determined
        setBadge(badgeEl, 'up-to-date', 'Installed');
        updateBtn.style.display = 'none';
    } else {
        setBadge(badgeEl, 'up-to-date', 'Up to date');
        updateBtn.style.display = 'none';
    }
}

function updateNpmUpdateAllVisibility(npmData) {
    const btn = document.getElementById('dep-npm-update-all');
    if (!btn) return;

    const hasUpdates = ['ghosttyWeb', 'opencode', 'claudeCode'].some(
        key => npmData[key]?.updateAvailable
    );
    btn.style.display = hasUpdates ? '' : 'none';
}

async function handleUpdate(depId, prefix) {
    const updateBtn = document.getElementById(`dep-${prefix}-update`);
    const badgeEl = document.getElementById(`dep-${prefix}-badge`);
    if (!updateBtn || !badgeEl) return;

    updateBtn.disabled = true;
    updateBtn.textContent = 'Updating...';
    setBadge(badgeEl, 'checking', 'Installing...');

    try {
        const result = await window.voiceMirror.ai.updateDependency(depId);

        if (result.success) {
            setBadge(badgeEl, 'up-to-date', 'Updated!');
            updateBtn.style.display = 'none';
        } else {
            setBadge(badgeEl, 'error', 'Update failed');
            updateBtn.textContent = 'Retry';
            updateBtn.disabled = false;
        }
    } catch (err) {
        log.error(`Update failed for ${depId}:`, err);
        setBadge(badgeEl, 'error', 'Update failed');
        updateBtn.textContent = 'Retry';
        updateBtn.disabled = false;
    }
}

const NPM_UPDATE_MAP = {
    ghosttyWeb: { depId: 'ghostty-web', prefix: 'ghostty' },
    opencode: { depId: 'opencode', prefix: 'opencode' },
    claudeCode: { depId: 'claude-code', prefix: 'claude' }
};

async function handleNpmUpdateAll() {
    const btn = document.getElementById('dep-npm-update-all');
    if (btn) {
        btn.disabled = true;
        btn.textContent = 'Updating...';
    }

    try {
        const result = await window.voiceMirror.ai.checkDependencyVersions();
        if (!result.success || !result.data?.npm) return;

        const toUpdate = Object.entries(NPM_UPDATE_MAP)
            .filter(([key]) => result.data.npm[key]?.updateAvailable);

        for (const [, { depId, prefix }] of toUpdate) {
            const badgeEl = document.getElementById(`dep-${prefix}-badge`);
            if (badgeEl) setBadge(badgeEl, 'checking', 'Installing...');
            await handleUpdate(depId, prefix);
        }
    } catch (err) {
        log.error('Update All (npm) failed:', err);
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.textContent = 'Update All';
        }
        setTimeout(() => checkVersions(), 1000);
    }
}

// --- Section 2: System cards ---

function updateSystemCard(prefix, info) {
    const versionEl = document.getElementById(`dep-${prefix}-version`);
    const badgeEl = document.getElementById(`dep-${prefix}-badge`);
    if (!versionEl || !badgeEl) return;

    if (info.error) {
        versionEl.textContent = '--';
        setBadge(badgeEl, 'error', info.error);
        return;
    }

    if (info.version) {
        versionEl.textContent = info.version;
        setBadge(badgeEl, 'up-to-date', 'Installed');
    } else if (info.installed === true) {
        versionEl.textContent = 'Available';
        setBadge(badgeEl, 'up-to-date', 'Installed');
    } else if (info.installed === false) {
        versionEl.textContent = 'Not found';
        setBadge(badgeEl, 'not-installed', 'Not found');
    }
}

// --- Section 3: Python environment ---

function updatePipSection(pipData) {
    const summaryEl = document.getElementById('dep-pip-summary');
    const tableContainer = document.getElementById('dep-pip-table-container');
    const tbody = document.getElementById('dep-pip-tbody');
    const updateAllBtn = document.getElementById('dep-pip-update-all');

    if (!summaryEl) return;

    if (pipData.error) {
        setBadge(summaryEl, 'error', pipData.error);
        if (tableContainer) tableContainer.style.display = 'none';
        if (updateAllBtn) updateAllBtn.style.display = 'none';
        return;
    }

    const outdated = pipData.outdated || [];
    if (outdated.length === 0) {
        setBadge(summaryEl, 'up-to-date', 'All up to date');
        if (tableContainer) tableContainer.style.display = 'none';
        if (updateAllBtn) updateAllBtn.style.display = 'none';
        return;
    }

    setBadge(summaryEl, 'update-available', `${outdated.length} package${outdated.length > 1 ? 's' : ''} can be updated`);
    if (updateAllBtn) updateAllBtn.style.display = '';

    if (tbody) {
        tbody.innerHTML = '';
        for (const pkg of outdated) {
            const tr = document.createElement('tr');
            tr.innerHTML = `<td>${escapeHtml(pkg.name)}</td><td>${escapeHtml(pkg.installed)}</td><td>${escapeHtml(pkg.latest)}</td>`;
            tbody.appendChild(tr);
        }
    }
    if (tableContainer) tableContainer.style.display = '';
}

async function handlePipUpdateAll() {
    const btn = document.getElementById('dep-pip-update-all');
    const summaryEl = document.getElementById('dep-pip-summary');
    if (btn) {
        btn.disabled = true;
        btn.textContent = 'Updating...';
    }
    if (summaryEl) setBadge(summaryEl, 'checking', 'Upgrading packages...');

    try {
        const result = await window.voiceMirror.ai.updatePipPackages();
        if (result.success) {
            if (summaryEl) setBadge(summaryEl, 'up-to-date', 'Updated!');
            setTimeout(() => checkVersions(), 1000);
        } else {
            const msg = result.error ? `Failed: ${result.error}` : 'Update failed';
            if (summaryEl) setBadge(summaryEl, 'error', msg.length > 60 ? msg.slice(0, 57) + '...' : msg);
            log.error('Pip update failed:', result.error);
        }
    } catch (err) {
        log.error('Pip update failed:', err);
        if (summaryEl) setBadge(summaryEl, 'error', 'Update failed');
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.textContent = 'Update All';
        }
    }
}

// --- Main check function ---

async function checkVersions() {
    const checkBtn = document.getElementById('dep-check-btn');
    const lastCheckedEl = document.getElementById('dep-last-checked');

    // Set checking state for all npm cards
    ['ghostty', 'opencode', 'claude'].forEach(prefix => {
        const badge = document.getElementById(`dep-${prefix}-badge`);
        if (badge) setBadge(badge, 'checking', 'Checking...');
    });

    // Set checking state for system cards
    ['node', 'python', 'ollama', 'ffmpeg'].forEach(prefix => {
        const badge = document.getElementById(`dep-${prefix}-badge`);
        if (badge) setBadge(badge, 'checking', 'Checking...');
    });

    // Set checking state for pip section
    const pipSummary = document.getElementById('dep-pip-summary');
    if (pipSummary) setBadge(pipSummary, 'checking', 'Checking...');

    if (checkBtn) checkBtn.disabled = true;

    try {
        const result = await window.voiceMirror.ai.checkDependencyVersions();

        if (result.success && result.data) {
            // npm section
            if (result.data.npm) {
                if (result.data.npm.ghosttyWeb) updateCard('ghostty', result.data.npm.ghosttyWeb);
                if (result.data.npm.opencode) updateCard('opencode', result.data.npm.opencode);
                if (result.data.npm.claudeCode) updateCard('claude', result.data.npm.claudeCode);
                updateNpmUpdateAllVisibility(result.data.npm);
            }

            // system section
            if (result.data.system) {
                if (result.data.system.node) updateSystemCard('node', result.data.system.node);
                if (result.data.system.python) updateSystemCard('python', result.data.system.python);
                if (result.data.system.ollama) updateSystemCard('ollama', result.data.system.ollama);
                if (result.data.system.ffmpeg) updateSystemCard('ffmpeg', result.data.system.ffmpeg);
            }

            // pip section
            if (result.data.pip) {
                updatePipSection(result.data.pip);
            }
        }

        lastChecked = new Date();
        if (lastCheckedEl) {
            lastCheckedEl.textContent = 'Last checked: just now';
        }
    } catch (err) {
        log.error('Version check failed:', err);
    } finally {
        if (checkBtn) checkBtn.disabled = false;
    }
}

/**
 * Initialize Dependencies tab — attach event listeners
 */
export function initDependenciesTab() {
    // Individual npm update buttons
    const ghosttyBtn = document.getElementById('dep-ghostty-update');
    const opencodeBtn = document.getElementById('dep-opencode-update');
    const claudeBtn = document.getElementById('dep-claude-update');

    if (ghosttyBtn) ghosttyBtn.addEventListener('click', () => handleUpdate('ghostty-web', 'ghostty'));
    if (opencodeBtn) opencodeBtn.addEventListener('click', () => handleUpdate('opencode', 'opencode'));
    if (claudeBtn) claudeBtn.addEventListener('click', () => handleUpdate('claude-code', 'claude'));

    // Update All buttons
    const npmUpdateAllBtn = document.getElementById('dep-npm-update-all');
    const pipUpdateAllBtn = document.getElementById('dep-pip-update-all');

    if (npmUpdateAllBtn) npmUpdateAllBtn.addEventListener('click', () => handleNpmUpdateAll());
    if (pipUpdateAllBtn) pipUpdateAllBtn.addEventListener('click', () => handlePipUpdateAll());

    // Expose check function globally for onclick
    window.checkDependencyUpdates = checkVersions;

    log.info('Dependencies tab initialized');
}

/**
 * Load Dependencies UI — check versions on tab load
 */
export async function loadDependenciesUI() {
    await checkVersions();
}
