//! Pipe message router for the MCP binary.
//!
//! Routes incoming `AppToMcp` messages from the pipe to the appropriate handler:
//! - `BrowserResponse` -> oneshot channel matched by request_id
//! - `UserMessage` -> mpsc channel consumed by voice_listen
//! - `Shutdown` -> mpsc channel consumed by voice_listen
//!
//! This solves the concurrency issue where both `voice_listen` and
//! `pipe_browser_request` need to receive from the same pipe connection.

use std::collections::HashMap;
use std::sync::Arc;

use tokio::sync::{mpsc, oneshot, Mutex};
use tracing::{info, warn};

use crate::ipc::pipe_client::PipeClient;
use crate::ipc::protocol::{AppToMcp, McpToApp};

/// Routes pipe messages to the appropriate handler.
pub struct PipeRouter {
    pipe: Arc<PipeClient>,
    /// Pending browser requests waiting for responses, keyed by request_id.
    browser_waiters: Arc<Mutex<HashMap<String, oneshot::Sender<AppToMcp>>>>,
    /// Channel for UserMessage/Shutdown delivery (voice_listen consumes from here).
    user_messages_tx: mpsc::UnboundedSender<AppToMcp>,
    /// Receiver for user messages. Protected by mutex for single-consumer use.
    pub user_messages_rx: Mutex<mpsc::UnboundedReceiver<AppToMcp>>,
}

impl PipeRouter {
    pub fn new(pipe: Arc<PipeClient>) -> Arc<Self> {
        let (tx, rx) = mpsc::unbounded_channel();
        Arc::new(Self {
            pipe,
            browser_waiters: Arc::new(Mutex::new(HashMap::new())),
            user_messages_tx: tx,
            user_messages_rx: Mutex::new(rx),
        })
    }

    /// Start the background message dispatch loop.
    ///
    /// Spawns a tokio task that reads from the pipe and routes each message
    /// to the appropriate channel. Returns when the pipe is closed.
    pub fn start_dispatch(self: &Arc<Self>) {
        let router = Arc::clone(self);
        tokio::spawn(async move {
            info!("[PipeRouter] Starting dispatch loop");
            loop {
                match router.pipe.recv().await {
                    Ok(Some(msg)) => router.dispatch(msg).await,
                    Ok(None) => {
                        info!("[PipeRouter] Pipe closed (EOF)");
                        break;
                    }
                    Err(e) => {
                        warn!("[PipeRouter] Pipe recv error: {}", e);
                        break;
                    }
                }
            }
            info!("[PipeRouter] Dispatch loop ended");
        });
    }

    /// Route a single message to the appropriate handler.
    async fn dispatch(&self, msg: AppToMcp) {
        match &msg {
            AppToMcp::BrowserResponse { request_id, .. }
            | AppToMcp::CaptureResponse { request_id, .. }
            | AppToMcp::LogEntries { request_id, .. } => {
                let mut waiters = self.browser_waiters.lock().await;
                if let Some(tx) = waiters.remove(request_id) {
                    let _ = tx.send(msg);
                } else {
                    warn!(
                        "[PipeRouter] No waiter for response: {}",
                        request_id
                    );
                }
            }
            AppToMcp::UserMessage { .. } | AppToMcp::Shutdown => {
                if self.user_messages_tx.send(msg).is_err() {
                    warn!("[PipeRouter] User message channel closed");
                }
            }
        }
    }

    /// Register a waiter for a browser response and return the receiver.
    pub async fn wait_for_browser_response(
        &self,
        request_id: &str,
    ) -> oneshot::Receiver<AppToMcp> {
        let (tx, rx) = oneshot::channel();
        self.browser_waiters
            .lock()
            .await
            .insert(request_id.to_string(), tx);
        rx
    }

    /// Remove a waiter that is no longer needed (e.g. after timeout).
    ///
    /// Prevents stale entries from leaking memory in the waiters map when
    /// the response never arrives.
    pub async fn remove_waiter(&self, request_id: &str) {
        self.browser_waiters.lock().await.remove(request_id);
    }

    /// Send a message through the pipe to the Tauri app.
    pub async fn send(&self, msg: &McpToApp) -> Result<(), std::io::Error> {
        self.pipe.send(msg).await
    }
}
