//! Shared message types and length-prefixed framing for the named pipe IPC.
//!
//! Messages are framed as: 4 bytes (u32 LE length) + JSON payload.
//! This avoids issues with newlines inside message text.

use serde::{Deserialize, Serialize};
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt};

// ---------------------------------------------------------------------------
// Message types
// ---------------------------------------------------------------------------

/// Messages sent FROM the MCP binary TO the Tauri app.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum McpToApp {
    /// AI sent a voice message (voice_send was called).
    VoiceSend {
        from: String,
        message: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        thread_id: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        reply_to: Option<String>,
        message_id: String,
        timestamp: String,
    },
    /// AI started listening for messages (voice_listen was called).
    ListenStart {
        instance_id: String,
        from_sender: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        thread_id: Option<String>,
    },
    /// MCP binary connected and is ready.
    Ready,
}

/// Messages sent FROM the Tauri app TO the MCP binary.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum AppToMcp {
    /// User sent a voice/chat message.
    UserMessage {
        id: String,
        from: String,
        message: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        thread_id: Option<String>,
        timestamp: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        image_path: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        image_data_url: Option<String>,
    },
    /// Request the MCP binary to shut down.
    Shutdown,
}

// ---------------------------------------------------------------------------
// Length-prefixed framing
// ---------------------------------------------------------------------------

/// Maximum message size (1 MB). Prevents runaway reads.
const MAX_MESSAGE_SIZE: u32 = 1024 * 1024;

/// Write a length-prefixed JSON message to the given writer.
pub async fn write_message<W, T>(writer: &mut W, msg: &T) -> Result<(), std::io::Error>
where
    W: AsyncWrite + Unpin,
    T: Serialize,
{
    let json = serde_json::to_vec(msg)
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))?;
    let len = json.len() as u32;
    writer.write_all(&len.to_le_bytes()).await?;
    writer.write_all(&json).await?;
    writer.flush().await?;
    Ok(())
}

/// Read a length-prefixed JSON message from the given reader.
///
/// Returns `None` if the connection was closed (EOF on length prefix).
pub async fn read_message<R, T>(reader: &mut R) -> Result<Option<T>, std::io::Error>
where
    R: AsyncRead + Unpin,
    T: for<'de> Deserialize<'de>,
{
    // Read 4-byte length prefix
    let mut len_buf = [0u8; 4];
    match reader.read_exact(&mut len_buf).await {
        Ok(_) => {}
        Err(e) if e.kind() == std::io::ErrorKind::UnexpectedEof => return Ok(None),
        Err(e) => return Err(e),
    }

    let len = u32::from_le_bytes(len_buf);
    if len > MAX_MESSAGE_SIZE {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            format!("Message too large: {} bytes (max {})", len, MAX_MESSAGE_SIZE),
        ));
    }

    // Read JSON payload
    let mut buf = vec![0u8; len as usize];
    reader.read_exact(&mut buf).await?;

    let msg = serde_json::from_slice(&buf)
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))?;

    Ok(Some(msg))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_mcp_to_app_roundtrip() {
        let msg = McpToApp::VoiceSend {
            from: "voice-claude".into(),
            message: "Hello world".into(),
            thread_id: Some("voice-mirror".into()),
            reply_to: None,
            message_id: "msg-123".into(),
            timestamp: "2025-01-01T00:00:00.000Z".into(),
        };
        let json = serde_json::to_string(&msg).unwrap();
        let parsed: McpToApp = serde_json::from_str(&json).unwrap();
        match parsed {
            McpToApp::VoiceSend { message, .. } => assert_eq!(message, "Hello world"),
            _ => panic!("wrong variant"),
        }
    }

    #[test]
    fn test_app_to_mcp_roundtrip() {
        let msg = AppToMcp::UserMessage {
            id: "u-1".into(),
            from: "user".into(),
            message: "Hi there".into(),
            thread_id: None,
            timestamp: "2025-01-01T00:00:00.000Z".into(),
            image_path: None,
            image_data_url: None,
        };
        let json = serde_json::to_string(&msg).unwrap();
        let parsed: AppToMcp = serde_json::from_str(&json).unwrap();
        match parsed {
            AppToMcp::UserMessage { from, message, .. } => {
                assert_eq!(from, "user");
                assert_eq!(message, "Hi there");
            }
            _ => panic!("wrong variant"),
        }
    }

    #[test]
    fn test_ready_roundtrip() {
        let msg = McpToApp::Ready;
        let json = serde_json::to_string(&msg).unwrap();
        assert!(json.contains("\"type\":\"Ready\""));
        let parsed: McpToApp = serde_json::from_str(&json).unwrap();
        assert!(matches!(parsed, McpToApp::Ready));
    }

    #[test]
    fn test_shutdown_roundtrip() {
        let msg = AppToMcp::Shutdown;
        let json = serde_json::to_string(&msg).unwrap();
        let parsed: AppToMcp = serde_json::from_str(&json).unwrap();
        assert!(matches!(parsed, AppToMcp::Shutdown));
    }

    #[tokio::test]
    async fn test_framing_roundtrip() {
        let msg = McpToApp::VoiceSend {
            from: "test".into(),
            message: "Multi\nline\nmessage".into(),
            thread_id: None,
            reply_to: None,
            message_id: "m-1".into(),
            timestamp: "t".into(),
        };

        // Write to buffer
        let mut buf = Vec::new();
        write_message(&mut buf, &msg).await.unwrap();

        // Read back
        let mut cursor = std::io::Cursor::new(buf);
        let parsed: Option<McpToApp> = read_message(&mut cursor).await.unwrap();
        match parsed.unwrap() {
            McpToApp::VoiceSend { message, .. } => {
                assert_eq!(message, "Multi\nline\nmessage");
            }
            _ => panic!("wrong variant"),
        }
    }
}
