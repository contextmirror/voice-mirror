/**
 * whats-new.js - "What's New" notification after app update
 *
 * On startup, compares lastSeenVersion with current app version.
 * If they differ (and it's not a first install), shows a banner
 * in the sidebar with a "What's New" button that opens a modal
 * with the changelog for that version.
 */

import { renderMarkdown } from './markdown.js';
import { createLog } from './log.js';
const log = createLog('[WhatsNew]');

const overlay = document.getElementById('whats-new-overlay');
const body = document.getElementById('whats-new-body');
const closeBtn = document.getElementById('whats-new-close');

if (closeBtn) {
    closeBtn.addEventListener('click', closeWhatsNewModal);
}

// Close on backdrop click
if (overlay) {
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) closeWhatsNewModal();
    });
}

// Close on Escape key
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && overlay?.style.display !== 'none') {
        closeWhatsNewModal();
    }
});

/**
 * Show the What's New modal with changelog content for a version.
 */
async function showWhatsNewModal(version) {
    if (!overlay || !body) return;

    body.innerHTML = '<p style="color:var(--muted)">Loading changelog...</p>';
    overlay.style.display = 'flex';

    try {
        const result = await window.voiceMirror.getChangelog(version);
        if (result.success) {
            body.innerHTML = renderMarkdown(result.data);
        } else {
            body.innerHTML = `<p>No changelog found for v${version}.</p>`;
        }
    } catch (err) {
        log.error('Failed to load changelog:', err);
        body.innerHTML = '<p>Failed to load changelog.</p>';
    }
}

/**
 * Close the What's New modal.
 */
function closeWhatsNewModal() {
    if (overlay) overlay.style.display = 'none';
}

/**
 * Show the "What's New" banner in the sidebar footer.
 */
function showWhatsNewBanner(version) {
    const banner = document.getElementById('sidebar-update-banner');
    if (!banner) return;

    const text = document.getElementById('update-banner-text');
    const btn = document.getElementById('update-banner-btn');
    const icon = banner.querySelector('.update-icon');

    if (text) text.textContent = `Updated to v${version}`;
    if (btn) {
        btn.textContent = "What's New";
        btn.disabled = false;
        btn.onclick = () => showWhatsNewModal(version);
    }
    // Swap icon to a sparkle/star instead of download arrow
    if (icon) {
        icon.innerHTML = '<path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>';
        icon.setAttribute('fill', 'currentColor');
        icon.setAttribute('stroke', 'none');
    }

    banner.style.display = '';
    banner.className = 'success';

    // Show dismiss button for post-update banner (not needed for update/restart banners)
    const dismissBtn = document.getElementById('update-banner-dismiss');
    if (dismissBtn) {
        dismissBtn.style.display = '';
        dismissBtn.onclick = () => { banner.style.display = 'none'; };
    }
}

/**
 * Initialize What's New detection on startup.
 * Call after config is loaded and app is initialized.
 */
export async function initWhatsNew() {
    try {
        const [config, currentVersion] = await Promise.all([
            window.voiceMirror.config.get(),
            window.voiceMirror.getAppVersion(),
        ]);

        const lastSeen = config.system?.lastSeenVersion;

        if (lastSeen === null || lastSeen === undefined) {
            // First install — silently set baseline, no notification
            log.info('First install detected, setting version baseline:', currentVersion);
            await window.voiceMirror.markVersionSeen(currentVersion);
            return;
        }

        if (lastSeen === currentVersion) {
            // Same version — nothing to do
            return;
        }

        // Version changed — show notification in sidebar
        log.info(`Version changed: ${lastSeen} → ${currentVersion}`);

        // Mark seen immediately so we don't show again on next restart
        await window.voiceMirror.markVersionSeen(currentVersion);

        showWhatsNewBanner(currentVersion);
    } catch (err) {
        log.error('Failed to check version:', err);
    }
}
