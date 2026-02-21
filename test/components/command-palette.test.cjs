/**
 * command-palette.test.cjs -- Source-inspection tests for CommandPalette.svelte
 *
 * Validates imports, props, commands, keyboard handling, file search,
 * styling, and accessibility by reading the source and asserting patterns.
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

  it('imports searchFiles from api.js', () => {
    assert.ok(
      src.includes("import { searchFiles }") && src.includes('api.js'),
      'Should import searchFiles from api.js'
    );
  });

  it('imports tabsStore', () => {
    assert.ok(
      src.includes("import { tabsStore }") && src.includes('tabs.svelte.js'),
      'Should import tabsStore from tabs.svelte.js'
    );
  });

  it('imports projectStore', () => {
    assert.ok(
      src.includes("import { projectStore }") && src.includes('project.svelte.js'),
      'Should import projectStore from project.svelte.js'
    );
  });

  it('imports layoutStore', () => {
    assert.ok(
      src.includes("import { layoutStore }") && src.includes('layout.svelte.js'),
      'Should import layoutStore from layout.svelte.js'
    );
  });

  it('imports navigationStore', () => {
    assert.ok(
      src.includes("import { navigationStore }") && src.includes('navigation.svelte.js'),
      'Should import navigationStore from navigation.svelte.js'
    );
  });

  it('imports lensStore for freeze-frame', () => {
    assert.ok(
      src.includes("import { lensStore }") && src.includes('lens.svelte.js'),
      'Should import lensStore from lens.svelte.js'
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
});

// ============ Search Input ============

describe('CommandPalette: search input', () => {
  it('has placeholder text "Search files and commands..."', () => {
    assert.ok(
      src.includes('placeholder="Search files and commands..."'),
      'Input should have placeholder "Search files and commands..."'
    );
  });

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

// ============ Built-in Commands ============

describe('CommandPalette: built-in commands', () => {
  const expectedCommands = [
    { id: 'open-lens', label: 'Open Lens' },
    { id: 'new-session', label: 'New Session' },
    { id: 'toggle-terminal', label: 'Toggle Terminal' },
    { id: 'toggle-chat', label: 'Toggle Chat' },
    { id: 'toggle-file-tree', label: 'Toggle File Tree' },
    { id: 'open-settings', label: 'Settings' },
  ];

  it('defines a commands array', () => {
    assert.ok(
      src.includes('const commands = ['),
      'Should define const commands array'
    );
  });

  it('has all built-in commands', () => {
    for (const cmd of expectedCommands) {
      assert.ok(
        src.includes(`id: '${cmd.id}'`),
        `Should have command with id '${cmd.id}'`
      );
    }
  });

  for (const cmd of expectedCommands) {
    it(`has command "${cmd.id}" with label "${cmd.label}"`, () => {
      assert.ok(
        src.includes(`id: '${cmd.id}'`),
        `Should have command id '${cmd.id}'`
      );
      assert.ok(
        src.includes(`label: '${cmd.label}'`),
        `Should have label '${cmd.label}'`
      );
    });
  }

  it('all commands have category "command"', () => {
    assert.ok(
      src.includes("category: 'command'"),
      'Commands should have category "command"'
    );
  });

  it('new-session has hint Ctrl+Shift+S', () => {
    assert.ok(
      src.includes("hint: 'Ctrl+Shift+S'"),
      'new-session should have hint Ctrl+Shift+S'
    );
  });

  it('toggle-terminal has hint Ctrl+`', () => {
    assert.ok(
      src.includes("hint: 'Ctrl+`'"),
      'toggle-terminal should have hint Ctrl+`'
    );
  });

  it('open-settings has hint Ctrl+,', () => {
    assert.ok(
      src.includes("hint: 'Ctrl+,'"),
      'open-settings should have hint Ctrl+,'
    );
  });
});

// ============ Command Handlers ============

describe('CommandPalette: command handlers', () => {
  it('defines commandHandlers object', () => {
    assert.ok(
      src.includes('const commandHandlers = {'),
      'Should define commandHandlers object'
    );
  });

  it('toggle-terminal calls layoutStore.toggleTerminal()', () => {
    assert.ok(
      src.includes("'toggle-terminal': () => layoutStore.toggleTerminal()"),
      'toggle-terminal should call layoutStore.toggleTerminal()'
    );
  });

  it('toggle-chat calls layoutStore.toggleChat()', () => {
    assert.ok(
      src.includes("'toggle-chat': () => layoutStore.toggleChat()"),
      'toggle-chat should call layoutStore.toggleChat()'
    );
  });

  it('toggle-file-tree calls layoutStore.toggleFileTree()', () => {
    assert.ok(
      src.includes("'toggle-file-tree': () => layoutStore.toggleFileTree()"),
      'toggle-file-tree should call layoutStore.toggleFileTree()'
    );
  });

  it('open-settings calls navigationStore.setView("settings")', () => {
    assert.ok(
      src.includes("'open-settings': () => navigationStore.setView('settings')"),
      'open-settings should call navigationStore.setView("settings")'
    );
  });

  it('new-session has a handler (TODO)', () => {
    assert.ok(
      src.includes("'new-session':"),
      'new-session should have a handler entry'
    );
  });

  it('executeItem dispatches command handlers', () => {
    assert.ok(
      src.includes("commandHandlers[item.id]"),
      'executeItem should look up handler by item.id'
    );
  });

  it('executeItem opens file via tabsStore.openFile', () => {
    assert.ok(
      src.includes("tabsStore.openFile({ name: item.name, path: item.path })"),
      'executeItem should call tabsStore.openFile for file items'
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
    // In the Escape handler block
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

// ============ Fuzzysort Usage ============

describe('CommandPalette: fuzzysort usage', () => {
  it('uses fuzzysort.go for command filtering', () => {
    assert.ok(
      src.includes("fuzzysort.go(query, commands, { key: 'label'"),
      'Should use fuzzysort.go with commands and key: "label"'
    );
  });

  it('uses fuzzysort.go for file filtering', () => {
    assert.ok(
      src.includes('fuzzysort.go(query, cachedFiles,'),
      'Should use fuzzysort.go with cachedFiles'
    );
  });

  it('limits command results to 10', () => {
    assert.ok(
      src.includes('limit: 10'),
      'Command filter should limit to 10 results'
    );
  });

  it('limits file results to 20', () => {
    assert.ok(
      src.includes('limit: 20'),
      'File filter should limit to 20 results'
    );
  });

  it('maps fuzzysort results to objects', () => {
    assert.ok(
      src.includes('results.map(r => r.obj)'),
      'Command results should map to r.obj'
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

  it('displays keyboard hint for commands with hints', () => {
    assert.ok(
      src.includes('class="item-hint"') && src.includes('{item.hint}'),
      'Should render item-hint with the command hint text'
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

  it('shows start typing prompt', () => {
    assert.ok(
      src.includes('Start typing to search...'),
      'Should show "Start typing to search..." as initial prompt'
    );
  });

  it('renders "Files" category header', () => {
    assert.ok(
      src.includes("label: 'Files'"),
      'Should have "Files" category header in allResults'
    );
  });

  it('renders "Commands" category header', () => {
    assert.ok(
      src.includes("label: 'Commands'"),
      'Should have "Commands" category header in allResults'
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
      src.includes('onmouseenter={() => { selectedIndex = selIdx; }}'),
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

  it('uses $derived.by for filteredCommands', () => {
    assert.ok(
      src.includes('let filteredCommands = $derived.by('),
      'filteredCommands should use $derived.by'
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

  it('uses $derived for selectableItems (filters out headers)', () => {
    assert.ok(
      src.includes("let selectableItems = $derived(allResults.filter(i => i.type !== 'header'))"),
      'selectableItems should derive from allResults filtering out headers'
    );
  });

  it('$effect focuses input when visible', () => {
    assert.ok(
      src.includes("inputEl?.focus()"),
      'Should focus inputEl when visible'
    );
  });

  it('$effect resets query and selectedIndex when visible', () => {
    assert.ok(
      src.includes("if (visible)") && src.includes("query = ''") && src.includes('selectedIndex = 0'),
      'Should reset query and selectedIndex when palette opens'
    );
  });

  it('$effect fetches files when visible', () => {
    assert.ok(
      src.includes('fetchFiles()'),
      'Should call fetchFiles when palette becomes visible'
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
