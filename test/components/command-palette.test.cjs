/**
 * command-palette.test.cjs -- Source-inspection tests for CommandPalette.svelte
 *
 * Validates imports, props, prefix-based modes, keyboard handling, file search,
 * command execution, go-to-line/symbol, styling, and accessibility by reading
 * the source and asserting patterns.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(
  path.join(__dirname, '../../src/components/lens/CommandPalette.svelte'),
  'utf-8'
);

// ============ Imports ============

describe('CommandPalette: imports', () => {
  it('imports fuzzysort', () => {
    assert.ok(
      src.includes("import fuzzysort from 'fuzzysort'"),
      'Should import fuzzysort'
    );
  });

  it('imports searchFiles and lspRequestDocumentSymbols from api.js', () => {
    assert.ok(
      src.includes('searchFiles') && src.includes('api.js'),
      'Should import searchFiles from api.js'
    );
    assert.ok(
      src.includes('lspRequestDocumentSymbols'),
      'Should import lspRequestDocumentSymbols from api.js'
    );
  });

  it('imports commandRegistry from commands.svelte.js', () => {
    assert.ok(
      src.includes('commandRegistry') && src.includes('commands.svelte.js'),
      'Should import commandRegistry from commands.svelte.js'
    );
  });

  it('imports tabsStore', () => {
    assert.ok(
      src.includes('tabsStore') && src.includes('tabs.svelte.js'),
      'Should import tabsStore from tabs.svelte.js'
    );
  });

  it('imports projectStore', () => {
    assert.ok(
      src.includes('projectStore') && src.includes('project.svelte.js'),
      'Should import projectStore from project.svelte.js'
    );
  });

  it('imports lensStore for freeze-frame', () => {
    assert.ok(
      src.includes('lensStore') && src.includes('lens.svelte.js'),
      'Should import lensStore from lens.svelte.js'
    );
  });

  it('imports editorGroupsStore', () => {
    assert.ok(
      src.includes('editorGroupsStore') && src.includes('editor-groups.svelte.js'),
      'Should import editorGroupsStore from editor-groups.svelte.js'
    );
  });
});

describe('CommandPalette: freeze-frame', () => {
  it('freezes webview when visible', () => {
    assert.ok(
      src.includes('lensStore.freeze()'),
      'Should call lensStore.freeze() when visible'
    );
  });

  it('unfreezes webview when closed', () => {
    assert.ok(
      src.includes('lensStore.unfreeze()'),
      'Should call lensStore.unfreeze() when closed'
    );
  });
});

// ============ Props ============

describe('CommandPalette: props', () => {
  it('has visible prop as $bindable', () => {
    assert.ok(
      src.includes('visible = $bindable('),
      'visible should be a $bindable prop'
    );
  });

  it('has onClose prop with default', () => {
    assert.ok(
      src.includes('onClose') && src.includes('$props()'),
      'Should have onClose prop via $props()'
    );
  });

  it('onClose defaults to a no-op function', () => {
    assert.ok(
      src.includes('onClose = () => {}'),
      'onClose should default to () => {}'
    );
  });

  it('has initialMode prop', () => {
    assert.ok(
      src.includes('initialMode'),
      'Should have initialMode prop for opening mode'
    );
  });
});

// ============ Mode Detection ============

describe('CommandPalette: mode detection', () => {
  it('derives mode from query prefix', () => {
    assert.ok(
      src.includes('let mode = $derived.by('),
      'mode should be $derived.by'
    );
  });

  it('detects > prefix for command mode', () => {
    assert.ok(
      src.includes("startsWith('>')") && src.includes("'commands'"),
      'Should detect > prefix for command mode'
    );
  });

  it('detects : prefix for goto-line mode', () => {
    assert.ok(
      src.includes("startsWith(':')") && src.includes("'goto-line'"),
      'Should detect : prefix for goto-line mode'
    );
  });

  it('detects @ prefix for goto-symbol mode', () => {
    assert.ok(
      src.includes("startsWith('@')") && src.includes("'goto-symbol'"),
      'Should detect @ prefix for goto-symbol mode'
    );
  });

  it('defaults to files mode', () => {
    assert.ok(
      src.includes("return 'files'"),
      'Should default to files mode when no prefix'
    );
  });

  it('has strippedQuery that removes prefix', () => {
    assert.ok(
      src.includes('strippedQuery') && src.includes('query.slice(1)'),
      'Should strip prefix from query'
    );
  });

  it('has dynamic placeholder per mode', () => {
    assert.ok(
      src.includes('let placeholder = $derived.by('),
      'placeholder should be $derived.by based on mode'
    );
    assert.ok(
      src.includes('Search files and commands...'),
      'Should have files mode placeholder'
    );
    assert.ok(
      src.includes('Type a command name...'),
      'Should have commands mode placeholder'
    );
  });
});

// ============ Search Input ============

describe('CommandPalette: search input', () => {
  it('has spellcheck disabled', () => {
    assert.ok(
      src.includes('spellcheck="false"'),
      'Input should have spellcheck="false"'
    );
  });

  it('has autocomplete disabled', () => {
    assert.ok(
      src.includes('autocomplete="off"'),
      'Input should have autocomplete="off"'
    );
  });

  it('binds input value to query', () => {
    assert.ok(
      src.includes('bind:value={query}'),
      'Input should bind to query'
    );
  });

  it('binds input element to inputEl', () => {
    assert.ok(
      src.includes('bind:this={inputEl}'),
      'Input should bind element ref to inputEl'
    );
  });
});

// ============ Command Mode ============

describe('CommandPalette: command mode', () => {
  it('derives commandResults from registry', () => {
    assert.ok(
      src.includes('let commandResults = $derived.by('),
      'commandResults should be $derived.by'
    );
  });

  it('calls commandRegistry.search for queries', () => {
    assert.ok(
      src.includes('commandRegistry.search(strippedQuery)'),
      'Should call commandRegistry.search for filtered results'
    );
  });

  it('calls commandRegistry.getAll for empty query', () => {
    assert.ok(
      src.includes('commandRegistry.getAll()'),
      'Should call commandRegistry.getAll for grouped view'
    );
  });

  it('executes commands via commandRegistry.execute', () => {
    assert.ok(
      src.includes('commandRegistry.execute(item.id)'),
      'Should call commandRegistry.execute(item.id) for command items'
    );
  });

  it('renders keybinding badges for commands', () => {
    assert.ok(
      src.includes('item.keybinding') && src.includes('class="item-hint"'),
      'Should render keybinding badges via item.keybinding'
    );
  });

  it('renders category tags for commands', () => {
    assert.ok(
      src.includes('item.category') && src.includes('class="item-category"'),
      'Should render category tag for command items'
    );
  });
});

// ============ Go-to-Line Mode ============

describe('CommandPalette: go-to-line mode', () => {
  it('parses line number from strippedQuery', () => {
    assert.ok(
      src.includes('parseInt(strippedQuery, 10)'),
      'Should parse line number from stripped query'
    );
  });

  it('dispatches lens-goto-position event', () => {
    assert.ok(
      src.includes('lens-goto-position-'),
      'Should dispatch lens-goto-position event'
    );
  });

  it('uses editorGroupsStore.focusedGroupId', () => {
    assert.ok(
      src.includes('editorGroupsStore.focusedGroupId'),
      'Should use focusedGroupId for goto event dispatch'
    );
  });

  it('shows goto-line item with label', () => {
    assert.ok(
      src.includes("type: 'goto-line'") && src.includes('Go to line'),
      'Should create goto-line item with label'
    );
  });
});

// ============ Go-to-Symbol Mode ============

describe('CommandPalette: go-to-symbol mode', () => {
  it('has symbols state', () => {
    assert.ok(
      src.includes('let symbols = $state('),
      'Should have symbols state variable'
    );
  });

  it('has loadingSymbols state', () => {
    assert.ok(
      src.includes('let loadingSymbols = $state('),
      'Should have loadingSymbols state'
    );
  });

  it('defines fetchSymbols function', () => {
    assert.ok(
      src.includes('async function fetchSymbols()'),
      'Should define fetchSymbols async function'
    );
  });

  it('calls lspRequestDocumentSymbols', () => {
    assert.ok(
      src.includes('lspRequestDocumentSymbols('),
      'Should call lspRequestDocumentSymbols for symbol data'
    );
  });

  it('uses fuzzysort for symbol filtering', () => {
    assert.ok(
      src.includes('fuzzysort.go(strippedQuery, symbols,'),
      'Should use fuzzysort to filter symbols'
    );
  });

  it('has SYMBOL_KIND_LABELS mapping', () => {
    assert.ok(
      src.includes('SYMBOL_KIND_LABELS') && src.includes('function') && src.includes('class') && src.includes('variable'),
      'Should have SYMBOL_KIND_LABELS with standard LSP kinds'
    );
  });

  it('renders symbol kind badges', () => {
    assert.ok(
      src.includes('class="symbol-kind"'),
      'Should render symbol-kind badge class'
    );
  });

  it('fetches symbols on mode change', () => {
    assert.ok(
      src.includes("mode === 'goto-symbol'") && src.includes('fetchSymbols()'),
      'Should fetch symbols when entering goto-symbol mode'
    );
  });
});

// ============ Command Execution ============

describe('CommandPalette: command execution', () => {
  it('has executeItem function', () => {
    assert.ok(
      src.includes('function executeItem(item)'),
      'Should define executeItem function'
    );
  });

  it('handles command type items', () => {
    assert.ok(
      src.includes("item.type === 'command'"),
      'Should handle command type items'
    );
  });

  it('handles file type items via tabsStore.openFile', () => {
    assert.ok(
      src.includes("item.type === 'file'") &&
      src.includes('tabsStore.openFile('),
      'Should handle file type items via tabsStore.openFile'
    );
  });

  it('handles goto-line type items', () => {
    assert.ok(
      src.includes("item.type === 'goto-line'"),
      'Should handle goto-line type items'
    );
  });

  it('handles symbol type items', () => {
    assert.ok(
      src.includes("item.type === 'symbol'"),
      'Should handle symbol type items'
    );
  });

  it('calls close() after execution', () => {
    // close() should be called at the end of executeItem
    assert.ok(
      src.includes('close()'),
      'executeItem should call close() after executing'
    );
  });
});

// ============ Keyboard Navigation ============

describe('CommandPalette: keyboard navigation', () => {
  it('has handleKeydown function', () => {
    assert.ok(
      src.includes('function handleKeydown(e)'),
      'Should define handleKeydown function'
    );
  });

  it('handles ArrowDown key', () => {
    assert.ok(
      src.includes("e.key === 'ArrowDown'"),
      'Should handle ArrowDown key'
    );
  });

  it('handles ArrowUp key', () => {
    assert.ok(
      src.includes("e.key === 'ArrowUp'"),
      'Should handle ArrowUp key'
    );
  });

  it('handles Enter key', () => {
    assert.ok(
      src.includes("e.key === 'Enter'"),
      'Should handle Enter key'
    );
  });

  it('handles Escape key', () => {
    assert.ok(
      src.includes("e.key === 'Escape'"),
      'Should handle Escape key'
    );
  });

  it('ArrowDown wraps around with modulo', () => {
    assert.ok(
      src.includes('(selectedIndex + 1) % selectableItems.length'),
      'ArrowDown should wrap around using modulo'
    );
  });

  it('ArrowUp wraps around with modulo', () => {
    assert.ok(
      src.includes('(selectedIndex - 1 + selectableItems.length) % selectableItems.length'),
      'ArrowUp should wrap around using modulo'
    );
  });

  it('Enter executes the selected item', () => {
    assert.ok(
      src.includes('const item = selectableItems[selectedIndex]') &&
      src.includes('if (item) executeItem(item)'),
      'Enter should execute the selected item'
    );
  });

  it('Escape calls close()', () => {
    assert.ok(
      src.includes("'Escape'") && src.includes('close()'),
      'Escape should call close()'
    );
  });

  it('calls e.preventDefault() for all key handlers', () => {
    const preventDefaultCount = (src.match(/e\.preventDefault\(\)/g) || []).length;
    assert.ok(
      preventDefaultCount >= 4,
      `Should call e.preventDefault() at least 4 times (ArrowDown, ArrowUp, Enter, Escape), found ${preventDefaultCount}`
    );
  });

  it('binds onkeydown to the modal', () => {
    assert.ok(
      src.includes('onkeydown={handleKeydown}'),
      'Modal should bind onkeydown to handleKeydown'
    );
  });
});

// ============ File Search ============

describe('CommandPalette: file search helpers', () => {
  it('defines extractFilename function', () => {
    assert.ok(
      src.includes('function extractFilename(filepath)'),
      'Should define extractFilename function'
    );
  });

  it('extractFilename splits on / and \\', () => {
    assert.ok(
      src.includes("filepath.split(/[/\\\\]/).pop()"),
      'extractFilename should split on / and \\ and take last element'
    );
  });

  it('defines extractDirectory function', () => {
    assert.ok(
      src.includes('function extractDirectory(filepath)'),
      'Should define extractDirectory function'
    );
  });

  it('extractDirectory splits on / and \\', () => {
    assert.ok(
      src.includes("filepath.split(/[/\\\\]/)"),
      'extractDirectory should split on / and \\'
    );
  });

  it('extractDirectory pops last part and joins with /', () => {
    assert.ok(
      src.includes("parts.pop()") && src.includes("parts.join('/')"),
      'extractDirectory should pop filename and join remaining with /'
    );
  });
});

describe('CommandPalette: file fetching', () => {
  it('defines fetchFiles async function', () => {
    assert.ok(
      src.includes('async function fetchFiles()'),
      'Should define async fetchFiles function'
    );
  });

  it('fetchFiles uses projectStore.activeProject', () => {
    assert.ok(
      src.includes('projectStore.activeProject'),
      'fetchFiles should read projectStore.activeProject'
    );
  });

  it('fetchFiles calls searchFiles with project path', () => {
    assert.ok(
      src.includes('searchFiles(project.path)'),
      'fetchFiles should call searchFiles(project.path)'
    );
  });

  it('fetchFiles sets loadingFiles state', () => {
    assert.ok(
      src.includes('loadingFiles = true') && src.includes('loadingFiles = false'),
      'fetchFiles should toggle loadingFiles'
    );
  });

  it('fetchFiles handles errors gracefully', () => {
    assert.ok(
      src.includes('catch (err)') && src.includes('cachedFiles = []'),
      'fetchFiles should catch errors and reset cachedFiles'
    );
  });
});

// ============ Fuzzysort Usage ============

describe('CommandPalette: fuzzysort usage', () => {
  it('uses fuzzysort.go for file filtering', () => {
    assert.ok(
      src.includes('fuzzysort.go(strippedQuery, cachedFiles,'),
      'Should use fuzzysort.go with cachedFiles'
    );
  });

  it('limits file results to 20', () => {
    assert.ok(
      src.includes('limit: 20'),
      'File filter should limit to 20 results'
    );
  });

  it('uses fuzzysort.go for symbol filtering', () => {
    assert.ok(
      src.includes('fuzzysort.go(strippedQuery, symbols,'),
      'Should use fuzzysort.go for symbol filtering'
    );
  });
});

// ============ Results Display ============

describe('CommandPalette: results display', () => {
  it('renders category-header elements', () => {
    assert.ok(
      src.includes('class="category-header"'),
      'Should render category-header class'
    );
  });

  it('renders result-item elements', () => {
    assert.ok(
      src.includes('class="result-item"'),
      'Should render result-item class'
    );
  });

  it('renders file-icon for file results', () => {
    assert.ok(
      src.includes('class="item-icon file-icon"'),
      'Should render file-icon class for file items'
    );
  });

  it('renders cmd-icon for command results', () => {
    assert.ok(
      src.includes('class="item-icon cmd-icon"'),
      'Should render cmd-icon class for command items'
    );
  });

  it('displays item label', () => {
    assert.ok(
      src.includes('class="item-label"'),
      'Should render item-label class'
    );
  });

  it('displays item path for file results', () => {
    assert.ok(
      src.includes('class="item-path"'),
      'Should render item-path class'
    );
  });

  it('displays keybinding hints for commands', () => {
    assert.ok(
      src.includes('class="item-hint"') && src.includes('item.keybinding'),
      'Should render item-hint with keybinding text'
    );
  });

  it('shows loading state', () => {
    assert.ok(
      src.includes('Loading files...'),
      'Should show "Loading files..." when loading'
    );
  });

  it('shows no-results message', () => {
    assert.ok(
      src.includes('No results for'),
      'Should show "No results for" when query has no matches'
    );
  });

  it('shows no-commands message', () => {
    assert.ok(
      src.includes('No commands matching'),
      'Should show "No commands matching" when command query has no matches'
    );
  });

  it('shows start typing prompt', () => {
    assert.ok(
      src.includes('Start typing to search'),
      'Should show start typing prompt as initial state'
    );
  });

  it('renders "Files" category header', () => {
    assert.ok(
      src.includes("label: 'Files'"),
      'Should have "Files" category header in allResults'
    );
  });

  it('has mode-pill for prefix modes', () => {
    assert.ok(
      src.includes('class="mode-pill"'),
      'Should have mode-pill class for prefix indicator'
    );
  });
});

// ============ Styling ============

describe('CommandPalette: styling', () => {
  it('has z-index 10002 on backdrop', () => {
    assert.ok(
      src.includes('z-index: 10002'),
      'Backdrop should have z-index: 10002'
    );
  });

  it('has -webkit-app-region no-drag on backdrop', () => {
    assert.ok(
      src.includes('.backdrop') && src.includes('-webkit-app-region: no-drag'),
      'Backdrop should have -webkit-app-region: no-drag'
    );
  });

  it('has -webkit-app-region no-drag on modal element', () => {
    assert.ok(
      src.includes('style="-webkit-app-region: no-drag"'),
      'Modal element should have inline -webkit-app-region: no-drag'
    );
  });

  it('has backdrop class with fixed position', () => {
    assert.ok(
      src.includes('.backdrop') && src.includes('position: fixed'),
      'Backdrop should have position: fixed'
    );
  });

  it('uses accent-subtle for selected items', () => {
    assert.ok(
      src.includes('.result-item.selected') && src.includes('var(--accent-subtle)'),
      'Selected result-item should use var(--accent-subtle) background'
    );
  });

  it('modal uses bg-elevated background', () => {
    assert.ok(
      src.includes('.modal') && src.includes('var(--bg-elevated)'),
      'Modal should use var(--bg-elevated) background'
    );
  });

  it('modal has max-width of 560px', () => {
    assert.ok(
      src.includes('max-width: 560px'),
      'Modal should have max-width: 560px'
    );
  });

  it('modal has max-height of 60vh', () => {
    assert.ok(
      src.includes('max-height: 60vh'),
      'Modal should have max-height: 60vh'
    );
  });

  it('modal has border-radius 12px', () => {
    assert.ok(
      src.includes('border-radius: 12px'),
      'Modal should have border-radius: 12px'
    );
  });
});

// ============ Accessibility ============

describe('CommandPalette: accessibility', () => {
  it('uses data-selected attribute for selected items', () => {
    assert.ok(
      src.includes('data-selected={selIdx === selectedIndex}'),
      'Should set data-selected attribute based on selectedIndex'
    );
  });

  it('uses scrollIntoView for selected items', () => {
    assert.ok(
      src.includes("el.scrollIntoView({ block: 'nearest' })"),
      'Should call scrollIntoView with block: nearest'
    );
  });

  it('scrollSelectedIntoView queries data-selected="true"', () => {
    assert.ok(
      src.includes('[data-selected="true"]'),
      'scrollSelectedIntoView should query for data-selected="true"'
    );
  });

  it('scrollSelectedIntoView uses requestAnimationFrame', () => {
    assert.ok(
      src.includes('requestAnimationFrame'),
      'scrollSelectedIntoView should use requestAnimationFrame'
    );
  });

  it('mouseenter updates selectedIndex', () => {
    assert.ok(
      src.includes('onmouseenter') && src.includes('selectedIndex = selIdx'),
      'mouseenter should update selectedIndex'
    );
  });

  it('mousedown triggers executeItem', () => {
    assert.ok(
      src.includes('onmousedown={() => executeItem(item)}'),
      'mousedown should call executeItem'
    );
  });
});

// ============ State Management ============

describe('CommandPalette: state management', () => {
  it('uses $state for query', () => {
    assert.ok(
      src.includes("let query = $state('')"),
      'query should be $state'
    );
  });

  it('uses $state for selectedIndex', () => {
    assert.ok(
      src.includes('let selectedIndex = $state(0)'),
      'selectedIndex should be $state(0)'
    );
  });

  it('uses $state for inputEl', () => {
    assert.ok(
      src.includes('let inputEl = $state(null)'),
      'inputEl should be $state(null)'
    );
  });

  it('uses $state for listEl', () => {
    assert.ok(
      src.includes('let listEl = $state(null)'),
      'listEl should be $state(null)'
    );
  });

  it('uses $state for cachedFiles', () => {
    assert.ok(
      src.includes('let cachedFiles = $state([])'),
      'cachedFiles should be $state([])'
    );
  });

  it('uses $state for loadingFiles', () => {
    assert.ok(
      src.includes('let loadingFiles = $state(false)'),
      'loadingFiles should be $state(false)'
    );
  });

  it('uses $derived.by for filteredFiles', () => {
    assert.ok(
      src.includes('let filteredFiles = $derived.by('),
      'filteredFiles should use $derived.by'
    );
  });

  it('uses $derived.by for allResults', () => {
    assert.ok(
      src.includes('let allResults = $derived.by('),
      'allResults should use $derived.by'
    );
  });

  it('uses $derived for selectableItems (filters out headers and hints)', () => {
    assert.ok(
      src.includes('let selectableItems = $derived(') && src.includes("'header'") && src.includes("'hint'"),
      'selectableItems should derive from allResults filtering out headers and hints'
    );
  });

  it('$effect focuses input when visible', () => {
    assert.ok(
      src.includes("inputEl?.focus()"),
      'Should focus inputEl when visible'
    );
  });

  it('$effect pre-fills prefix based on initialMode', () => {
    assert.ok(
      src.includes('initialMode') && src.includes("query = '>'") && src.includes("query = ':'") && src.includes("query = '@'"),
      'Should pre-fill query with prefix based on initialMode'
    );
  });

  it('$effect fetches files when visible', () => {
    assert.ok(
      src.includes('fetchFiles()'),
      'Should call fetchFiles when palette becomes visible'
    );
  });

  it('$effect resets selectedIndex when query changes', () => {
    assert.ok(
      src.includes('selectedIndex = 0'),
      'Should reset selectedIndex to 0'
    );
  });

  it('close() resets state', () => {
    assert.ok(
      src.includes('function close()') &&
      src.includes('visible = false') &&
      src.includes("query = ''") &&
      src.includes('onClose()'),
      'close() should reset visible, query, and call onClose()'
    );
  });
});

// ============ Conditional Rendering ============

describe('CommandPalette: conditional rendering', () => {
  it('renders only when visible is true', () => {
    assert.ok(
      src.includes('{#if visible}'),
      'Should conditionally render based on visible'
    );
  });

  it('has backdrop click handler', () => {
    assert.ok(
      src.includes('handleBackdropClick'),
      'Should have handleBackdropClick function'
    );
  });

  it('backdrop click closes when clicking the backdrop itself', () => {
    assert.ok(
      src.includes('e.target === e.currentTarget'),
      'handleBackdropClick should only close when target is currentTarget'
    );
  });
});
