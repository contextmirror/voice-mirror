<script>
  /**
   * ToolSettings.svelte -- MCP Tool Group management panel.
   *
   * Shows all tool groups with toggle switches, tool count, and descriptions.
   * Supports saving/loading named tool profiles.
   */
  import { configStore, updateConfig } from '../../lib/stores/config.svelte.js';
  import { toastStore } from '../../lib/stores/toast.svelte.js';
  import Toggle from '../shared/Toggle.svelte';
  import Select from '../shared/Select.svelte';
  import Button from '../shared/Button.svelte';

  // ---- Tool group definitions (mirrors mcp-server/tool-groups.js) ----

  const TOOL_GROUPS = [
    {
      id: 'core',
      name: 'Core',
      description: 'Voice communication (send, inbox, listen, status)',
      toolCount: 4,
      alwaysLoaded: true,
    },
    {
      id: 'meta',
      name: 'Meta',
      description: 'Tool management (load, unload, list groups)',
      toolCount: 3,
      alwaysLoaded: true,
    },
    {
      id: 'screen',
      name: 'Screen',
      description: 'Screen capture and vision analysis',
      toolCount: 1,
      alwaysLoaded: false,
    },
    {
      id: 'memory',
      name: 'Memory',
      description: 'Persistent memory system (search, store, recall, forget)',
      toolCount: 6,
      alwaysLoaded: false,
    },
    {
      id: 'voice-clone',
      name: 'Voice Clone',
      description: 'Voice cloning for TTS customization',
      toolCount: 3,
      alwaysLoaded: false,
    },
    {
      id: 'browser',
      name: 'Browser',
      description: 'Chrome browser control and web research (16 tools)',
      toolCount: 16,
      alwaysLoaded: false,
    },
    {
      id: 'n8n',
      name: 'n8n',
      description: 'Workflow automation (22 tools)',
      toolCount: 22,
      alwaysLoaded: false,
    },
    {
      id: 'diagnostic',
      name: 'Diagnostic',
      description: 'Pipeline tracing and debugging',
      toolCount: 1,
      alwaysLoaded: false,
    },
    {
      id: 'memory-facade',
      name: 'Memory (Lite)',
      description: 'Single-tool memory for voice mode',
      toolCount: 1,
      alwaysLoaded: false,
    },
    {
      id: 'n8n-facade',
      name: 'n8n (Lite)',
      description: 'Single-tool n8n for voice mode',
      toolCount: 1,
      alwaysLoaded: false,
    },
    {
      id: 'browser-facade',
      name: 'Browser (Lite)',
      description: 'Single-tool browser for voice mode',
      toolCount: 1,
      alwaysLoaded: false,
    },
  ];

  // ---- Default profiles ----

  const DEFAULT_PROFILES = {
    'voice-assistant': {
      label: 'Voice Assistant',
      groups: ['core', 'meta', 'screen', 'memory', 'browser'],
    },
    'voice-assistant-lite': {
      label: 'Voice Assistant (Lite)',
      groups: ['core', 'meta', 'screen', 'memory-facade', 'browser-facade'],
    },
    'n8n-workflows': {
      label: 'n8n Workflows',
      groups: ['core', 'meta', 'n8n'],
    },
    'web-browser': {
      label: 'Web Browser',
      groups: ['core', 'meta', 'screen', 'browser'],
    },
    'full-toolbox': {
      label: 'Full Toolbox',
      groups: ['core', 'meta', 'screen', 'memory', 'voice-clone', 'browser', 'n8n'],
    },
    'minimal': {
      label: 'Minimal',
      groups: ['core', 'meta'],
    },
  };

  // ---- Local state ----

  let activeProfile = $state('voice-assistant');
  let enabledGroups = $state(new Set(['core', 'meta', 'screen', 'memory', 'browser']));
  let saving = $state(false);

  // ---- Derived values ----

  const profileOptions = $derived(
    Object.entries(DEFAULT_PROFILES).map(([key, profile]) => ({
      value: key,
      label: profile.label,
    }))
  );

  const totalToolCount = $derived(
    TOOL_GROUPS
      .filter(g => enabledGroups.has(g.id))
      .reduce((sum, g) => sum + g.toolCount, 0)
  );

  // ---- Sync from config store ----

  $effect(() => {
    const cfg = configStore.value;
    if (!cfg) return;

    activeProfile = cfg.ai?.toolProfile || 'voice-assistant';
    const profiles = cfg.ai?.toolProfiles || {};
    const profile = profiles[activeProfile];
    if (profile?.groups) {
      enabledGroups = new Set(profile.groups);
    }
  });

  // ---- Handlers ----

  function handleProfileChange(profileId) {
    activeProfile = profileId;
    const profile = DEFAULT_PROFILES[profileId];
    if (profile) {
      enabledGroups = new Set(profile.groups);
    }
  }

  function handleGroupToggle(groupId, enabled) {
    const next = new Set(enabledGroups);
    if (enabled) {
      next.add(groupId);
    } else {
      next.delete(groupId);
    }
    enabledGroups = next;
    // When manually toggling, set profile to "custom" (but we don't add it to the dropdown)
    activeProfile = detectMatchingProfile(next) || activeProfile;
  }

  function detectMatchingProfile(groups) {
    for (const [key, profile] of Object.entries(DEFAULT_PROFILES)) {
      const profileSet = new Set(profile.groups);
      if (profileSet.size === groups.size && [...groups].every(g => profileSet.has(g))) {
        return key;
      }
    }
    return null;
  }

  async function saveToolSettings() {
    saving = true;
    try {
      const groups = [...enabledGroups];
      const patch = {
        ai: {
          toolProfile: activeProfile,
          toolProfiles: {
            [activeProfile]: { groups },
          },
        },
      };
      await updateConfig(patch);
      toastStore.addToast({ message: 'Tool settings saved', severity: 'success' });
    } catch (err) {
      console.error('[ToolSettings] Save failed:', err);
      toastStore.addToast({ message: 'Failed to save tool settings', severity: 'error' });
    } finally {
      saving = false;
    }
  }
