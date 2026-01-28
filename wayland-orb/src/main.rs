//! Voice Mirror Wayland Overlay Orb
//!
//! A small native Wayland binary that renders a 64px overlay orb using
//! wlr-layer-shell. Communicates with Electron via JSON over stdin/stdout.

mod ipc;
mod renderer;

use std::io::{self, BufRead, Write};
use std::sync::mpsc;
use std::time::Instant;

use smithay_client_toolkit::{
    compositor::{CompositorHandler, CompositorState},
    delegate_compositor, delegate_layer, delegate_output, delegate_pointer,
    delegate_registry, delegate_seat, delegate_shm,
    output::{OutputHandler, OutputState},
    registry::{ProvidesRegistryState, RegistryState},
    registry_handlers,
    seat::{
        pointer::{PointerEvent, PointerEventKind, PointerHandler},
        Capability, SeatHandler, SeatState,
    },
    shell::{
        wlr_layer::{
            Anchor, KeyboardInteractivity, Layer, LayerShell, LayerShellHandler, LayerSurface,
            LayerSurfaceConfigure,
        },
        WaylandSurface,
    },
    shm::{slot::SlotPool, Shm, ShmHandler},
};
use wayland_client::{
    globals::registry_queue_init,
    protocol::{wl_output, wl_pointer, wl_seat, wl_shm, wl_surface},
    Connection, QueueHandle,
};

use ipc::{ElectronMessage, OrbState, OutputInfo, RustMessage};
use renderer::render_orb;

const DEFAULT_SIZE: u32 = 64;
const DEFAULT_MARGIN_RIGHT: i32 = 20;
const DEFAULT_MARGIN_BOTTOM: i32 = 100;
const DRAG_THRESHOLD: f64 = 5.0;

fn main() {
    // Parse --output <name> argument for target monitor
    let target_output_name: Option<String> = {
        let args: Vec<String> = std::env::args().collect();
        let mut output = None;
        let mut i = 1;
        while i < args.len() {
            if args[i] == "--output" && i + 1 < args.len() {
                output = Some(args[i + 1].clone());
                i += 2;
            } else {
                i += 1;
            }
        }
        output
    };

    let conn = Connection::connect_to_env().unwrap_or_else(|e| {
        send_message(&RustMessage::Error {
            message: format!("Failed to connect to Wayland: {}", e),
        });
        std::process::exit(1);
    });

    let (globals, mut event_queue) = registry_queue_init(&conn).unwrap();
    let qh = event_queue.handle();

    let compositor = CompositorState::bind(&globals, &qh).expect("wl_compositor not available");
    let layer_shell = LayerShell::bind(&globals, &qh).expect("layer shell not available");
    let shm = Shm::bind(&globals, &qh).expect("wl_shm not available");

    // Phase 1: Create OrbApp WITHOUT a layer surface to discover outputs
    let mut state = OrbApp {
        registry_state: RegistryState::new(&globals),
        seat_state: SeatState::new(&globals, &qh),
        output_state: OutputState::new(&globals, &qh),
        shm,
        pool: None,
        layer: None,
        pointer: None,
        exit: false,
        first_configure: true,
        width: DEFAULT_SIZE,
        height: DEFAULT_SIZE,
        visible: true,
        orb_state: OrbState::Idle,
        anim_phase: 0.0,
        last_frame: Instant::now(),
        pointer_pos: (0.0, 0.0),
        pointer_inside: false,
        dragging: false,
        drag_button_down: false,
        drag_start_pos: (0.0, 0.0),
        margin_right: DEFAULT_MARGIN_RIGHT,
        margin_bottom: DEFAULT_MARGIN_BOTTOM,
    };

    // Roundtrip to populate outputs (no surface exists yet, so no configure/draw)
    event_queue.roundtrip(&mut state).expect("Initial roundtrip failed");

    // Phase 2: Resolve target output and create layer surface on the right monitor
    let resolved_output: Option<wl_output::WlOutput> = target_output_name.as_ref().and_then(|name| {
        let found = state.output_state.outputs().find(|output| {
            state.output_state.info(output)
                .and_then(|info| info.name.as_deref().map(|n| n == name.as_str()))
                .unwrap_or(false)
        });
        if found.is_none() {
            eprintln!("Warning: output '{}' not found, using default", name);
        }
        found
    });

    let surface = compositor.create_surface(&qh);
    let layer = layer_shell.create_layer_surface(
        &qh,
        surface,
        Layer::Overlay,
        Some("voice-mirror-orb"),
        resolved_output.as_ref(),
    );
    layer.set_anchor(Anchor::BOTTOM | Anchor::RIGHT);
    layer.set_margin(0, DEFAULT_MARGIN_RIGHT, DEFAULT_MARGIN_BOTTOM, 0);
    layer.set_keyboard_interactivity(KeyboardInteractivity::None);
    layer.set_size(DEFAULT_SIZE, DEFAULT_SIZE);
    layer.set_exclusive_zone(-1);
    layer.commit();

    let pool = SlotPool::new(
        (DEFAULT_SIZE * DEFAULT_SIZE * 4) as usize,
        &state.shm,
    )
    .expect("Failed to create SHM pool");

    state.layer = Some(layer);
    state.pool = Some(pool);

    // Send ready message after Wayland is connected
    send_message(&RustMessage::Ready);

    // Spawn a thread to read stdin (blocking reads) and send messages via channel
    let (ipc_tx, ipc_rx) = mpsc::channel::<ElectronMessage>();
    std::thread::spawn(move || {
        let stdin = io::stdin();
        let reader = stdin.lock();
        for line in reader.lines() {
            match line {
                Ok(text) => {
                    let trimmed = text.trim().to_string();
                    if trimmed.is_empty() {
                        continue;
                    }
                    if let Ok(msg) = serde_json::from_str::<ElectronMessage>(&trimmed) {
                        if ipc_tx.send(msg).is_err() {
                            break; // Main thread gone
                        }
                    }
                }
                Err(_) => break, // stdin closed
            }
        }
    });

    // Main event loop
    loop {
        // Check for IPC messages (non-blocking via channel)
        while let Ok(msg) = ipc_rx.try_recv() {
            handle_ipc_message(&mut state, msg);
        }

        // Read and dispatch Wayland events
        event_queue
            .flush()
            .expect("Wayland flush failed");

        event_queue
            .dispatch_pending(&mut state)
            .expect("Wayland dispatch failed");

        // Read any pending data from the Wayland socket
        if let Some(guard) = event_queue.prepare_read() {
            let _ = guard.read();
            event_queue
                .dispatch_pending(&mut state)
                .expect("Wayland dispatch failed");
        }

        if state.exit {
            break;
        }

        // Redraw if visible and configured
        if !state.first_configure {
            state.draw(&event_queue.handle());
        }

        // Brief sleep to avoid busy-waiting (targeting ~60fps when animating)
        std::thread::sleep(std::time::Duration::from_millis(16));
    }
}


