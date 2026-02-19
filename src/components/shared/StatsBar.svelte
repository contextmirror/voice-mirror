<script>
  /**
   * StatsBar.svelte -- Lightweight floating performance stats bar.
   *
   * Shows CPU% and MEM (MB) in the bottom-right corner.
   * Toggled via the stats-dashboard global shortcut (Ctrl+Shift+M).
   * Polls the Rust backend every 3 seconds when visible.
   */
  import { getProcessStats } from '../../lib/api.js';

  let { visible = $bindable() } = $props();

  let cpu = $state('--');
  let mem = $state('--');

  $effect(() => {
    if (!visible) return;

    // Prime the first reading (sysinfo needs a prior refresh for CPU delta)
    getProcessStats().catch(() => {});

    const interval = setInterval(async () => {
      try {
        const stats = await getProcessStats();
        if (stats?.data) {
          cpu = stats.data.cpu.toFixed(1);
          mem = Math.round(stats.data.rss);
        } else if (stats?.cpu !== undefined) {
          cpu = stats.cpu.toFixed(1);
          mem = Math.round(stats.rss);
        }
      } catch {
        // Silently ignore — stats are non-critical
      }
    }, 3000);

    return () => clearInterval(interval);
  });
</script>

{#if visible}
  <div class="stats-bar">
    <span>CPU: {cpu}%</span>
    <span class="sep">|</span>
    <span>MEM: {mem}MB</span>
  </div>
{/if}

<style>
  .stats-bar {
    position: fixed;
    bottom: 4px;
    right: 8px;
    z-index: 9998;
    background: rgba(0, 0, 0, 0.7);
    color: var(--ok);
    font-family: var(--font-mono, 'Cascadia Code', 'Fira Code', monospace);
    font-size: 11px;
    padding: 2px 8px;
    border-radius: 4px;
    pointer-events: none;
    user-select: none;
    white-space: nowrap;
  }

  .sep {
    color: var(--muted);
    margin: 0 4px;
  }
</style>
