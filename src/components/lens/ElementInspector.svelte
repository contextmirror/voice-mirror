<script>
  import { designSelectByTreeId, designExpandTreeNode } from '../../lib/api.js';

  /** @type {{ elementData?: object, onClose?: () => void, onUpdateData?: (data: object) => void }} */
  let { elementData = null, onClose = () => {}, onUpdateData = () => {} } = $props();

  // --- Tab state ---
  let activeTab = $state('design');

  // --- Tree state ---
  let expandedNodes = $state(new Set());

  $effect(() => {
    if (elementData?.domTree) {
      const newExpanded = new Set();
      walkTree(elementData.domTree, (node) => {
        if (node.isOnPath || node.isSelected) {
          newExpanded.add(node.nodeId);
        }
      });
      expandedNodes = newExpanded;
    }
  });

  function walkTree(node, fn) {
    if (!node) return;
    fn(node);
    if (node.children) {
      for (const child of node.children) {
        walkTree(child, fn);
      }
    }
  }

  async function toggleExpand(node) {
    const newSet = new Set(expandedNodes);
    if (newSet.has(node.nodeId)) {
      newSet.delete(node.nodeId);
    } else {
      newSet.add(node.nodeId);
      if (node.childCount > 0 && (!node.children || node.children.length === 0)) {
        const result = await designExpandTreeNode(node.nodeId);
        if (result?.success && result.data) {
          onUpdateData({ ...elementData, _expandedNodeId: node.nodeId, _expandedChildren: result.data });
        }
      }
    }
    expandedNodes = newSet;
  }

  async function selectTreeNode(nodeId) {
    await designSelectByTreeId(nodeId);
  }

  function formatNodeLabel(node) {
    let label = node.tagName;
    if (node.id) label += '#' + node.id;
    else if (node.classes) {
      const first = node.classes.split(' ')[0];
      if (first) label += '.' + first;
    }
    return label;
  }

  function isColorValue(value) {
    if (!value) return false;
    return /^(rgb|rgba|hsl|hsla|#)/.test(value.trim());
  }

  function getStyle(prop) {
    const all = elementData?.allStyles || elementData?.styles || {};
    return all[prop] || '';
  }

  function parsePixels(val) {
    if (!val && val !== 0) return '0';
    const n = parseFloat(val);
    return isNaN(n) ? String(val) : String(Math.round(n * 100) / 100);
  }

  // --- Computed values ---
  let bounds = $derived(elementData?.bounds || {});
  let styles = $derived(elementData?.styles || {});
  let allStyles = $derived(elementData?.allStyles || elementData?.styles || {});

  let sortedCssProps = $derived.by(() => {
    const entries = Object.entries(allStyles);
    entries.sort((a, b) => a[0].localeCompare(b[0]));
    return entries;
  });
</script>

<div class="element-inspector" role="complementary">
  <button class="panel-close" onclick={onClose} aria-label="Close inspector">&times;</button>

  <!-- Components tree -->
  <div class="tree-section">
    <div class="tree-header">Components</div>
    <div class="tree-scroll">
      {#if elementData?.domTree}
        {#snippet treeNode(node, depth)}
          <div
            class="tree-node"
            class:selected={node.isSelected}
            style="padding-left: {depth * 16}px"
          >
            {#if node.childCount > 0}
              <button class="expand-btn" onclick={() => toggleExpand(node)}>
                {expandedNodes.has(node.nodeId) ? '▼' : '▶'}
              </button>
            {:else}
              <span class="expand-spacer"></span>
            {/if}
            <button class="node-label" onclick={() => selectTreeNode(node.nodeId)}>
              {formatNodeLabel(node)}
            </button>
          </div>
          {#if expandedNodes.has(node.nodeId) && node.children}
            {#each node.children as child}
              {@render treeNode(child, depth + 1)}
            {/each}
          {/if}
        {/snippet}
        {@render treeNode(elementData.domTree, 0)}
      {/if}
    </div>
  </div>

  <!-- Design | CSS tabs -->
  <div class="tab-bar">
    <button class="tab-btn" class:active={activeTab === 'design'} onclick={() => activeTab = 'design'}>Design</button>
    <button class="tab-btn" class:active={activeTab === 'css'} onclick={() => activeTab = 'css'}>CSS</button>
  </div>

  <!-- Tab content -->
  <div class="tab-content">
    {#if activeTab === 'design'}
      <!-- Position -->
      <div class="ds">
        <div class="ds-header">Position</div>
        <div class="field-grid">
          <div class="field"><span class="field-l">X</span><span class="field-v">{parsePixels(bounds.x)}</span><span class="field-u">px</span></div>
          <div class="field"><span class="field-l">Y</span><span class="field-v">{parsePixels(bounds.y)}</span><span class="field-u">px</span></div>
        </div>
      </div>

      <!-- Layout -->
      <div class="ds">
        <div class="ds-header">Layout</div>
        <div class="prop-row">
          <span class="prop-label">Display</span>
          <span class="prop-val">{getStyle('display') || 'block'}</span>
        </div>
        {#if getStyle('display')?.includes('flex')}
          <div class="prop-row">
            <span class="prop-label">Direction</span>
            <span class="prop-val">{getStyle('flex-direction') || 'row'}</span>
          </div>
          <div class="prop-row">
            <span class="prop-label">Align</span>
            <span class="prop-val">{getStyle('align-items') || 'stretch'}</span>
          </div>
          <div class="prop-row">
            <span class="prop-label">Justify</span>
            <span class="prop-val">{getStyle('justify-content') || 'flex-start'}</span>
          </div>
          <div class="prop-row">
            <span class="prop-label">Gap</span>
            <span class="prop-val">{getStyle('gap') || '0px'}</span>
          </div>
        {/if}
        <div class="field-grid" style="margin-top: 6px">
          <div class="field"><span class="field-l">W</span><span class="field-v">{parsePixels(bounds.width)}</span><span class="field-u">px</span></div>
          <div class="field"><span class="field-l">H</span><span class="field-v">{parsePixels(bounds.height)}</span><span class="field-u">px</span></div>
        </div>
      </div>

      <!-- Padding -->
      <div class="ds">
        <div class="ds-header">Padding</div>
        <div class="box-grid">
          <div class="box-field"><span class="box-side">top</span><span class="box-val">{parsePixels(getStyle('padding-top'))}</span></div>
          <div class="box-field"><span class="box-side">right</span><span class="box-val">{parsePixels(getStyle('padding-right'))}</span></div>
          <div class="box-field"><span class="box-side">bottom</span><span class="box-val">{parsePixels(getStyle('padding-bottom'))}</span></div>
          <div class="box-field"><span class="box-side">left</span><span class="box-val">{parsePixels(getStyle('padding-left'))}</span></div>
        </div>
      </div>

      <!-- Margin -->
      <div class="ds">
        <div class="ds-header">Margin</div>
        <div class="box-grid">
          <div class="box-field"><span class="box-side">top</span><span class="box-val">{parsePixels(getStyle('margin-top'))}</span></div>
          <div class="box-field"><span class="box-side">right</span><span class="box-val">{parsePixels(getStyle('margin-right'))}</span></div>
          <div class="box-field"><span class="box-side">bottom</span><span class="box-val">{parsePixels(getStyle('margin-bottom'))}</span></div>
          <div class="box-field"><span class="box-side">left</span><span class="box-val">{parsePixels(getStyle('margin-left'))}</span></div>
        </div>
      </div>

      <!-- Appearance -->
      <div class="ds">
        <div class="ds-header">Appearance</div>
        <div class="prop-row">
          <span class="prop-label">Opacity</span>
          <span class="prop-val">{Math.round(parseFloat(getStyle('opacity') || '1') * 100)}%</span>
        </div>
        <div class="prop-row">
          <span class="prop-label">Corner Radius</span>
          <span class="prop-val">{getStyle('border-radius') || '0px'}</span>
        </div>
        {#if getStyle('box-shadow') && getStyle('box-shadow') !== 'none'}
          <div class="prop-row">
            <span class="prop-label">Shadow</span>
            <span class="prop-val truncate">{getStyle('box-shadow')}</span>
          </div>
        {/if}
      </div>

      <!-- Text -->
      <div class="ds">
        <div class="ds-header">Text</div>
        <div class="prop-row">
          <span class="prop-label">Font</span>
          <span class="prop-val truncate">{getStyle('font-family') || 'inherit'}</span>
        </div>
        <div class="prop-row">
          <span class="prop-label">Size</span>
          <span class="prop-val">{getStyle('font-size') || '16px'}</span>
        </div>
        <div class="prop-row">
          <span class="prop-label">Weight</span>
          <span class="prop-val">{getStyle('font-weight') || '400'}</span>
        </div>
        <div class="prop-row">
          <span class="prop-label">Color</span>
          <span class="prop-val">
            {#if isColorValue(getStyle('color'))}
              <span class="swatch" style="background: {getStyle('color')}"></span>
            {/if}
            {getStyle('color')}
          </span>
        </div>
        <div class="prop-row">
          <span class="prop-label">Line Height</span>
          <span class="prop-val">{getStyle('line-height') || 'normal'}</span>
        </div>
      </div>
    {:else}
      <!-- CSS tab: all computed styles alphabetical -->
      <div class="css-list">
        {#each sortedCssProps as [prop, value]}
          <div class="css-row">
            <span class="css-prop">{prop}</span>
            <span class="css-value" title={value}>
              {#if isColorValue(value)}
                <span class="swatch" style="background: {value}"></span>
              {/if}
              {value}
            </span>
          </div>
        {/each}
      </div>
    {/if}
  </div>
</div>

<style>
  .element-inspector {
    width: 300px;
    min-width: 300px;
    height: 100%;
    display: flex;
    flex-direction: column;
    background: var(--bg);
    border-left: 1px solid var(--border);
    color: var(--text);
    font-size: 12px;
    overflow: hidden;
    position: relative;
  }

  .panel-close {
    position: absolute;
    top: 4px;
    right: 6px;
    background: none;
    border: none;
    color: var(--text-secondary);
    font-size: 14px;
    cursor: pointer;
    padding: 2px 4px;
    line-height: 1;
    z-index: 1;
  }

  .panel-close:hover {
    color: var(--text);
  }

  /* --- Tree --- */
  .tree-section {
    flex: 0 0 auto;
    max-height: 40%;
    display: flex;
    flex-direction: column;
    border-bottom: 1px solid var(--border);
  }

  .tree-header {
    font-size: 11px;
    font-weight: 500;
    color: var(--text-secondary);
    padding: 8px 10px 4px;
  }

  .tree-scroll {
    overflow-y: auto;
    flex: 1;
    padding-bottom: 4px;
  }

  .tree-node {
    display: flex;
    align-items: center;
    height: 22px;
    cursor: default;
    white-space: nowrap;
  }

  .tree-node.selected {
    background: color-mix(in srgb, var(--accent) 20%, transparent);
  }

  .expand-btn {
    background: none;
    border: none;
    color: var(--text-secondary);
    font-size: 10px;
    width: 16px;
    height: 16px;
    padding: 0;
    cursor: pointer;
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .expand-spacer {
    width: 16px;
    flex-shrink: 0;
  }

  .node-label {
    background: none;
    border: none;
    color: var(--text);
    font-family: monospace;
    font-size: 12px;
    padding: 0 4px;
    cursor: pointer;
    text-align: left;
  }

  .node-label:hover {
    color: var(--accent);
  }

  /* --- Tabs --- */
  .tab-bar {
    display: flex;
    gap: 2px;
    padding: 6px 10px;
    border-bottom: 1px solid var(--border);
  }

  .tab-btn {
    padding: 3px 10px;
    border: none;
    border-radius: 4px;
    background: transparent;
    color: var(--text-secondary);
    font-size: 11px;
    font-weight: 500;
    cursor: pointer;
  }

  .tab-btn.active {
    background: color-mix(in srgb, var(--text) 15%, transparent);
    color: var(--text);
  }

  .tab-btn:hover:not(.active) {
    color: var(--text);
  }

  /* --- Tab content --- */
  .tab-content {
    flex: 1;
    overflow-y: auto;
  }

  /* --- Design sections --- */
  .ds {
    padding: 8px 10px;
    border-bottom: 1px solid var(--border);
  }

  .ds-header {
    font-size: 11px;
    font-weight: 500;
    color: var(--text-secondary);
    margin-bottom: 6px;
  }

  .field-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 4px;
  }

  .field {
    display: flex;
    align-items: center;
    gap: 4px;
    background: color-mix(in srgb, var(--text) 8%, transparent);
    border-radius: 3px;
    padding: 3px 6px;
    font-family: monospace;
    font-size: 11px;
  }

  .field-l {
    color: var(--text-secondary);
    font-size: 10px;
    min-width: 10px;
  }

  .field-v {
    flex: 1;
    color: var(--text);
  }

  .field-u {
    color: var(--text-secondary);
    font-size: 10px;
  }

  /* Property rows */
  .prop-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 2px 0;
    gap: 8px;
  }

  .prop-label {
    color: var(--text-secondary);
    font-size: 11px;
  }

  .prop-val {
    font-family: monospace;
    font-size: 11px;
    color: var(--text);
    display: flex;
    align-items: center;
    gap: 4px;
  }

  .prop-val.truncate {
    max-width: 140px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* Box model grid (Padding, Margin) */
  .box-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 4px;
  }

  .box-field {
    display: flex;
    align-items: center;
    gap: 4px;
    background: color-mix(in srgb, var(--text) 8%, transparent);
    border-radius: 3px;
    padding: 3px 6px;
    font-family: monospace;
    font-size: 11px;
  }

  .box-side {
    color: var(--text-secondary);
    font-size: 10px;
    min-width: 30px;
  }

  .box-val {
    flex: 1;
    color: var(--text);
  }

  /* --- CSS tab --- */
  .css-list {
    display: flex;
    flex-direction: column;
  }

  .css-row {
    display: flex;
    gap: 8px;
    padding: 2px 10px;
    line-height: 1.6;
  }

  .css-row:hover {
    background: color-mix(in srgb, var(--text) 5%, transparent);
  }

  .css-prop {
    font-family: monospace;
    font-size: 11px;
    color: var(--text-secondary);
    flex-shrink: 0;
    min-width: 130px;
  }

  .css-value {
    font-family: monospace;
    font-size: 11px;
    color: var(--text);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    display: flex;
    align-items: center;
    gap: 4px;
  }

  .swatch {
    display: inline-block;
    width: 10px;
    height: 10px;
    border: 1px solid var(--border);
    border-radius: 2px;
    flex-shrink: 0;
  }
</style>
