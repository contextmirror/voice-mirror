const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(
  path.join(__dirname, '../../src/components/lens/DevicePreviewStrip.svelte'),
  'utf-8'
);

describe('DevicePreviewStrip component', () => {
  describe('imports', () => {
    it('imports devicePreviewStore', () => {
      assert.ok(src.includes('devicePreviewStore'), 'should import devicePreviewStore');
    });

    it('imports getPresetById', () => {
      assert.ok(src.includes('getPresetById'), 'should import getPresetById');
    });

    it('imports DevicePickerMenu', () => {
      assert.ok(src.includes('DevicePickerMenu'), 'should import DevicePickerMenu');
    });
  });

  describe('state', () => {
    it('has pickerVisible or showPicker state', () => {
      assert.ok(
        src.includes('pickerVisible') || src.includes('showPicker'),
        'should have picker visibility state'
      );
    });
  });

  describe('template structure', () => {
    it('has device-strip wrapper class', () => {
      assert.ok(src.includes('device-strip'), 'should have .device-strip class');
    });

    it('has device-chip class for device buttons', () => {
      assert.ok(src.includes('device-chip'), 'should have .device-chip class');
    });

    it('has removeDevice action on chip close', () => {
      assert.ok(src.includes('removeDevice'), 'should call removeDevice');
    });

    it('has add button', () => {
      assert.ok(
        src.includes('add-btn') || src.includes('add-button'),
        'should have add button'
      );
    });

    it('has toggleOrientation reference', () => {
      assert.ok(src.includes('toggleOrientation'), 'should reference toggleOrientation');
    });

    it('has toggleSync reference', () => {
      assert.ok(src.includes('toggleSync'), 'should reference toggleSync');
    });

    it('shows DevicePickerMenu conditionally', () => {
      assert.ok(
        src.includes('DevicePickerMenu') && (src.includes('pickerVisible') || src.includes('showPicker')),
        'should show DevicePickerMenu when picker is visible'
      );
    });
  });

  describe('styling', () => {
    it('has a <style> block', () => {
      assert.ok(src.includes('<style>'), 'should have a <style> block');
    });

    it('uses -webkit-app-region: no-drag for interactivity', () => {
      assert.ok(
        src.includes('-webkit-app-region: no-drag'),
        'should set -webkit-app-region: no-drag'
      );
    });
  });
});
