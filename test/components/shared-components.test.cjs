/**
 * shared-components.test.js -- Source-inspection tests for tauri/src/components/shared/
 *
 * Tests Button, Toggle, TextInput, Select, Slider, TitleBar, Toast,
 * ToastContainer, Skeleton, ErrorState, WhatsNewModal, OnboardingModal.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SHARED_DIR = path.join(__dirname, '../../src/components/shared');

function readComponent(name) {
  return fs.readFileSync(path.join(SHARED_DIR, name), 'utf-8');
}

// ---- Button.svelte ----

describe('Button.svelte', () => {
  const src = readComponent('Button.svelte');

  it('uses $props', () => {
    assert.ok(src.includes('$props()'), 'Should use $props');
  });

  it('has variant prop with default secondary', () => {
    assert.ok(src.includes("variant = 'secondary'"), 'Should default variant to secondary');
  });

  it('has disabled prop', () => {
    assert.ok(src.includes('disabled'), 'Should have disabled prop');
  });

  it('has onClick prop', () => {
    assert.ok(src.includes('onClick'), 'Should have onClick prop');
  });

  it('has type prop defaulting to button', () => {
    assert.ok(src.includes("type = 'button'"), 'Should default type to button');
  });

  it('has small prop for compact variant', () => {
    assert.ok(src.includes('small'), 'Should have small prop');
  });

  it('has children prop for slot content', () => {
    assert.ok(src.includes('children'), 'Should accept children');
    assert.ok(src.includes('{@render children()}'), 'Should render children');
  });

  it('has primary variant CSS', () => {
    assert.ok(src.includes('.btn-primary'), 'Should have primary variant CSS');
  });

  it('has secondary variant CSS', () => {
    assert.ok(src.includes('.btn-secondary'), 'Should have secondary variant CSS');
  });

  it('has danger variant CSS', () => {
    assert.ok(src.includes('.btn-danger'), 'Should have danger variant CSS');
  });

  it('has small variant CSS', () => {
    assert.ok(src.includes('.btn.small'), 'Should have small variant CSS');
  });

  it('has focus-visible outline', () => {
    assert.ok(src.includes(':focus-visible'), 'Should have focus-visible styles');
  });

  it('styles disabled state', () => {
    assert.ok(src.includes(':disabled'), 'Should style disabled state');
  });
});

// ---- Toggle.svelte ----

describe('Toggle.svelte', () => {
  const src = readComponent('Toggle.svelte');

  it('uses $props', () => {
    assert.ok(src.includes('$props()'), 'Should use $props');
  });

  it('has checked prop', () => {
    assert.ok(src.includes('checked'), 'Should have checked prop');
  });

  it('has onChange prop', () => {
    assert.ok(src.includes('onChange'), 'Should have onChange prop');
  });

  it('has label prop', () => {
    assert.ok(src.includes("label = ''"), 'Should have label prop');
  });

  it('has description prop', () => {
    assert.ok(src.includes("description = ''"), 'Should have description prop');
  });

  it('has disabled prop', () => {
    assert.ok(src.includes('disabled'), 'Should have disabled prop');
  });

  it('has checkbox input element', () => {
    assert.ok(src.includes('type="checkbox"'), 'Should use checkbox input');
  });

  it('has toggle-switch CSS', () => {
    assert.ok(src.includes('.toggle-switch'), 'Should have toggle-switch CSS');
  });

  it('has toggle-track CSS', () => {
    assert.ok(src.includes('.toggle-track'), 'Should have toggle-track CSS');
  });

  it('has toggle-label-group for label and description', () => {
    assert.ok(src.includes('toggle-label-group'), 'Should group label and description');
  });

  it('has focus-visible support on input', () => {
    assert.ok(src.includes('focus-visible'), 'Should have focus-visible styles');
  });

  it('fires onChange with new checked value', () => {
    assert.ok(src.includes('onChange(e.target.checked)'), 'Should fire onChange with value');
  });
});

// ---- TextInput.svelte ----

describe('TextInput.svelte', () => {
  const src = readComponent('TextInput.svelte');

  it('uses $props', () => {
    assert.ok(src.includes('$props()'), 'Should use $props');
  });

  it('has value prop', () => {
    assert.ok(src.includes("value = ''"), 'Should have value prop');
  });

  it('has placeholder prop', () => {
    assert.ok(src.includes("placeholder = ''"), 'Should have placeholder prop');
  });

  it('has onChange prop', () => {
    assert.ok(src.includes('onChange'), 'Should have onChange prop');
  });

  it('has label prop', () => {
    assert.ok(src.includes("label = ''"), 'Should have label prop');
  });

  it('has type prop supporting text/password/url/email', () => {
    assert.ok(src.includes("type = 'text'"), 'Should default type to text');
  });

  it('has disabled prop', () => {
    assert.ok(src.includes('disabled'), 'Should have disabled prop');
  });

  it('has readonly prop', () => {
    assert.ok(src.includes('readonly'), 'Should have readonly prop');
  });

  it('has input element', () => {
    assert.ok(src.includes('<input'), 'Should have input element');
  });

  it('has label element with for attribute', () => {
    assert.ok(src.includes('<label'), 'Should have label element');
    assert.ok(src.includes('for={inputId}'), 'Should associate label with input');
  });

  it('derives inputId from label text', () => {
    assert.ok(src.includes('inputId'), 'Should derive inputId');
  });

  it('has text-input CSS class', () => {
    assert.ok(src.includes('.text-input'), 'Should have text-input CSS');
  });
});

// ---- Select.svelte ----

describe('Select.svelte', () => {
  const src = readComponent('Select.svelte');

  it('uses $props', () => {
    assert.ok(src.includes('$props()'), 'Should use $props');
  });

  it('has value prop', () => {
    assert.ok(src.includes("value = ''"), 'Should have value prop');
  });

  it('has options prop', () => {
    assert.ok(src.includes('options = []'), 'Should have options prop');
  });

  it('has onChange prop', () => {
    assert.ok(src.includes('onChange'), 'Should have onChange prop');
  });

  it('has label prop', () => {
    assert.ok(src.includes("label = ''"), 'Should have label prop');
  });

  it('has disabled prop', () => {
    assert.ok(src.includes('disabled'), 'Should have disabled prop');
  });

  it('has select element', () => {
    assert.ok(src.includes('<select'), 'Should have select element');
  });

  it('renders option elements', () => {
    assert.ok(src.includes('<option'), 'Should render option elements');
  });

  it('supports grouped options with optgroup', () => {
    assert.ok(src.includes('<optgroup'), 'Should support optgroup');
  });

  it('derives grouped options from group field', () => {
    assert.ok(src.includes('grouped'), 'Should derive grouped options');
  });

  it('has label element with for attribute', () => {
    assert.ok(src.includes('<label'), 'Should have label element');
    assert.ok(src.includes('for={inputId}'), 'Should associate label with select');
  });

  it('has select-input CSS class', () => {
    assert.ok(src.includes('.select-input'), 'Should have select-input CSS');
  });
});

// ---- Slider.svelte ----

describe('Slider.svelte', () => {
  const src = readComponent('Slider.svelte');

  it('uses $props', () => {
    assert.ok(src.includes('$props()'), 'Should use $props');
  });

  it('has value, min, max, step props', () => {
    assert.ok(src.includes('value = 0'), 'Should have value prop');
    assert.ok(src.includes('min = 0'), 'Should have min prop');
    assert.ok(src.includes('max = 100'), 'Should have max prop');
    assert.ok(src.includes('step = 1'), 'Should have step prop');
  });

  it('has onChange prop', () => {
    assert.ok(src.includes('onChange'), 'Should have onChange prop');
  });

  it('has label prop', () => {
    assert.ok(src.includes("label = ''"), 'Should have label prop');
  });

  it('has formatValue prop', () => {
    assert.ok(src.includes('formatValue'), 'Should have formatValue prop');
  });

  it('has range input element', () => {
    assert.ok(src.includes('type="range"'), 'Should have range input');
  });

  it('displays formatted value', () => {
    assert.ok(src.includes('displayValue'), 'Should derive displayValue');
    assert.ok(src.includes('slider-value'), 'Should show slider value');
  });

  it('has slider-input CSS class', () => {
    assert.ok(src.includes('.slider-input'), 'Should have slider-input CSS');
  });

  it('has label with for attribute', () => {
    assert.ok(src.includes('<label'), 'Should have label element');
    assert.ok(src.includes('for={inputId}'), 'Should associate label with input');
  });

  it('parses input value as float', () => {
    assert.ok(src.includes('parseFloat'), 'Should parse as float');
  });
});

// ---- TitleBar.svelte ----

describe('TitleBar.svelte', () => {
  const src = readComponent('TitleBar.svelte');

  it('imports minimizeWindow from api', () => {
    assert.ok(src.includes('minimizeWindow'), 'Should import minimizeWindow');
  });

  it('imports maximizeWindow from api', () => {
    assert.ok(src.includes('maximizeWindow'), 'Should import maximizeWindow');
  });

  it('imports quitApp from api', () => {
    assert.ok(src.includes('quitApp'), 'Should import quitApp');
  });

  it('imports overlayStore for compact mode', () => {
    assert.ok(src.includes('overlayStore'), 'Should import overlayStore');
  });

  it('has minimize button with aria-label', () => {
    assert.ok(src.includes('aria-label="Minimize window"'), 'Should have minimize aria-label');
  });

  it('has maximize button with aria-label', () => {
    assert.ok(src.includes('Maximize window'), 'Should have maximize aria-label');
  });

  it('has close button with aria-label', () => {
    assert.ok(src.includes('aria-label="Close window"'), 'Should have close aria-label');
  });

  it('has compact/orb button with aria-label', () => {
    assert.ok(src.includes('Collapse to orb'), 'Should have compact button label');
  });

  it('has window-controls section', () => {
    assert.ok(src.includes('window-controls'), 'Should have window-controls section');
  });

  it('has titlebar CSS class', () => {
    assert.ok(src.includes('.titlebar'), 'Should have titlebar CSS');
  });

  it('shows Voice Mirror title', () => {
    assert.ok(src.includes('Voice Mirror'), 'Should show Voice Mirror title');
  });

  it('has data-tauri-drag-region for dragging', () => {
    assert.ok(src.includes('data-tauri-drag-region'), 'Should have drag region attribute');
  });

  it('has win-minimize CSS class', () => {
    assert.ok(src.includes('.win-minimize'), 'Should have minimize button CSS');
  });

  it('has win-maximize CSS class', () => {
    assert.ok(src.includes('.win-maximize'), 'Should have maximize button CSS');
  });

  it('has win-close CSS class', () => {
    assert.ok(src.includes('.win-close'), 'Should have close button CSS');
  });

  it('has win-compact CSS class', () => {
    assert.ok(src.includes('.win-compact'), 'Should have compact button CSS');
  });

  it('tracks maximized state', () => {
    assert.ok(src.includes('maximized'), 'Should track maximized state');
  });
});

// ---- Toast.svelte ----

describe('Toast.svelte', () => {
  const src = readComponent('Toast.svelte');

  it('uses $props for toast and onDismiss', () => {
    assert.ok(src.includes('$props()'), 'Should use $props');
    assert.ok(src.includes('toast'), 'Should accept toast prop');
    assert.ok(src.includes('onDismiss'), 'Should accept onDismiss prop');
  });

  it('has role="alert" for accessibility', () => {
    assert.ok(src.includes('role="alert"'), 'Should have alert role');
  });

  it('has aria-live="polite"', () => {
    assert.ok(src.includes('aria-live="polite"'), 'Should have polite aria-live');
  });

  it('has dismiss button with aria-label', () => {
    assert.ok(src.includes('aria-label="Dismiss notification"'), 'Should have dismiss aria-label');
  });

  it('supports severity: info, success, warning, error', () => {
    assert.ok(src.includes('.toast.info'), 'Should have info style');
    assert.ok(src.includes('.toast.success'), 'Should have success style');
    assert.ok(src.includes('.toast.warning'), 'Should have warning style');
    assert.ok(src.includes('.toast.error'), 'Should have error style');
  });

  it('has severity-based border colors', () => {
    assert.ok(src.includes('border-left:'), 'Should have severity border');
  });

  it('has severity-based SVG icons', () => {
    assert.ok(src.includes("<svg viewBox="), 'Should have SVG icons per severity');
  });

  it('shows toast.message text', () => {
    assert.ok(src.includes('{toast.message}'), 'Should display toast message');
  });

  it('supports optional action button', () => {
    assert.ok(src.includes('toast.action'), 'Should check for action');
    assert.ok(src.includes('toast-action'), 'Should have action button CSS');
  });

  it('uses fly transition', () => {
    assert.ok(src.includes("import { fly } from 'svelte/transition'"), 'Should import fly');
    assert.ok(src.includes('transition:fly'), 'Should use fly transition');
  });
});

// ---- ToastContainer.svelte ----

describe('ToastContainer.svelte', () => {
  const src = readComponent('ToastContainer.svelte');

  it('imports toastStore', () => {
    assert.ok(src.includes("import { toastStore }"), 'Should import toastStore');
  });

  it('imports Toast component', () => {
    assert.ok(src.includes("import Toast from './Toast.svelte'"), 'Should import Toast');
  });

  it('has toast-container CSS class', () => {
    assert.ok(src.includes('.toast-container'), 'Should have toast-container CSS');
  });

  it('is fixed positioned at bottom-right', () => {
    assert.ok(src.includes('position: fixed'), 'Should be fixed positioned');
    assert.ok(src.includes('bottom:'), 'Should be at bottom');
    assert.ok(src.includes('right:'), 'Should be at right');
  });

  it('has z-index: 10002 (above orb)', () => {
    assert.ok(src.includes('z-index: 10002'), 'Should have z-index above orb');
  });

  it('has aria-live="polite"', () => {
    assert.ok(src.includes('aria-live="polite"'), 'Should have aria-live');
  });

  it('has aria-label="Notifications"', () => {
    assert.ok(src.includes('aria-label="Notifications"'), 'Should have aria-label');
  });

  it('reverses toasts so newest appears on top', () => {
    assert.ok(src.includes('reversedToasts'), 'Should reverse toast order');
    assert.ok(src.includes('.reverse()'), 'Should call reverse');
  });

  it('renders Toast for each toast', () => {
    assert.ok(src.includes('<Toast'), 'Should render Toast component');
  });

  it('handles dismiss via toastStore.dismissToast', () => {
    assert.ok(src.includes('toastStore.dismissToast'), 'Should dismiss via store');
  });
});

// ---- Skeleton.svelte ----

describe('Skeleton.svelte', () => {
  const src = readComponent('Skeleton.svelte');

  it('uses $props', () => {
    assert.ok(src.includes('$props()'), 'Should use $props');
  });

  it('has width prop defaulting to 100%', () => {
    assert.ok(src.includes("width = '100%'"), 'Should default width to 100%');
  });

  it('has height prop defaulting to 16px', () => {
    assert.ok(src.includes("height = '16px'"), 'Should default height to 16px');
  });

  it('has rounded prop', () => {
    assert.ok(src.includes('rounded'), 'Should have rounded prop');
  });

  it('has circle prop', () => {
    assert.ok(src.includes('circle'), 'Should have circle prop');
  });

  it('has aria-hidden="true"', () => {
    assert.ok(src.includes('aria-hidden="true"'), 'Should be aria-hidden');
  });

  it('has shimmer animation', () => {
    assert.ok(src.includes('@keyframes skeleton-shimmer'), 'Should have shimmer animation');
  });

  it('has skeleton CSS class', () => {
    assert.ok(src.includes('.skeleton'), 'Should have skeleton CSS');
  });

  it('respects prefers-reduced-motion', () => {
    assert.ok(src.includes('prefers-reduced-motion'), 'Should respect reduced motion');
  });
});

// ---- ErrorState.svelte ----

describe('ErrorState.svelte', () => {
  const src = readComponent('ErrorState.svelte');

  it('uses $props', () => {
    assert.ok(src.includes('$props()'), 'Should use $props');
  });

  it('has message prop', () => {
    assert.ok(src.includes("message = 'Something went wrong.'"), 'Should have message prop');
  });

  it('has onRetry prop (optional)', () => {
    assert.ok(src.includes('onRetry = null'), 'Should have onRetry prop');
  });

  it('has compact prop', () => {
    assert.ok(src.includes('compact'), 'Should have compact prop');
  });

  it('has role="alert"', () => {
    assert.ok(src.includes('role="alert"'), 'Should have alert role');
  });

  it('has error-icon section', () => {
    assert.ok(src.includes('error-icon'), 'Should have error icon');
  });

  it('has error-message section', () => {
    assert.ok(src.includes('error-message'), 'Should have error message');
  });

  it('has retry button when onRetry is provided', () => {
    assert.ok(src.includes('retry-btn'), 'Should have retry button');
  });

  it('styles with danger color', () => {
    assert.ok(src.includes('--danger'), 'Should use danger color');
  });
});

// ---- WhatsNewModal.svelte ----

describe('WhatsNewModal.svelte', () => {
  const src = readComponent('WhatsNewModal.svelte');

  it('uses $props for version and onDismiss', () => {
    assert.ok(src.includes('$props()'), 'Should use $props');
    assert.ok(src.includes('version'), 'Should accept version prop');
    assert.ok(src.includes('onDismiss'), 'Should accept onDismiss prop');
  });

  it('imports renderMarkdown', () => {
    assert.ok(src.includes("import { renderMarkdown }"), 'Should import renderMarkdown');
  });

  it('has whats-new-overlay CSS class', () => {
    assert.ok(src.includes('.whats-new-overlay'), 'Should have overlay CSS');
  });

  it('has whats-new-modal CSS class', () => {
    assert.ok(src.includes('.whats-new-modal'), 'Should have modal CSS');
  });

  it('shows What\'s New heading', () => {
    assert.ok(src.includes("What's New"), 'Should show What\'s New heading');
  });

  it('has Got it dismiss button', () => {
    assert.ok(src.includes('Got it'), 'Should have Got it button');
  });

  it('handles Escape key to dismiss', () => {
    assert.ok(src.includes("e.key === 'Escape'"), 'Should handle Escape key');
  });

  it('has close button with aria-label', () => {
    assert.ok(src.includes("aria-label=\"Close what's new\""), 'Should have close aria-label');
  });

  it('renders markdown changelog content', () => {
    assert.ok(src.includes('{@html changelogContent}'), 'Should render HTML changelog');
  });
});

// ---- OnboardingModal.svelte ----

describe('OnboardingModal.svelte', () => {
  const src = readComponent('OnboardingModal.svelte');

  it('uses $props for onComplete', () => {
    assert.ok(src.includes('$props()'), 'Should use $props');
    assert.ok(src.includes('onComplete'), 'Should accept onComplete prop');
  });

  it('imports PRESETS and applyTheme from theme store', () => {
    assert.ok(src.includes("import { PRESETS, applyTheme"), 'Should import theme utilities');
  });

  it('defines STEPS array', () => {
    assert.ok(src.includes('const STEPS'), 'Should define STEPS');
  });

  it('has Welcome step', () => {
    assert.ok(src.includes("id: 'welcome'"), 'Should have welcome step');
  });

  it('has AI Provider step', () => {
    assert.ok(src.includes("id: 'provider'"), 'Should have provider step');
  });

  it('has Voice step', () => {
    assert.ok(src.includes("id: 'voice'"), 'Should have voice step');
  });

  it('has Theme step', () => {
    assert.ok(src.includes("id: 'theme'"), 'Should have theme step');
  });

  it('has progress bar', () => {
    assert.ok(src.includes('progress-bar'), 'Should have progress bar');
    assert.ok(src.includes('progress-fill'), 'Should have progress fill');
  });

  it('has step navigation (Back/Next)', () => {
    assert.ok(src.includes('handleBack'), 'Should have back handler');
    assert.ok(src.includes('handleNext'), 'Should have next handler');
  });

  it('has Skip Setup button', () => {
    assert.ok(src.includes('Skip Setup'), 'Should have skip option');
  });

  it('has Get Started as final step button text', () => {
    assert.ok(src.includes('Get Started'), 'Should show Get Started on last step');
  });

  it('has step indicators (dots)', () => {
    assert.ok(src.includes('step-dot'), 'Should have step dot indicators');
    assert.ok(src.includes('step-indicators'), 'Should have step indicators container');
  });

  it('shows Welcome to Voice Mirror heading', () => {
    assert.ok(src.includes('Welcome to Voice Mirror'), 'Should show welcome heading');
  });

  it('has provider selection options', () => {
    assert.ok(src.includes('providerOptions'), 'Should define provider options');
    assert.ok(src.includes('Claude Code'), 'Should include Claude Code');
    assert.ok(src.includes('Ollama'), 'Should include Ollama');
  });

  it('has theme preview grid', () => {
    assert.ok(src.includes('theme-grid'), 'Should have theme grid');
    assert.ok(src.includes('theme-card'), 'Should have theme cards');
  });

  it('calls finishOnboarding at the end', () => {
    assert.ok(src.includes('finishOnboarding'), 'Should have finishOnboarding function');
  });

  it('sets firstLaunchDone on completion', () => {
    assert.ok(src.includes('firstLaunchDone: true'), 'Should set firstLaunchDone flag');
  });

  it('has onboarding-overlay CSS class', () => {
    assert.ok(src.includes('.onboarding-overlay'), 'Should have overlay CSS');
  });

  it('has onboarding-modal CSS class', () => {
    assert.ok(src.includes('.onboarding-modal'), 'Should have modal CSS');
  });
});
