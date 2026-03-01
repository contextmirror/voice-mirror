const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SRC_PATH = path.join(__dirname, '../../src/components/terminal/TerminalTabs.svelte');
const src = fs.readFileSync(SRC_PATH, 'utf-8');

describe('TerminalTabs -- project channel dropdown', () => {
  it('renders project channels from outputStore', () => {
    assert.ok(
      src.includes('projectChannels') || src.includes('projectChannel'),
      'Should reference project channels'
    );
  });

  it('has a separator between project and system channels', () => {
    assert.ok(
      src.includes('channel-divider') || src.includes('channel-separator'),
      'Should have a visual separator element'
    );
  });

  it('renders project channels above system channels in dropdown', () => {
    // Inside the dropdown menu, project channels block should appear before system channels
    const dropdownMenuIdx = src.indexOf('channel-dropdown-menu');
    const afterMenu = src.slice(dropdownMenuIdx);
    const projectIdx = afterMenu.indexOf('projectChannels');
    const systemIdx = afterMenu.indexOf('outputStore.channels as ch');
    assert.ok(projectIdx !== -1, 'Should have projectChannels in dropdown');
    assert.ok(systemIdx !== -1, 'Should have system channels in dropdown');
    assert.ok(projectIdx < systemIdx, 'Project channels should render before system channels in the dropdown');
  });

  it('has error badge on Output tab', () => {
    assert.ok(
      src.includes('hasProjectErrors') || src.includes('error-badge'),
      'Should show error badge for project errors'
    );
  });

  it('switches to project channel on click', () => {
    assert.ok(
      src.includes('selectChannel(pc.label)') || src.includes('switchChannel(pc.label)'),
      'Should switch channel on project channel click'
    );
  });

  it('shows checkmark for active project channel', () => {
    // Verify the active class is applied to project channel items
    assert.ok(
      src.includes("activeChannel === pc.label"),
      'Should highlight active project channel'
    );
  });

  it('only shows divider when project channels exist', () => {
    // The channel-divider should be inside the projectChannels.length > 0 block
    const projectLenCheck = src.indexOf('projectChannels.length > 0');
    const dividerIdx = src.indexOf('channel-divider');
    assert.ok(projectLenCheck !== -1, 'Should check projectChannels.length > 0');
    assert.ok(dividerIdx > projectLenCheck, 'Divider should be inside the project channels conditional');
  });

  it('displays project channel label as dropdown text when active', () => {
    // Fallback for project channel labels in the trigger
    assert.ok(
      src.includes('|| outputStore.activeChannel'),
      'Should fall back to activeChannel name for project channels'
    );
  });
});
