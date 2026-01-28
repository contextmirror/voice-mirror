//! IPC protocol types for communication with Electron.

use serde::{Deserialize, Serialize};

/// Voice state of the orb.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
pub enum OrbState {
    Idle,
    Recording,
    Speaking,
    Thinking,
}

/// Messages from Electron to Rust.
#[derive(Debug, Deserialize)]
#[serde(tag = "type")]
pub enum ElectronMessage {
    SetState { state: OrbState },
    Show,
    Hide,
    SetSize { size: u32 },
    SetPosition { x: i32, y: i32 },
    SetOutput { name: String },
    ListOutputs,
    Quit,
}

/// Messages from Rust to Electron.
#[derive(Debug, Serialize)]
#[serde(tag = "type")]
pub enum RustMessage {
    Ready,
    ExpandRequested,
    PositionChanged { x: i32, y: i32 },
    OutputList { outputs: Vec<OutputInfo> },
    Error { message: String },
}

/// Info about an available output/monitor.
#[derive(Debug, Serialize)]
pub struct OutputInfo {
    pub name: String,
    pub description: String,
    pub active: bool,
}
