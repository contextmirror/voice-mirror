//! Orb rendering using raw pixel manipulation.
//!
//! Draws a circular orb with gradient and animation effects directly
//! into a Wayland SHM buffer (ARGB8888, premultiplied alpha).

use crate::ipc::OrbState;

/// Render the orb into a raw ARGB8888 buffer.
pub fn render_orb(canvas: &mut [u8], width: u32, height: u32, state: OrbState, phase: f32) {
    let cx = width as f32 / 2.0;
    let cy = height as f32 / 2.0;
    let max_radius = (width.min(height) as f32 / 2.0) - 1.0;

    // Animation scale
    let scale = match state {
        OrbState::Idle => 1.0 + 0.05 * (phase * std::f32::consts::TAU).sin(),
        OrbState::Recording => 1.0 + 0.12 * (phase * std::f32::consts::TAU).sin(),
        OrbState::Speaking => {
            if phase < 0.5 {
                1.0 + 0.08 * (phase * 2.0 * std::f32::consts::TAU).sin()
            } else {
                1.0 - 0.05 * ((phase - 0.5) * 2.0 * std::f32::consts::TAU).sin()
            }
        }
        OrbState::Thinking => 1.0,
    };

    let radius = max_radius * scale.clamp(0.5, 1.0);
    let border_radius = radius;
    let inner_radius = radius - 2.0;

    // Rotation for thinking state (rotates the gradient)
    let rotation = match state {
        OrbState::Thinking => phase * std::f32::consts::TAU,
        _ => 0.0,
    };

    for y in 0..height {
        for x in 0..width {
            let px = x as f32 + 0.5;
            let py = y as f32 + 0.5;
            let dx = px - cx;
            let dy = py - cy;
            let dist = (dx * dx + dy * dy).sqrt();

            let pixel_offset = ((y * width + x) * 4) as usize;
            if pixel_offset + 3 >= canvas.len() {
                continue;
            }

            if dist > border_radius + 0.5 {
                // Outside the orb - fully transparent
                canvas[pixel_offset] = 0;     // B
                canvas[pixel_offset + 1] = 0; // G
                canvas[pixel_offset + 2] = 0; // R
                canvas[pixel_offset + 3] = 0; // A
                continue;
            }

            // Anti-aliased edge
            let edge_alpha = if dist > border_radius - 0.5 {
                1.0 - (dist - (border_radius - 0.5))
            } else {
                1.0
            };

            let (r, g, b, a) = if dist > inner_radius {
                // Border ring: purple-blue glow
                let border_alpha = edge_alpha * 0.5;
                apply_state_color(102, 126, 234, border_alpha, state, phase)
            } else {
                // Inner gradient: dark purple
                let t = dist / inner_radius; // 0=center, 1=edge

                // Apply rotation for thinking state
                let (_rdx, _rdy) = if rotation != 0.0 {
                    let cos_r = rotation.cos();
                    let sin_r = rotation.sin();
                    (dx * cos_r - dy * sin_r, dx * sin_r + dy * cos_r)
                } else {
                    (dx, dy)
                };

                // Radial gradient: center bright, edge dark
                let r_val = lerp(0x2d, 0x0d, t);
                let g_val = lerp(0x1b, 0x0d, t);
                let b_val = lerp(0x4e, 0x1a, t);

                apply_state_color(r_val, g_val, b_val, edge_alpha * 0.95, state, phase)
            };

            // ARGB8888 premultiplied alpha (little-endian: B, G, R, A)
            let pa = (a * 255.0) as u8;
            let pr = (r * a * 255.0) as u8;
            let pg = (g * a * 255.0) as u8;
            let pb = (b * a * 255.0) as u8;

            canvas[pixel_offset] = pb;
            canvas[pixel_offset + 1] = pg;
            canvas[pixel_offset + 2] = pr;
            canvas[pixel_offset + 3] = pa;
        }
    }
}

/// Apply state-dependent color modifications (hue shift, brightness).
fn apply_state_color(
    r: u8,
    g: u8,
    b: u8,
    alpha: f32,
    state: OrbState,
    _phase: f32,
) -> (f32, f32, f32, f32) {
    let mut rf = r as f32 / 255.0;
    let mut gf = g as f32 / 255.0;
    let mut bf = b as f32 / 255.0;

    match state {
        OrbState::Idle => {
            // No color shift
        }
        OrbState::Recording => {
            // Shift toward pink/red: increase red, decrease blue
            rf = (rf * 1.3 + 0.1).min(1.0);
            gf *= 0.7;
        }
        OrbState::Speaking => {
            // Shift toward blue/cyan: increase blue, decrease red
            bf = (bf * 1.2 + 0.1).min(1.0);
            gf = (gf * 1.1 + 0.05).min(1.0);
            rf *= 0.8;
        }
        OrbState::Thinking => {
            // Shift toward teal/green
            gf = (gf * 1.2 + 0.1).min(1.0);
            bf = (bf * 1.1).min(1.0);
            rf *= 0.6;
        }
    }

    (rf, gf, bf, alpha)
}

/// Linear interpolation between two u8 values.
fn lerp(a: u8, b: u8, t: f32) -> u8 {
    let result = a as f32 * (1.0 - t) + b as f32 * t;
    result.clamp(0.0, 255.0) as u8
}
