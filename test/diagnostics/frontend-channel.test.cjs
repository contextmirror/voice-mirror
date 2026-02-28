const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const outputRs = fs.readFileSync(
  path.join(__dirname, '../../src-tauri/src/services/output.rs'), 'utf-8'
);
const commandsRs = fs.readFileSync(
  path.join(__dirname, '../../src-tauri/src/commands/output.rs'), 'utf-8'
);
const libRs = fs.readFileSync(
  path.join(__dirname, '../../src-tauri/src/lib.rs'), 'utf-8'
);
const apiJs = fs.readFileSync(
  path.join(__dirname, '../../src/lib/api.js'), 'utf-8'
);
const outputStore = fs.readFileSync(
  path.join(__dirname, '../../src/lib/stores/output.svelte.js'), 'utf-8'
);

describe('Frontend output channel -- Rust backend', () => {
  it('has Frontend variant in Channel enum', () => {
    assert.ok(outputRs.includes('Frontend'), 'Channel enum should have Frontend variant');
  });

  it('includes Frontend in Channel::ALL array', () => {
    assert.ok(outputRs.includes('Channel::Frontend'), 'ALL should include Channel::Frontend');
  });

  it('maps Frontend to "frontend" string', () => {
    assert.ok(outputRs.includes('"frontend"'), 'as_str should return "frontend"');
  });

  it('parses "frontend" back to Frontend variant', () => {
    assert.ok(
      outputRs.includes('"frontend" => Some(Channel::Frontend)'),
      'from_str should parse "frontend"'
    );
  });

  it('has idx mapping for Frontend', () => {
    assert.ok(outputRs.includes('Channel::Frontend =>'), 'idx should map Frontend');
  });
});

describe('Frontend output channel -- log_frontend_error command', () => {
  it('has log_frontend_error command in commands/output.rs', () => {
    assert.ok(commandsRs.includes('log_frontend_error'), 'Should have log_frontend_error command');
    assert.ok(commandsRs.includes('#[tauri::command]'), 'Should be a tauri command');
  });

  it('accepts level, message, and context fields', () => {
    assert.ok(commandsRs.includes('level'), 'Should accept level');
    assert.ok(commandsRs.includes('message'), 'Should accept message');
    assert.ok(commandsRs.includes('context'), 'Should accept context');
  });

  it('injects into Frontend channel', () => {
    assert.ok(
      commandsRs.includes('Channel::Frontend'),
      'Should inject into Frontend channel'
    );
  });

  it('is registered in lib.rs invoke_handler', () => {
    assert.ok(
      libRs.includes('output_cmds::log_frontend_error'),
      'Should be registered in invoke_handler'
    );
  });
});

describe('Frontend output channel -- api.js wrapper', () => {
  it('exports logFrontendError function', () => {
    assert.ok(apiJs.includes('logFrontendError'), 'Should export logFrontendError');
    assert.ok(apiJs.includes("'log_frontend_error'"), 'Should invoke log_frontend_error');
  });
});

describe('Frontend output channel -- output store', () => {
  it('includes frontend in CHANNELS array', () => {
    assert.ok(outputStore.includes("'frontend'"), 'CHANNELS should include frontend');
  });

  it('has frontend in entries state', () => {
    assert.ok(outputStore.includes('frontend:'), 'entries should have frontend key');
  });

  it('has Frontend label in CHANNEL_LABELS', () => {
    assert.ok(
      outputStore.includes("frontend:") && outputStore.includes("Frontend"),
      'CHANNEL_LABELS should have frontend entry'
    );
  });
});
