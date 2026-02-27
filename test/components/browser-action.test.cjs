const fs = require('fs');
const path = require('path');
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

// Read source files
const toolsSrc = fs.readFileSync(
  path.join(__dirname, '../../src-tauri/src/mcp/tools.rs'), 'utf-8'
);
const bridgeSrc = fs.readFileSync(
  path.join(__dirname, '../../src-tauri/src/services/browser_bridge.rs'), 'utf-8'
);
const serverSrc = fs.readFileSync(
  path.join(__dirname, '../../src-tauri/src/mcp/server.rs'), 'utf-8'
);
const handlerSrc = fs.readFileSync(
  path.join(__dirname, '../../src-tauri/src/mcp/handlers/browser.rs'), 'utf-8'
);
const cdpSrc = fs.readFileSync(
  path.join(__dirname, '../../src-tauri/src/services/cdp.rs'), 'utf-8'
);
const authSrc = fs.readFileSync(
  path.join(__dirname, '../../src-tauri/src/services/auth_vault.rs'), 'utf-8'
);

describe('browser_action MCP tool', () => {
  describe('tool definition (tools.rs)', () => {
    it('defines browser_action tool', () => {
      assert.ok(toolsSrc.includes('"browser_action"'));
    });

    it('does not define old individual browser tools', () => {
      // These were the old 16 tools - none should exist anymore
      assert.ok(!toolsSrc.includes('name: "browser_start"'));
      assert.ok(!toolsSrc.includes('name: "browser_stop"'));
      assert.ok(!toolsSrc.includes('name: "browser_navigate"'));
      assert.ok(!toolsSrc.includes('name: "browser_screenshot"'));
      assert.ok(!toolsSrc.includes('name: "browser_snapshot"'));
      assert.ok(!toolsSrc.includes('name: "browser_act"'));
    });

    it('action enum includes all core actions', () => {
      const requiredActions = [
        'navigate', 'back', 'forward', 'reload',
        'click', 'fill', 'screenshot', 'snapshot',
        'evaluate', 'tab_new', 'tab_list',
        'auth_save', 'auth_login', 'search', 'fetch',
        'hover', 'scroll', 'gettext', 'boundingbox',
        'wait', 'waitforurl',
      ];
      for (const action of requiredActions) {
        assert.ok(
          toolsSrc.includes(`"${action}"`),
          `Missing action in tool definition: ${action}`
        );
      }
    });

    it('has ref parameter for element targeting', () => {
      assert.ok(toolsSrc.includes('"ref"'));
    });

    it('has annotate parameter for screenshots', () => {
      assert.ok(toolsSrc.includes('"annotate"'));
    });
  });

  describe('server dispatch (server.rs)', () => {
    it('dispatches browser_action tool', () => {
      assert.ok(serverSrc.includes('"browser_action"'));
    });

    it('routes search and fetch to direct HTTP handlers', () => {
      assert.ok(serverSrc.includes('handle_browser_search'));
      assert.ok(serverSrc.includes('handle_browser_fetch'));
    });

    it('does not dispatch old individual tools', () => {
      assert.ok(!serverSrc.includes('"browser_start"'));
      assert.ok(!serverSrc.includes('"browser_navigate"'));
      assert.ok(!serverSrc.includes('"browser_screenshot"'));
    });
  });

  describe('browser bridge (browser_bridge.rs)', () => {
    it('has CDP method calling support', () => {
      assert.ok(
        bridgeSrc.includes('call_cdp_method') || bridgeSrc.includes('CallDevToolsProtocolMethod'),
        'Missing CDP call support'
      );
    });

    it('has shared ref map for element targeting', () => {
      assert.ok(bridgeSrc.includes('REF_MAP'), 'Missing REF_MAP');
    });

    it('has resolve_element_target helper', () => {
      assert.ok(bridgeSrc.includes('resolve_element_target'));
    });

    it('supports annotated screenshots with DOM overlay', () => {
      assert.ok(bridgeSrc.includes('annotate'));
      assert.ok(bridgeSrc.includes('__vm_overlay'));
    });

    it('handles click action with ref resolution', () => {
      assert.ok(bridgeSrc.includes('"click"'));
    });

    it('handles fill action', () => {
      assert.ok(bridgeSrc.includes('"fill"'));
    });

    it('handles type action', () => {
      assert.ok(bridgeSrc.includes('"type"'));
    });

    it('handles wait actions', () => {
      assert.ok(bridgeSrc.includes('"wait"'));
      assert.ok(bridgeSrc.includes('"waitforurl"'));
      assert.ok(bridgeSrc.includes('"waitforloadstate"'));
    });

    it('handles auth actions', () => {
      assert.ok(bridgeSrc.includes('"auth_save"'));
      assert.ok(bridgeSrc.includes('"auth_login"'));
    });

    it('uses CDP for snapshot instead of old SNAPSHOT_JS', () => {
      assert.ok(bridgeSrc.includes('Accessibility.getFullAXTree'));
      // Old SNAPSHOT_JS constant should be gone
      assert.ok(!bridgeSrc.includes('const SNAPSHOT_JS'));
    });
  });

  describe('CDP module (cdp.rs)', () => {
    it('exports parse_ax_tree function', () => {
      assert.ok(cdpSrc.includes('pub fn parse_ax_tree'));
    });

    it('exports RefEntry struct', () => {
      assert.ok(cdpSrc.includes('pub struct RefEntry'));
    });

    it('defines interactive roles list', () => {
      assert.ok(cdpSrc.includes('INTERACTIVE_ROLES'));
      assert.ok(cdpSrc.includes('"button"'));
      assert.ok(cdpSrc.includes('"textbox"'));
      assert.ok(cdpSrc.includes('"link"'));
    });

    it('defines content roles list', () => {
      assert.ok(cdpSrc.includes('CONTENT_ROLES'));
      assert.ok(cdpSrc.includes('"heading"'));
    });

    it('builds JS selectors from refs', () => {
      assert.ok(cdpSrc.includes('pub fn build_js_selector'));
    });

    it('has comprehensive unit tests', () => {
      assert.ok(cdpSrc.includes('#[cfg(test)]'));
      assert.ok(cdpSrc.includes('test_parse_ax_nodes_basic'));
      assert.ok(cdpSrc.includes('test_duplicate_role_name_gets_nth'));
    });
  });

  describe('auth vault (auth_vault.rs)', () => {
    it('exports AuthProfile struct', () => {
      assert.ok(authSrc.includes('pub struct AuthProfile'));
    });

    it('uses AES-256-GCM encryption', () => {
      assert.ok(authSrc.includes('Aes256Gcm'));
    });

    it('has encrypt and decrypt functions', () => {
      assert.ok(authSrc.includes('pub fn encrypt_data'));
      assert.ok(authSrc.includes('pub fn decrypt_data'));
    });

    it('has profile CRUD operations', () => {
      assert.ok(authSrc.includes('pub fn save_profile'));
      assert.ok(authSrc.includes('pub fn load_profile'));
      assert.ok(authSrc.includes('pub fn list_profiles'));
      assert.ok(authSrc.includes('pub fn delete_profile'));
    });

    it('has key management', () => {
      assert.ok(authSrc.includes('pub fn ensure_key'));
      assert.ok(authSrc.includes('pub fn generate_key'));
    });

    it('has comprehensive unit tests', () => {
      assert.ok(authSrc.includes('#[cfg(test)]'));
      assert.ok(authSrc.includes('test_encrypt_decrypt_roundtrip'));
      assert.ok(authSrc.includes('test_wrong_key_fails'));
    });
  });

  describe('MCP handler (handlers/browser.rs)', () => {
    it('exports handle_browser_control as main entry point', () => {
      assert.ok(handlerSrc.includes('pub async fn handle_browser_control'));
    });

    it('exports handle_browser_search for direct HTTP', () => {
      assert.ok(handlerSrc.includes('pub async fn handle_browser_search'));
    });

    it('exports handle_browser_fetch for direct HTTP', () => {
      assert.ok(handlerSrc.includes('pub async fn handle_browser_fetch'));
    });

    it('does not have old individual handler functions', () => {
      assert.ok(!handlerSrc.includes('pub async fn handle_browser_navigate'));
      assert.ok(!handlerSrc.includes('pub async fn handle_browser_screenshot'));
      assert.ok(!handlerSrc.includes('pub async fn handle_browser_snapshot'));
      assert.ok(!handlerSrc.includes('pub async fn handle_browser_act'));
      assert.ok(!handlerSrc.includes('pub async fn handle_browser_start'));
      assert.ok(!handlerSrc.includes('pub async fn handle_browser_stop'));
    });

    it('includes annotation support for screenshots', () => {
      assert.ok(handlerSrc.includes('annotations'));
    });

    it('has updated long action list', () => {
      assert.ok(handlerSrc.includes('"waitforurl"') || handlerSrc.includes('waitforurl'));
    });
  });
});
