<script>
  /**
   * SettingsPanel.svelte -- Settings container with tab navigation.
   *
   * Manages which settings sub-panel is visible.
   * Tab order:
   *   - General
   *   - AI & Tools
   *   - Voice & Audio
   *   - Appearance
   *   - Dependencies (hidden behind advanced.showDependencies flag)
   */
  import { configStore } from '../../lib/stores/config.svelte.js';
  import BehaviorSettings from './BehaviorSettings.svelte';
  import VoiceSettings from './VoiceSettings.svelte';
  import AISettings from './AISettings.svelte';
  import AppearanceSettings from './AppearanceSettings.svelte';
  import DependencySettings from './DependencySettings.svelte';

  const TABS = [
    { id: 'general', label: 'General' },
    { id: 'ai', label: 'AI & Tools' },
    { id: 'voice', label: 'Voice & Audio' },
    { id: 'appearance', label: 'Appearance' },
    { id: 'dependencies', label: 'Dependencies', flag: 'showDependencies' },
  ];

  let activeTab = $state('general');

  const showDependencies = $derived(configStore.value?.advanced?.showDependencies === true);

  const visibleTabs = $derived(
    TABS.filter(tab => {
      if (tab.flag === 'showDependencies') return showDependencies;
      return true;
    })
  );

  function switchTab(tabId) {
    activeTab = tabId;
  }
</script>

<div class="settings-panel">
  <div class="settings-header">
    <h2>Settings</h2>
  </div>

  <div class="settings-tabs" role="tablist">
    {#each visibleTabs as tab}
      <button
        class="settings-tab"
        class:active={activeTab === tab.id}
        role="tab"
        aria-selected={activeTab === tab.id}
        aria-controls="settings-tab-{tab.id}"
        onclick={() => switchTab(tab.id)}
      >
        {tab.label}
      </button>
    {/each}
  </div>

  <div class="settings-body">
    {#if activeTab === 'ai'}
      <div
        id="settings-tab-ai"
        class="settings-tab-content"
        role="tabpanel"
      >
        <AISettings />
      </div>
    {:else if activeTab === 'voice'}
      <div
        id="settings-tab-voice"
        class="settings-tab-content"
        role="tabpanel"
      >
        <VoiceSettings />
      </div>
    {:else if activeTab === 'general'}
      <div
        id="settings-tab-general"
        class="settings-tab-content"
        role="tabpanel"
      >
        <BehaviorSettings />
      </div>
    {:else if activeTab === 'appearance'}
      <div
        id="settings-tab-appearance"
        class="settings-tab-content"
        role="tabpanel"
      >
        <AppearanceSettings />
      </div>
    {:else if activeTab === 'dependencies' && showDependencies}
      <div
        id="settings-tab-dependencies"
        class="settings-tab-content"
        role="tabpanel"
      >
        <DependencySettings />
      </div>
    {/if}
  </div>
</div>

<style>
  .settings-panel {
    display: flex;
    flex-direction: column;
    height: 100%;
    overflow: hidden;
    background: var(--bg);
  }

  .settings-header {
    display: flex;
    align-items: center;
    padding: 16px 24px;
    border-bottom: 1px solid var(--border);
    background: var(--bg-accent);
    flex-shrink: 0;
  }

  .settings-header h2 {
    color: var(--text-strong);
    font-size: 18px;
    font-weight: 600;
    margin: 0;
  }

  .settings-tabs {
    display: flex;
    gap: 0;
    border-bottom: 1px solid var(--border);
    padding: 0 24px;
    background: var(--bg-accent);
    flex-shrink: 0;
  }

  .settings-tab {
    padding: 10px 20px;
    border: none;
    border-bottom: 2px solid transparent;
    background: none;
    color: var(--muted);
    font-size: 13px;
    font-weight: 500;
    font-family: var(--font-family);
    cursor: pointer;
    transition:
      color var(--duration-normal) var(--ease-out),
      border-color var(--duration-normal) var(--ease-out);
    white-space: nowrap;
  }

  .settings-tab:hover {
    color: var(--text);
  }

  .settings-tab.active {
    color: var(--text-strong);
    border-bottom-color: var(--accent);
    font-weight: 600;
  }

  .settings-body {
    flex: 1;
    overflow-y: auto;
    padding: 20px 24px;
  }

  .settings-tab-content {
    max-width: 600px;
  }

  @media (prefers-reduced-motion: reduce) {
    .settings-tab {
      transition: none;
    }
  }
</style>