</script>

<div class="tool-settings">
  <!-- Profile Selector -->
  <section class="settings-section">
    <h3>Tool Profile</h3>
    <div class="settings-group">
      <Select
        label="Active Profile"
        value={activeProfile}
        options={profileOptions}
        onChange={handleProfileChange}
      />
      <div class="tool-count-badge">
        <span class="tool-count-label">Total tools:</span>
        <span class="tool-count-value">{totalToolCount}</span>
      </div>
    </div>
  </section>

  <!-- Tool Groups -->
  <section class="settings-section">
    <h3>Tool Groups</h3>
    <div class="settings-group">
      {#each TOOL_GROUPS as group}
        <Toggle
          label="{group.name} ({group.toolCount} tools)"
          description={group.description}
          checked={enabledGroups.has(group.id)}
          disabled={group.alwaysLoaded}
          onChange={(v) => handleGroupToggle(group.id, v)}
        />
      {/each}
    </div>
  </section>

  <!-- Save Button -->
  <div class="settings-actions">
    <Button variant="primary" onClick={saveToolSettings} disabled={saving}>
      {saving ? 'Saving...' : 'Save Tool Settings'}
    </Button>
  </div>
</div>

<style>
  .tool-settings {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .settings-section {
    margin-bottom: 24px;
  }

  .settings-section h3 {
    color: var(--accent);
    font-size: 12px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    margin: 0 0 12px 0;
  }

  .settings-group {
    background: var(--card-highlight);
    border-radius: var(--radius-md);
    padding: 4px;
  }

  .tool-count-badge {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px;
    gap: 8px;
  }

  .tool-count-label {
    color: var(--muted);
    font-size: 13px;
  }

  .tool-count-value {
    color: var(--accent);
    font-size: 14px;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
  }

  .settings-actions {
    display: flex;
    gap: 12px;
    padding: 16px 0;
    border-top: 1px solid var(--border);
    margin-top: 8px;
  }
</style>
