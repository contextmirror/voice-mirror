<script>
  /**
   * AppearanceSettings.svelte -- Orchestrator for appearance settings.
   *
   * Holds all state, handles config init/save/reset,
   * delegates UI to focused sub-components via $bindable props.
   */
  import { configStore, updateConfig } from '../../lib/stores/config.svelte.js';
  import { toastStore } from '../../lib/stores/toast.svelte.js';
  import { PRESETS, applyTheme } from '../../lib/stores/theme.svelte.js';
  import { ORB_PRESETS, DEFAULT_ORB_PRESET, overridesToSliders } from '../../lib/orb-presets.js';

  import ThemeSection from './appearance/ThemeSection.svelte';
  import OrbSection from './appearance/OrbSection.svelte';
  import MessageCardSection from './appearance/MessageCardSection.svelte';
  import TypographySection from './appearance/TypographySection.svelte';
  import Button from '../shared/Button.svelte';

  // ---- State: Theme ----
  let selectedTheme = $state('colorblind');
  let customizeColors = $state(false);
  let customColors = $state({ ...PRESETS.colorblind.colors });

  // ---- State: Fonts ----
  let fontFamily = $state("'Segoe UI', system-ui, -apple-system, sans-serif");
  let fontMono = $state("'Cascadia Code', 'Fira Code', monospace");
  let fontSize = $state(14);
  let customFonts = $state([]);

  // ---- State: Orb ----
  let orbSize = $state(80);
  let selectedOrbPreset = $state(DEFAULT_ORB_PRESET);
  let orbCustomize = $state(false);
  let orbGlow = $state(0);
  let orbBorder = $state(2);
  let orbOpacity = $state(95);
  let orbAnimSpeed = $state(1.0);
  let orbIconStyle = $state('default');
  let orbOverrides = $state(null);
  let orbCustomPresets = $state([]);

  // ---- State: Message Cards ----
  let bubbleStyle = $state('rounded');
  let padding = $state(12);
  let avatarSize = $state(36);
  let showAvatars = $state(true);
  let selectedAiAvatar = $state('cube');
  let selectedUserAvatar = $state('person');
  let customAvatars = $state([]);

  // ---- State: UI ----
  let saving = $state(false);

  // ---- Ref to TypographySection for cleanup ----
  let typographyRef;

  // ---- One-shot config sync on mount ----
  let needsInit = true;

  $effect(() => {
    if (!needsInit) return;
    if (!configStore.loaded) return;
    needsInit = false;

    const cfg = configStore.value;
    const themeName = cfg?.appearance?.theme || 'colorblind';
    const preset = PRESETS[themeName] || PRESETS.colorblind;

    selectedTheme = themeName;
    fontFamily = cfg.appearance?.fonts?.fontFamily || preset.fonts.fontFamily;
    fontMono = cfg.appearance?.fonts?.fontMono || preset.fonts.fontMono;

    const mc = cfg.appearance?.messageCard || {};
    fontSize = parseInt(mc.fontSize) || 14;
    bubbleStyle = mc.bubbleStyle || 'rounded';
    padding = parseInt(mc.padding) || 12;
    avatarSize = parseInt(mc.avatarSize) || 36;
    showAvatars = mc.showAvatars !== false;
    selectedAiAvatar = mc.aiAvatar || 'cube';
    selectedUserAvatar = mc.userAvatar || 'person';
    if (Array.isArray(mc.customAvatars)) customAvatars = mc.customAvatars;

    orbSize = cfg.appearance?.orbSize ?? 80;

    const orbCfg = cfg.appearance?.orb;
    if (orbCfg) {
      selectedOrbPreset = orbCfg.preset || DEFAULT_ORB_PRESET;
      if (orbCfg.customPresets) orbCustomPresets = orbCfg.customPresets;
      if (orbCfg.overrides) {
        orbOverrides = orbCfg.overrides;
        orbCustomize = true;
        const base = ORB_PRESETS[selectedOrbPreset]
          || orbCustomPresets.find(p => p.id === selectedOrbPreset)
          || ORB_PRESETS[DEFAULT_ORB_PRESET];
        const sliders = overridesToSliders(base, orbCfg.overrides);
        orbGlow = sliders.glowIntensity;
        orbBorder = sliders.borderWidth;
        orbOpacity = sliders.opacity;
        orbAnimSpeed = sliders.animSpeed;
        orbIconStyle = sliders.iconStyle;
      } else {
        const base = ORB_PRESETS[selectedOrbPreset] || ORB_PRESETS[DEFAULT_ORB_PRESET];
        orbGlow = Math.round((base.render.glowRadius / 30) * 100);
        orbBorder = base.render.borderWidth;
        orbOpacity = Math.round(base.render.gradientCenterAlpha * 100);
        orbAnimSpeed = 1.0;
        orbIconStyle = base.icons.style;
      }
    }

    const cfgColors = cfg.appearance?.colors;
    if (cfgColors && typeof cfgColors === 'object') {
      customizeColors = true;
      customColors = { ...preset.colors, ...cfgColors };
    } else {
      customizeColors = false;
      customColors = { ...preset.colors };
    }

    const cfgFonts = cfg.appearance?.customFonts;
    if (Array.isArray(cfgFonts) && cfgFonts.length > 0) {
      customFonts = cfgFonts;
    }

    applyTheme(
      cfgColors && typeof cfgColors === 'object' ? { ...preset.colors, ...cfgColors } : preset.colors,
      { fontFamily: cfg.appearance?.fonts?.fontFamily || preset.fonts.fontFamily,
        fontMono: cfg.appearance?.fonts?.fontMono || preset.fonts.fontMono }
    );
  });

  // ---- Orb core color bridge ----
  function handleOrbCoreColorChange(value) {
    customColors = { ...customColors, orbCore: value };
    applyTheme(customColors, { fontFamily, fontMono });
  }

  // ---- Reset ----
  async function resetAppearance() {
    selectedTheme = 'colorblind';
    customizeColors = false;
    const preset = PRESETS.colorblind;
    customColors = { ...preset.colors };
    fontFamily = preset.fonts.fontFamily;
    fontMono = preset.fonts.fontMono;
    fontSize = 14;
    orbSize = 80;
    bubbleStyle = 'rounded';
    padding = 12;
    avatarSize = 36;
    showAvatars = true;
    selectedAiAvatar = 'cube';
    selectedUserAvatar = 'person';
    customAvatars = [];

    selectedOrbPreset = DEFAULT_ORB_PRESET;
    orbCustomize = false;
    orbOverrides = null;
    orbCustomPresets = [];
    const classicPreset = ORB_PRESETS[DEFAULT_ORB_PRESET];
    orbGlow = Math.round((classicPreset.render.glowRadius / 30) * 100);
    orbBorder = classicPreset.render.borderWidth;
    orbOpacity = Math.round(classicPreset.render.gradientCenterAlpha * 100);
    orbAnimSpeed = 1.0;
    orbIconStyle = classicPreset.icons.style;

    typographyRef?.removeAllInjectedFonts();
    customFonts = [];

    applyTheme(preset.colors, preset.fonts);

    try {
      await updateConfig({
        appearance: {
          theme: 'colorblind',
          fonts: { ...preset.fonts },
          colors: null,
          orbSize: 80,
          orb: null,
          customFonts: null,
          messageCard: null,
        },
      });
      toastStore.addToast({ message: 'Appearance reset to defaults', severity: 'success' });
    } catch (err) {
      console.error('[AppearanceSettings] Reset failed:', err);
      toastStore.addToast({ message: 'Failed to reset appearance', severity: 'error' });
    }
  }

  // ---- Save ----
  async function saveAppearanceSettings() {
    saving = true;
    try {
      const preset = PRESETS[selectedTheme] || PRESETS.colorblind;
      const colors = customizeColors ? { ...customColors } : preset.colors;
      const fonts = { fontFamily, fontMono };

      const orbConfig = {
        preset: selectedOrbPreset,
        overrides: orbCustomize ? orbOverrides : null,
        customPresets: orbCustomPresets.length > 0 ? orbCustomPresets : null,
      };

      const patch = {
        appearance: {
          theme: selectedTheme,
          fonts,
          colors: customizeColors ? { ...customColors } : null,
          orbSize,
          orb: orbConfig,
          customFonts: customFonts.length > 0 ? customFonts : null,
          messageCard: {
            fontSize: fontSize + 'px',
            bubbleStyle,
            padding,
            avatarSize,
            showAvatars,
            aiAvatar: selectedAiAvatar,
            userAvatar: selectedUserAvatar,
            customAvatars: customAvatars.length > 0 ? customAvatars : null,
          },
        },
      };
      await updateConfig(patch);
      applyTheme(colors, fonts);
      toastStore.addToast({ message: 'Appearance settings saved', severity: 'success' });
    } catch (err) {
      console.error('[AppearanceSettings] Save failed:', err);
      toastStore.addToast({ message: 'Failed to save appearance settings', severity: 'error' });
    } finally {
      saving = false;
    }
  }