fn handle_ipc_message(state: &mut OrbApp, msg: ElectronMessage) {
    match msg {
        ElectronMessage::SetState { state: new_state } => {
            state.orb_state = new_state;
            state.anim_phase = 0.0;
            state.last_frame = Instant::now();
        }
        ElectronMessage::Show => {
            state.visible = true;
        }
        ElectronMessage::Hide => {
            state.visible = false;
        }
        ElectronMessage::SetSize { size } => {
            state.width = size;
            state.height = size;
            if let Some(ref layer) = state.layer {
                layer.set_size(size, size);
                layer.commit();
            }
        }
        ElectronMessage::SetPosition { x: _, y: _ } => {
            // Layer-shell uses anchor+margins, not absolute position
        }
        ElectronMessage::SetOutput { name: _ } => {
            // Output switching is handled by Electron restarting the binary
            // with --output <name>. Send exit so Electron can restart us.
            state.exit = true;
        }
        ElectronMessage::ListOutputs => {
            state.send_output_list();
        }
        ElectronMessage::Quit => {
            state.exit = true;
        }
    }
}

fn send_message(msg: &RustMessage) {
    let json = serde_json::to_string(msg).unwrap();
    let stdout = io::stdout();
    let mut handle = stdout.lock();
    let _ = writeln!(handle, "{}", json);
    let _ = handle.flush();
}

struct OrbApp {
    registry_state: RegistryState,
    seat_state: SeatState,
    output_state: OutputState,
    shm: Shm,
    pool: Option<SlotPool>,
    layer: Option<LayerSurface>,
    pointer: Option<wl_pointer::WlPointer>,

    exit: bool,
    first_configure: bool,
    width: u32,
    height: u32,
    visible: bool,

    orb_state: OrbState,
    anim_phase: f32,
    last_frame: Instant,

    pointer_pos: (f64, f64),
    pointer_inside: bool,

