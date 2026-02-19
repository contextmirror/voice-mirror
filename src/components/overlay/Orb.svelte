<script>
  /**
   * Orb.svelte -- Canvas-based orb visualization component.
   *
   * Faithful port of electron/renderer/orb-canvas.js adapted for Svelte 5 runes.
   * Renders a glowing sphere with radial gradient, state-based color shifts,
   * state icons, and SDF-style anti-aliased edges using Canvas 2D API.
   *
   * Supports preset-driven rendering: colors, animation speed, glow, icons, etc.
   * are all controlled by the active preset from orb-presets.js.
   */

  import { resolveTheme, currentThemeName, hexToRgb } from '../../lib/stores/theme.svelte.js';
  import { configStore } from '../../lib/stores/config.svelte.js';
  import { resolveOrbPreset, ORB_PRESETS, DEFAULT_ORB_PRESET } from '../../lib/orb-presets.js';

  // ---- Props ----
  // preset: optional override (for settings preview). If null, reads from config.
  // isStatic: render a single frame with no animation (for mini previews)
  let { state: orbState = 'idle', size = 80, onclick = null, preset = null, isStatic = false } = $props();
  // Note: size default of 80 matches DEFAULT_CONFIG.appearance.orbSize

  // ---- Canvas ref ----
  let canvasEl = $state(null);

  // ---- Reduced motion ----
  let reducedMotion = $state(false);

  // ---- Animation state ----
  let animFrame = null;
  let phaseStart = performance.now();
  let prevState = $state('idle');

  const TAU = Math.PI * 2;

  // ---- Resolve active preset ----
  let activePreset = $derived.by(() => {
    // If an explicit preset object is passed (settings preview), use it directly
    if (preset && typeof preset === 'object' && preset.render) return preset;

    // Otherwise resolve from config store
    const orbCfg = configStore.value?.appearance?.orb;
    const customPresets = orbCfg?.customPresets || [];
    return resolveOrbPreset(orbCfg, customPresets);
  });

  // ---- Display size (accounts for glow padding, but not for static previews) ----
  let displaySize = $derived(size + (isStatic ? 0 : activePreset.render.glowRadius * 2));

  // ---- Helpers ----
  function lerp(a, b, t) {
    return Math.round(a * (1 - t) + b * t);
  }

  function clamp(v, min, max) {
    return v < min ? min : v > max ? max : v;
  }

  // ---- Derive orb colors from theme ----
  let orbColors = $derived.by(() => {
    const name = currentThemeName.value;
    const { colors } = resolveTheme(name);
    const accent = hexToRgb(colors.accent);
    const center = hexToRgb(colors.orbCore || '#1b2e4e');
    const edgeDarken = activePreset.render.edgeDarken;
    const edgeR = Math.max(0, Math.round(center.r * edgeDarken));
    const edgeG = Math.max(0, Math.round(center.g * edgeDarken));
    const edgeB = Math.max(0, Math.round(center.b * edgeDarken));
    const icon = hexToRgb(colors.text);
    const eyeR = Math.max(0, Math.round(center.r * 0.7));
    const eyeG = Math.max(0, Math.round(center.g * 0.7));
    const eyeB = Math.max(0, Math.round(center.b * 0.7));
    return {
      borderRgb: [accent.r, accent.g, accent.b],
      centerRgb: [center.r, center.g, center.b],
      edgeRgb: [edgeR, edgeG, edgeB],
      iconRgb: [icon.r, icon.g, icon.b],
      eyeRgb: [eyeR, eyeG, eyeB],
      accentHex: colors.accent,
    };
  });

  // Reset phase when state changes
  $effect(() => {
    if (orbState !== prevState) {
      phaseStart = performance.now();
      prevState = orbState;
    }
  });

  // Detect prefers-reduced-motion
  $effect(() => {
    if (typeof window === 'undefined') return;
    const mql = window.matchMedia('(prefers-reduced-motion: reduce)');
    reducedMotion = mql.matches;
    function handleChange(e) {
      reducedMotion = e.matches;
    }
    mql.addEventListener('change', handleChange);
    return () => mql.removeEventListener('change', handleChange);
  });

  // ---- State-based color shifting (preset-driven) ----
  function applyStateColor(r, g, b, state) {
    const shift = activePreset.stateColors[state];
    if (!shift) return { r, g, b }; // null = identity (idle default)

    let rf = r / 255;
    let gf = g / 255;
    let bf = b / 255;

    rf = Math.min(rf * shift.rf + (shift.rAdd || 0), 1);
    gf = Math.min(gf * shift.gf + (shift.gAdd || 0), 1);
    bf = Math.min(bf * shift.bf + (shift.bAdd || 0), 1);

    return { r: Math.round(rf * 255), g: Math.round(gf * 255), b: Math.round(bf * 255) };
  }

  // ---- Compute animation scale from preset ----
  function computeScale(currentState, phase, staticRender) {
    if (staticRender) return 1;

    const anim = activePreset.animation[currentState];
    if (!anim || anim.scaleAmt === 0 || anim.waveform === 'none') return 1;

    const amt = anim.scaleAmt;
    switch (anim.waveform) {
      case 'sine':
        return 1 + amt * Math.sin(phase * TAU);
      case 'compound':
        // Two-phase: expand then contract
        return phase < 0.5
          ? 1 + amt * Math.sin(phase * 2 * TAU)
          : 1 - (amt * 0.6) * Math.sin((phase - 0.5) * 2 * TAU);
      case 'tremor':
        // Fast vibration
        return 1 + amt * Math.sin(phase * TAU * 3);
      default:
        return 1 + amt * Math.sin(phase * TAU);
    }
  }

  // ---- Resolve glow color ----
  function resolveGlowColor(colors) {
    const glowColorCfg = activePreset.render.glowColor;
    if (glowColorCfg === 'accent') {
      return colors.borderRgb;
    } else if (glowColorCfg === 'center') {
      return colors.centerRgb;
    } else if (typeof glowColorCfg === 'string' && glowColorCfg.startsWith('#')) {
      const parsed = hexToRgb(glowColorCfg);
      return [parsed.r, parsed.g, parsed.b];
    }
    return colors.borderRgb;
  }

  // ---- Main rendering function ----
  function renderOrb(ctx, w, h, currentState, phase, staticRender, colors) {
    const cx = w / 2;
    const cy = h / 2;
    const rp = activePreset.render;
    // Orb body radius is based on the orb size, NOT the full canvas (which includes glow padding)
    const dpr = window.devicePixelRatio || 1;
    const glowPad = staticRender ? 0 : rp.glowRadius;
    const maxRadius = (Math.min(w, h) / 2) - (glowPad * dpr) - 1;

    // Animation scale
    const scale = computeScale(currentState, phase, staticRender);
    const radius = maxRadius * clamp(scale, 0.5, 1);
    const borderW = rp.borderWidth;
    const innerRadius = radius - borderW;

    // Resolve colors
    const cc = colors.centerRgb;
    const ec = colors.edgeRgb;
    const br = colors.borderRgb;

    const centerC = applyStateColor(cc[0], cc[1], cc[2], currentState);
    const edgeC = applyStateColor(ec[0], ec[1], ec[2], currentState);
    const borderC = applyStateColor(br[0], br[1], br[2], currentState);

    // ---- Outer glow (drawn behind everything, skip for static previews) ----
    if (!staticRender && rp.glowRadius > 0 && rp.glowAlpha > 0) {
      const glowRgb = resolveGlowColor(colors);
      const glowC = applyStateColor(glowRgb[0], glowRgb[1], glowRgb[2], currentState);
      const glowOuterR = radius + rp.glowRadius;
      const glowGrad = ctx.createRadialGradient(cx, cy, innerRadius * 0.8, cx, cy, glowOuterR);
      glowGrad.addColorStop(0, `rgba(${glowC.r}, ${glowC.g}, ${glowC.b}, ${rp.glowAlpha})`);
      glowGrad.addColorStop(1, `rgba(${glowC.r}, ${glowC.g}, ${glowC.b}, 0)`);
      ctx.beginPath();
      ctx.arc(cx, cy, glowOuterR, 0, TAU);
      ctx.fillStyle = glowGrad;
      ctx.fill();
    }

    // ---- Draw main orb body with radial gradient ----
    const orbGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, innerRadius);
    orbGrad.addColorStop(0, `rgba(${centerC.r}, ${centerC.g}, ${centerC.b}, ${rp.gradientCenterAlpha})`);
    orbGrad.addColorStop(1, `rgba(${edgeC.r}, ${edgeC.g}, ${edgeC.b}, ${rp.gradientEdgeAlpha})`);

    ctx.beginPath();
    ctx.arc(cx, cy, innerRadius, 0, TAU);
    ctx.fillStyle = orbGrad;
    ctx.fill();

    // ---- Inner shadow (subtle depth) ----
    if (rp.innerShadow) {
      const shadowGrad = ctx.createRadialGradient(cx, cy, innerRadius * 0.6, cx, cy, innerRadius);
      shadowGrad.addColorStop(0, 'rgba(0, 0, 0, 0)');
      shadowGrad.addColorStop(1, 'rgba(0, 0, 0, 0.15)');
      ctx.beginPath();
      ctx.arc(cx, cy, innerRadius, 0, TAU);
      ctx.fillStyle = shadowGrad;
      ctx.fill();
    }

    // ---- Draw border ring ----
    if (borderW > 0) {
      ctx.beginPath();
      ctx.arc(cx, cy, radius - borderW / 2, 0, TAU);
      ctx.strokeStyle = `rgba(${borderC.r}, ${borderC.g}, ${borderC.b}, ${rp.borderAlpha})`;
      ctx.lineWidth = borderW;
      ctx.stroke();
    }

    // ---- State icons ----
    if (!staticRender) {
      drawStateIcon(ctx, cx, cy, innerRadius, currentState, phase, colors);
    }
  }

  // ---- Icon router: dispatches to the right icon based on preset style ----
  function drawStateIcon(ctx, cx, cy, innerRadius, currentState, phase, colors) {
    const iconCfg = activePreset.icons;
    if (iconCfg.style === 'none') return;

    // Thinking dot and error X are universal (not style-dependent)
    if (currentState === 'thinking') {
      drawThinkingDot(ctx, cx, cy, innerRadius, phase, colors, currentState);
      return;
    }
    if (currentState === 'error') {
      drawErrorX(ctx, cx, cy, innerRadius);
      return;
    }

    // For listening, speaking, dictating — choose renderer based on icon style
    if (iconCfg.style === 'geometric') {
      drawGeometricIcon(ctx, cx, cy, innerRadius, currentState, phase, colors);
    } else if (iconCfg.style === 'minimal') {
      drawMinimalIcon(ctx, cx, cy, innerRadius, currentState, phase, colors);
    } else {
      // 'default' style
      if (currentState === 'listening') {
        drawHumanIcon(ctx, cx, cy, innerRadius, currentState, colors);
      } else if (currentState === 'speaking') {
        drawRobotIcon(ctx, cx, cy, innerRadius, currentState, colors);
      } else if (currentState === 'dictating') {
        drawWaveformBars(ctx, cx, cy, innerRadius, phase);
      }
    }
  }

  // ---- Geometric icon style (simple shapes: mic, speaker, bars) ----
  function drawGeometricIcon(ctx, cx, cy, innerRadius, currentState, phase, colors) {
    const ic = colors.iconRgb;
    const shifted = applyStateColor(ic[0], ic[1], ic[2], currentState);
    const alpha = activePreset.icons.alpha;
    const sc = activePreset.icons.scale;
    const fillColor = `rgba(${shifted.r}, ${shifted.g}, ${shifted.b}, ${alpha})`;

    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, innerRadius, 0, TAU);
    ctx.clip();
    ctx.fillStyle = fillColor;
    ctx.strokeStyle = fillColor;

    if (currentState === 'listening') {
      // Hexagon (mic shape)
      const r = innerRadius * sc * 0.5;
      ctx.beginPath();
      for (let i = 0; i < 6; i++) {
        const angle = (TAU / 6) * i - Math.PI / 2;
        const x = cx + Math.cos(angle) * r;
        const y = cy + Math.sin(angle) * r;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.fill();
    } else if (currentState === 'speaking') {
      // Concentric arcs (speaker)
      ctx.lineWidth = innerRadius * 0.04;
      const baseR = innerRadius * sc * 0.2;
      for (let i = 0; i < 3; i++) {
        const arcR = baseR + i * innerRadius * sc * 0.18;
        const arcAlpha = alpha * (1 - i * 0.25);
        ctx.strokeStyle = `rgba(${shifted.r}, ${shifted.g}, ${shifted.b}, ${arcAlpha})`;
        ctx.beginPath();
        ctx.arc(cx, cy, arcR, -Math.PI * 0.4, Math.PI * 0.4);
        ctx.stroke();
      }
      // Center dot
      ctx.beginPath();
      ctx.arc(cx, cy, innerRadius * sc * 0.08, 0, TAU);
      ctx.fill();
    } else if (currentState === 'dictating') {
      // Vertical bars (equalizer)
      const barCount = 5;
      const barWidth = innerRadius * sc * 0.12;
      const gap = innerRadius * sc * 0.08;
      const totalW = barCount * barWidth + (barCount - 1) * gap;
      const startX = cx - totalW / 2;
      const maxH = innerRadius * sc * 1.2;
      const minH = innerRadius * sc * 0.2;

      for (let i = 0; i < barCount; i++) {
        const amp = 0.3 + 0.7 * Math.abs(Math.sin(phase * TAU + i * 1.2));
        const h = minH + amp * (maxH - minH);
        const bx = startX + i * (barWidth + gap);
        ctx.fillRect(bx, cy - h / 2, barWidth, h);
      }
    }

    ctx.restore();
  }

  // ---- Minimal icon style (faint, simple indicators) ----
  function drawMinimalIcon(ctx, cx, cy, innerRadius, currentState, phase, colors) {
    const ic = colors.iconRgb;
    const shifted = applyStateColor(ic[0], ic[1], ic[2], currentState);
    const alpha = activePreset.icons.alpha;
    const sc = activePreset.icons.scale;

    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, innerRadius, 0, TAU);
    ctx.clip();

    if (currentState === 'listening') {
      // Small filled circle
      const dotR = innerRadius * sc * 0.3;
      ctx.beginPath();
      ctx.arc(cx, cy, dotR, 0, TAU);
      ctx.fillStyle = `rgba(${shifted.r}, ${shifted.g}, ${shifted.b}, ${alpha})`;
      ctx.fill();
    } else if (currentState === 'speaking') {
      // Ring
      const ringR = innerRadius * sc * 0.4;
      ctx.beginPath();
      ctx.arc(cx, cy, ringR, 0, TAU);
      ctx.strokeStyle = `rgba(${shifted.r}, ${shifted.g}, ${shifted.b}, ${alpha})`;
      ctx.lineWidth = innerRadius * 0.04;
      ctx.stroke();
    } else if (currentState === 'dictating') {
      // Three horizontal lines
      const lineW = innerRadius * sc * 0.6;
      const lineH = innerRadius * 0.03;
      const gap = innerRadius * sc * 0.2;
      ctx.fillStyle = `rgba(${shifted.r}, ${shifted.g}, ${shifted.b}, ${alpha})`;
      for (let i = -1; i <= 1; i++) {
        const amp = 0.5 + 0.5 * Math.abs(Math.sin(phase * TAU + i * 1.5));
        const w = lineW * amp;
        ctx.fillRect(cx - w / 2, cy + i * gap - lineH / 2, w, lineH);
      }
    }

    ctx.restore();
  }

  // ---- Human silhouette icon (for listening/recording) ----
  function drawHumanIcon(ctx, cx, cy, innerRadius, state, colors) {
    const sc = activePreset.icons.scale;
    const iconScale = innerRadius * sc;
    const headCy = cy - iconScale * 0.3;
    const headR = iconScale * 0.32;
    const bodyCy = cy + iconScale * 0.35;
    const bodyRx = iconScale * 0.55;
    const bodyRy = iconScale * 0.45;

    const ic = colors.iconRgb;
    const shifted = applyStateColor(ic[0], ic[1], ic[2], state);
    const fillColor = `rgba(${shifted.r}, ${shifted.g}, ${shifted.b}, ${activePreset.icons.alpha})`;

    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, innerRadius, 0, TAU);
    ctx.clip();

    ctx.fillStyle = fillColor;

    // Head (circle)
    ctx.beginPath();
    ctx.arc(cx, headCy, headR, 0, TAU);
    ctx.fill();

    // Shoulders (ellipse, clipped to just the top portion)
    ctx.beginPath();
    ctx.ellipse(cx, bodyCy, bodyRx, bodyRy, 0, -Math.PI, 0);
    ctx.fill();

    ctx.restore();
  }

  // ---- Robot icon (for speaking) ----
  function drawRobotIcon(ctx, cx, cy, innerRadius, state, colors) {
    const sc = activePreset.icons.scale;
    const iconScale = innerRadius * (sc * 0.91); // scale factor to match original 0.5 at sc=0.55
    const headW = iconScale * 0.7;
    const headH = iconScale * 0.55;
    const headCy = cy + iconScale * 0.05;
    const headCornerR = iconScale * 0.1;

    const antennaX = cx;
    const antennaTop = headCy - headH - iconScale * 0.25;
    const antennaBottom = headCy - headH;
    const antennaW = iconScale * 0.06;
    const antennaBallR = iconScale * 0.1;

    const eyeY = headCy - headH * 0.15;
    const eyeSpacing = headW * 0.4;
    const eyeR = iconScale * 0.12;

    const bodyTop = headCy + headH + iconScale * 0.05;
    const bodyW = headW * 0.85;
    const bodyH = iconScale * 0.35;
    const bodyCornerR = iconScale * 0.06;

    const ic = colors.iconRgb;
    const shifted = applyStateColor(ic[0], ic[1], ic[2], state);
    const fillColor = `rgba(${shifted.r}, ${shifted.g}, ${shifted.b}, ${activePreset.icons.alpha})`;

    const ec = colors.eyeRgb;
    const eyeShifted = applyStateColor(ec[0], ec[1], ec[2], state);
    const eyeColor = `rgba(${eyeShifted.r}, ${eyeShifted.g}, ${eyeShifted.b}, 0.9)`;

    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, innerRadius, 0, TAU);
    ctx.clip();

    ctx.fillStyle = fillColor;

    // Antenna stick
    ctx.fillRect(antennaX - antennaW, antennaTop, antennaW * 2, antennaBottom - antennaTop);

    // Antenna ball
    ctx.beginPath();
    ctx.arc(antennaX, antennaTop, antennaBallR, 0, TAU);
    ctx.fill();

    // Head (rounded rect)
    drawRoundedRect(ctx, cx - headW, headCy - headH, headW * 2, headH * 2, headCornerR);
    ctx.fill();

    // Body (rounded rect)
    drawRoundedRect(ctx, cx - bodyW, bodyTop, bodyW * 2, bodyH * 2, bodyCornerR);
    ctx.fill();

    // Eyes (dark cutouts)
    ctx.fillStyle = eyeColor;
    ctx.beginPath();
    ctx.arc(cx - eyeSpacing, eyeY, eyeR, 0, TAU);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(cx + eyeSpacing, eyeY, eyeR, 0, TAU);
    ctx.fill();

    ctx.restore();
  }

  // ---- Waveform bars (for dictating) ----
  function drawWaveformBars(ctx, cx, cy, innerRadius, phase) {
    const barCount = 7;
    const barWidth = innerRadius * 0.08;
    const barGap = innerRadius * 0.05;
    const totalWidth = barCount * barWidth + (barCount - 1) * barGap;
    const startX = cx - totalWidth / 2;
    const maxBarHeight = innerRadius * 1.4;
    const minBarHeight = innerRadius * 0.12;

    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, innerRadius, 0, TAU);
    ctx.clip();

    const alpha = activePreset.icons.alpha;
    for (let i = 0; i < barCount; i++) {
      const amplitude = 0.3 + 0.7 * Math.abs(Math.sin(phase * TAU + i * 0.9));
      const barHeight = minBarHeight + amplitude * (maxBarHeight - minBarHeight);
      const bx = startX + i * (barWidth + barGap);
      const byTop = cy - barHeight / 2;

      ctx.fillStyle = `rgba(180, 220, 255, ${alpha})`;
      ctx.fillRect(bx, byTop, barWidth, barHeight);
    }

    ctx.restore();
  }

  // ---- Thinking dot (orbiting) ----
  function drawThinkingDot(ctx, cx, cy, innerRadius, phase, colors, state) {
    const dotAngle = phase * TAU;
    const orbitR = innerRadius * 0.65;
    const dotX = cx + Math.cos(dotAngle) * orbitR;
    const dotY = cy + Math.sin(dotAngle) * orbitR;
    const dotR = innerRadius * 0.12;

    const ic = colors.iconRgb;
    const shifted = applyStateColor(ic[0], ic[1], ic[2], state);

    // Bright dot
    const dotGrad = ctx.createRadialGradient(dotX, dotY, 0, dotX, dotY, dotR);
    dotGrad.addColorStop(0, `rgba(${Math.min(255, shifted.r + 100)}, ${Math.min(255, shifted.g + 100)}, ${Math.min(255, shifted.b + 100)}, 0.8)`);
    dotGrad.addColorStop(1, `rgba(${shifted.r}, ${shifted.g}, ${shifted.b}, 0)`);
    ctx.beginPath();
    ctx.arc(dotX, dotY, dotR, 0, TAU);
    ctx.fillStyle = dotGrad;
    ctx.fill();

    // Trail dots
    for (let i = 1; i <= 3; i++) {
      const trailAngle = dotAngle - i * 0.3;
      const trailX = cx + Math.cos(trailAngle) * orbitR;
      const trailY = cy + Math.sin(trailAngle) * orbitR;
      const trailAlpha = 0.3 * (1 - i / 4);
      ctx.beginPath();
      ctx.arc(trailX, trailY, innerRadius * 0.06, 0, TAU);
      ctx.fillStyle = `rgba(${shifted.r}, ${shifted.g}, ${shifted.b}, ${trailAlpha})`;
      ctx.fill();
    }
  }

  // ---- Error X icon ----
  function drawErrorX(ctx, cx, cy, innerRadius) {
    const size = innerRadius * 0.35;
    ctx.save();
    ctx.strokeStyle = `rgba(255, 80, 80, ${activePreset.icons.alpha})`;
    ctx.lineWidth = innerRadius * 0.08;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(cx - size, cy - size);
    ctx.lineTo(cx + size, cy + size);
    ctx.moveTo(cx + size, cy - size);
    ctx.lineTo(cx - size, cy + size);
    ctx.stroke();
    ctx.restore();
  }

  // ---- Rounded rect helper ----
  function drawRoundedRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }

  // Main animation loop
  $effect(() => {
    const canvas = canvasEl;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Set canvas resolution (2x for crisp rendering on HiDPI)
    const dpr = window.devicePixelRatio || 1;
    // Static mini previews: no glow padding (keeps them at exact size)
    const glowPadding = isStatic ? 0 : activePreset.render.glowRadius;
    const canvasSize = size + glowPadding * 2;
    canvas.width = canvasSize * dpr;
    canvas.height = canvasSize * dpr;

    // If static, render one frame immediately (no glow, no animation)
    if (isStatic) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      renderOrb(ctx, canvas.width, canvas.height, orbState, 0, true, orbColors);
      return;
    }

    let running = true;

    function tick() {
      if (!running) return;

      const now = performance.now();
      const anim = activePreset.animation[orbState];
      const duration = anim?.duration || 1500;
      // Apply speed multiplier from overrides if present
      const speedMul = activePreset._animSpeedMultiplier || 1;
      const effectiveDuration = duration / speedMul;
      const phase = reducedMotion ? 0 : ((now - phaseStart) % effectiveDuration) / effectiveDuration;

      ctx.clearRect(0, 0, canvas.width, canvas.height);
      renderOrb(ctx, canvas.width, canvas.height, orbState, phase, reducedMotion, orbColors);

      animFrame = requestAnimationFrame(tick);
    }

    animFrame = requestAnimationFrame(tick);

    return () => {
      running = false;
      if (animFrame) {
        cancelAnimationFrame(animFrame);
        animFrame = null;
      }
    };
  });
</script>

<div
  class="orb-wrapper"
  style:width="{displaySize}px"
  style:height="{displaySize}px"
  role={isStatic ? undefined : 'button'}
  tabindex={isStatic ? -1 : 0}
  aria-label="AI status orb: {orbState}"
  onclick={onclick}
  onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') onclick?.(); }}
>
  <canvas
    bind:this={canvasEl}
    class="orb-canvas"
    style:width="{displaySize}px"
    style:height="{displaySize}px"
  ></canvas>
</div>

<style>
  .orb-wrapper {
    position: relative;
    border-radius: 50%;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    user-select: none;
    -webkit-app-region: no-drag;
    z-index: 10001;
    background: transparent;
  }

  .orb-wrapper:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 4px;
    border-radius: 50%;
  }

  .orb-canvas {
    display: block;
    background: transparent;
  }

  @media (prefers-reduced-motion: reduce) {
    .orb-wrapper {
      transition: none;
    }
  }
</style>