</script>

<div class="appearance-settings">
  <ThemeSection
    bind:selectedTheme
    bind:customizeColors
    bind:customColors
    {fontFamily}
    {fontMono}
  />

  <OrbSection
    bind:orbSize
    bind:selectedOrbPreset
    bind:orbCustomize
    bind:orbGlow
    bind:orbBorder
    bind:orbOpacity
    bind:orbAnimSpeed
    bind:orbIconStyle
    bind:orbOverrides
    bind:orbCustomPresets
    orbCoreColor={customColors.orbCore}
    onOrbCoreColorChange={handleOrbCoreColorChange}
  />

  <MessageCardSection
    bind:bubbleStyle
    bind:padding
    bind:avatarSize
    bind:showAvatars
    bind:selectedAiAvatar
    bind:selectedUserAvatar
    bind:customAvatars
    {fontFamily}
    {fontSize}
  />

  <TypographySection
    bind:this={typographyRef}
    bind:fontFamily
    bind:fontMono
    bind:fontSize
    bind:customFonts
  />

  <div class="settings-actions">
    <Button variant="secondary" onClick={resetAppearance}>Reset to Defaults</Button>
    <Button variant="primary" onClick={saveAppearanceSettings} disabled={saving}>
      {saving ? 'Saving...' : 'Save Appearance'}
    </Button>
  </div>
</div>

<style>
  .appearance-settings {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .settings-actions {
    display: flex;
    gap: 12px;
    padding: 16px 0;
    border-top: 1px solid var(--border);
    margin-top: 8px;
  }
</style>
