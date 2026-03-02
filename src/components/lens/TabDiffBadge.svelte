<script>
  let { tab } = $props();
</script>

{#if tab.type === 'diff' && tab.diffStats}
  <span class="tab-diff-stats">
    <span class="tab-diff-stats-add">+{tab.diffStats.additions}</span>
    <span class="tab-diff-stats-del">-{tab.diffStats.deletions}</span>
  </span>
{:else if tab.type === 'diff' && tab.status}
  <span
    class="tab-diff-badge"
    class:added={tab.status === 'added'}
    class:modified={tab.status === 'modified'}
    class:deleted={tab.status === 'deleted'}
  >{tab.status === 'added' ? 'A' : tab.status === 'deleted' ? 'D' : 'M'}</span>
{/if}

<style>
.tab-diff-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 14px;
  height: 14px;
  font-size: 9px;
  font-weight: 700;
  border-radius: 2px;
  flex-shrink: 0;
  color: var(--bg);
}
.tab-diff-badge.added { background: var(--ok); }
.tab-diff-badge.modified { background: var(--accent); }
.tab-diff-badge.deleted { background: var(--danger); }

.tab-diff-stats {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 10px;
  font-weight: 600;
  font-family: var(--font-mono);
  flex-shrink: 0;
}
.tab-diff-stats-add { color: var(--ok); }
.tab-diff-stats-del { color: var(--danger); }
</style>