    // Drag state
    dragging: bool,
    drag_button_down: bool,
    drag_start_pos: (f64, f64),
    margin_right: i32,
    margin_bottom: i32,
}

impl OrbApp {
    fn send_output_list(&self) {
        let outputs: Vec<OutputInfo> = self.output_state.outputs().filter_map(|output| {
            let info = self.output_state.info(&output)?;
            let name = info.name.clone().unwrap_or_default();
            let description = info.description.clone().unwrap_or_else(|| {
                format!("{} {}", info.make, info.model)
            });
            Some(OutputInfo { name, description, active: false })
        }).collect();

        send_message(&RustMessage::OutputList { outputs });
    }

    fn draw(&mut self, qh: &QueueHandle<Self>) {
        let (pool, layer) = match (self.pool.as_mut(), self.layer.as_ref()) {
            (Some(p), Some(l)) => (p, l),
            _ => return, // Not yet initialized
        };

        let width = self.width;
        let height = self.height;
        let stride = width as i32 * 4;

        let (buffer, canvas) = pool
            .create_buffer(
                width as i32,
                height as i32,
                stride,
                wl_shm::Format::Argb8888,
            )
            .expect("create buffer");

        // Update animation
        let now = Instant::now();
        let delta_ms = now.duration_since(self.last_frame).as_millis() as f32;
        self.last_frame = now;

        let period = match self.orb_state {
            OrbState::Idle => 1500.0,
            OrbState::Recording => 500.0,
            OrbState::Speaking => 1000.0,
            OrbState::Thinking => 2000.0,
        };
        self.anim_phase += delta_ms / period;
        if self.anim_phase >= 1.0 {
            self.anim_phase -= 1.0;
        }

        // Render the orb
        if self.visible {
            render_orb(canvas, width, height, self.orb_state, self.anim_phase);
        } else {
            canvas.fill(0);
        }

        // Submit frame
        layer.wl_surface().damage_buffer(0, 0, width as i32, height as i32);
        layer.wl_surface().frame(qh, layer.wl_surface().clone());
        buffer.attach_to(layer.wl_surface()).expect("buffer attach");
        layer.commit();
    }
}

// --- Wayland trait implementations ---

impl CompositorHandler for OrbApp {
    fn scale_factor_changed(
        &mut self,
        _conn: &Connection,
        _qh: &QueueHandle<Self>,
        _surface: &wl_surface::WlSurface,
        _new_factor: i32,
    ) {
    }

    fn transform_changed(
        &mut self,
        _conn: &Connection,
        _qh: &QueueHandle<Self>,
        _surface: &wl_surface::WlSurface,
        _new_transform: wl_output::Transform,
    ) {
    }

    fn frame(
        &mut self,
        _conn: &Connection,
        qh: &QueueHandle<Self>,
        _surface: &wl_surface::WlSurface,
        _time: u32,
    ) {
        self.draw(qh);
    }

    fn surface_enter(
        &mut self,
        _conn: &Connection,
        _qh: &QueueHandle<Self>,
        _surface: &wl_surface::WlSurface,
        _output: &wl_output::WlOutput,
    ) {
    }

    fn surface_leave(
        &mut self,
        _conn: &Connection,
        _qh: &QueueHandle<Self>,
        _surface: &wl_surface::WlSurface,
        _output: &wl_output::WlOutput,
    ) {
    }
}

impl OutputHandler for OrbApp {
    fn output_state(&mut self) -> &mut OutputState {
        &mut self.output_state
    }

    fn new_output(
        &mut self,
        _conn: &Connection,
        _qh: &QueueHandle<Self>,
        _output: wl_output::WlOutput,
    ) {
    }

    fn update_output(
        &mut self,
        _conn: &Connection,
        _qh: &QueueHandle<Self>,
        _output: wl_output::WlOutput,
    ) {
    }

    fn output_destroyed(
        &mut self,
        _conn: &Connection,
        _qh: &QueueHandle<Self>,
        _output: wl_output::WlOutput,
    ) {
    }
}

impl LayerShellHandler for OrbApp {
    fn closed(&mut self, _conn: &Connection, _qh: &QueueHandle<Self>, _layer: &LayerSurface) {
        self.exit = true;
    }

    fn configure(
        &mut self,
        _conn: &Connection,
        qh: &QueueHandle<Self>,
        _layer: &LayerSurface,
        configure: LayerSurfaceConfigure,
        _serial: u32,
    ) {
        if configure.new_size.0 > 0 {
            self.width = configure.new_size.0;
        }
        if configure.new_size.1 > 0 {
            self.height = configure.new_size.1;
        }

        if self.first_configure {
            self.first_configure = false;
            self.draw(qh);
        }
    }
}

