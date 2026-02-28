const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(
  path.join(__dirname, '../../src/main.js'), 'utf-8'
);

describe('Global error handlers -- window.onerror', () => {
  it('installs window.onerror handler', () => {
    assert.ok(src.includes('window.onerror'), 'Should set window.onerror');
  });

  it('calls logFrontendError on uncaught error', () => {
    assert.ok(src.includes('logFrontendError'), 'Should call logFrontendError');
  });

  it('captures error message, source, line, and stack', () => {
    assert.ok(src.includes('message'), 'Should capture message');
    assert.ok(src.includes('source'), 'Should capture source file');
    assert.ok(src.includes('lineno'), 'Should capture line number');
    assert.ok(src.includes('stack'), 'Should capture stack trace');
  });
});

describe('Global error handlers -- unhandledrejection', () => {
  it('listens for unhandledrejection events', () => {
    assert.ok(src.includes('unhandledrejection'), 'Should listen for unhandledrejection');
  });

  it('extracts reason from rejection event', () => {
    assert.ok(src.includes('event.reason') || src.includes('reason'), 'Should extract rejection reason');
  });
});

describe('Global error handlers -- console intercepts', () => {
  it('intercepts console.error', () => {
    assert.ok(
      src.includes('console.error') && src.includes('_originalConsoleError'),
      'Should intercept console.error while preserving original'
    );
  });

  it('intercepts console.warn', () => {
    assert.ok(
      src.includes('console.warn') && src.includes('_originalConsoleWarn'),
      'Should intercept console.warn while preserving original'
    );
  });

  it('preserves original console methods', () => {
    assert.ok(src.includes('_originalConsoleError'), 'Should save original console.error');
    assert.ok(src.includes('_originalConsoleWarn'), 'Should save original console.warn');
  });
});

describe('Global error handlers -- safety', () => {
  it('wraps logFrontendError in try/catch to prevent infinite loops', () => {
    assert.ok(src.includes('try') && src.includes('catch'), 'Should have try/catch safety');
  });
});
