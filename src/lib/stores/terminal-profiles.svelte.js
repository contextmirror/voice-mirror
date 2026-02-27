/**
 * terminal-profiles.svelte.js -- Terminal profile detection and management.
 *
 * Detects available shell profiles from the Rust backend (Git Bash,
 * PowerShell, CMD, etc.) and provides a reactive store for the UI.
 */

import { terminalDetectProfiles } from '../api.js';

function createTerminalProfilesStore() {
  let profiles = $state([]);
  let defaultProfileId = $state(null);
  let loaded = $state(false);

  return {
    get profiles() { return profiles; },
    get defaultProfileId() { return defaultProfileId; },
    get loaded() { return loaded; },

    getDefaultProfile() {
      return profiles.find(p => p.id === defaultProfileId) || profiles[0] || null;
    },

    getProfile(id) {
      return profiles.find(p => p.id === id) || null;
    },

    async loadProfiles() {
      try {
        const result = await terminalDetectProfiles();
        if (result?.success && Array.isArray(result.data)) {
          profiles = result.data;
          const def = profiles.find(p => p.is_default);
          if (def) defaultProfileId = def.id;
        }
      } catch (err) {
        console.error('[terminal-profiles] Failed to detect profiles:', err);
      }
      loaded = true;
    },

    setDefault(id) {
      defaultProfileId = id;
    },
  };
}

export const terminalProfilesStore = createTerminalProfilesStore();