impl SeatHandler for OrbApp {
    fn seat_state(&mut self) -> &mut SeatState {
        &mut self.seat_state
    }

    fn new_seat(&mut self, _: &Connection, _: &QueueHandle<Self>, _: wl_seat::WlSeat) {}

    fn new_capability(
        &mut self,
        _conn: &Connection,
        qh: &QueueHandle<Self>,
        seat: wl_seat::WlSeat,
        capability: Capability,
    ) {
        if capability == Capability::Pointer && self.pointer.is_none() {
            let pointer = self
                .seat_state
                .get_pointer(qh, &seat)
                .expect("Failed to create pointer");
            self.pointer = Some(pointer);
        }
    }

    fn remove_capability(
        &mut self,
        _conn: &Connection,
        _: &QueueHandle<Self>,
        _: wl_seat::WlSeat,
        capability: Capability,
    ) {
        if capability == Capability::Pointer && self.pointer.is_some() {
            self.pointer.take().unwrap().release();
        }
    }

    fn remove_seat(&mut self, _: &Connection, _: &QueueHandle<Self>, _: wl_seat::WlSeat) {}
}

impl PointerHandler for OrbApp {
    fn pointer_frame(
        &mut self,
        _conn: &Connection,
        _qh: &QueueHandle<Self>,
        _pointer: &wl_pointer::WlPointer,
        events: &[PointerEvent],
    ) {
        let layer_surface = match self.layer.as_ref() {
            Some(l) => l.wl_surface().clone(),
            None => return,
        };
        for event in events {
            if event.surface != layer_surface {
                continue;
            }
            match event.kind {
                PointerEventKind::Enter { .. } => {
                    self.pointer_inside = true;
                    self.pointer_pos = event.position;
                }
                PointerEventKind::Leave { .. } => {
                    self.pointer_inside = false;
                    self.drag_button_down = false;
                    self.dragging = false;
                }
                PointerEventKind::Motion { .. } => {
                    let old_pos = self.pointer_pos;
                    self.pointer_pos = event.position;

                    if self.drag_button_down {
                        let dx = self.pointer_pos.0 - self.drag_start_pos.0;
                        let dy = self.pointer_pos.1 - self.drag_start_pos.1;
                        let dist = (dx * dx + dy * dy).sqrt();

                        if !self.dragging && dist > DRAG_THRESHOLD {
                            self.dragging = true;
                        }

                        if self.dragging {
                            let motion_dx = self.pointer_pos.0 - old_pos.0;
                            let motion_dy = self.pointer_pos.1 - old_pos.1;
                            self.margin_right = (self.margin_right - motion_dx as i32).max(0);
                            self.margin_bottom = (self.margin_bottom - motion_dy as i32).max(0);
                            if let Some(ref layer) = self.layer {
                                layer.set_margin(0, self.margin_right, self.margin_bottom, 0);
                                layer.commit();
                            }
                        }
                    }
                }
                PointerEventKind::Press { button, .. } => {
                    if button == 0x110 {
                        // Left click: start potential drag
                        self.drag_button_down = true;
                        self.dragging = false;
                        self.drag_start_pos = self.pointer_pos;
                    } else if button == 0x111 {
                        // Right click: always expand
                        send_message(&RustMessage::ExpandRequested);
                    }
                }
                PointerEventKind::Release { button, .. } => {
                    if button == 0x110 {
                        if self.dragging {
                            send_message(&RustMessage::PositionChanged {
                                x: self.margin_right,
                                y: self.margin_bottom,
                            });
                        } else {
                            send_message(&RustMessage::ExpandRequested);
                        }
                        self.drag_button_down = false;
                        self.dragging = false;
                    }
                }
                _ => {}
            }
        }
    }
}

impl ShmHandler for OrbApp {
    fn shm_state(&mut self) -> &mut Shm {
        &mut self.shm
    }
}

delegate_compositor!(OrbApp);
delegate_output!(OrbApp);
delegate_shm!(OrbApp);
delegate_seat!(OrbApp);
delegate_pointer!(OrbApp);
delegate_layer!(OrbApp);
delegate_registry!(OrbApp);

impl ProvidesRegistryState for OrbApp {
    fn registry(&mut self) -> &mut RegistryState {
        &mut self.registry_state
    }
    registry_handlers![OutputState, SeatState];
}

