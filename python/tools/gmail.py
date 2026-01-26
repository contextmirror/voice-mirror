"""Gmail tool handler - email via n8n webhook."""

import json
import re
from typing import Optional, List, Dict

try:
    import httpx
    HTTPX_AVAILABLE = True
except ImportError:
    HTTPX_AVAILABLE = False

# n8n Gmail webhook
GMAIL_WEBHOOK_URL = "http://localhost:5678/webhook/gmail"

# Cache of recent emails from last check (shared across instances)
_email_cache: List[Dict] = []


class GmailToolHandler:
    """Handle Gmail operations via n8n webhook."""

    async def execute(
        self,
        action: str = "check",
        query: str = None,
        email_number: int = None,
        to: str = None,
        subject: str = None,
        body: str = None,
        labels: list = None,
        name: str = None,
        **kwargs
    ) -> str:
        """
        Execute a Gmail action.

        Actions:
            check - Check inbox, returns summary of recent emails
            read - Read a specific email (use email_number 1-5 from last check, or query)
            archive - Archive emails matching query
            send - Send an email (requires to, subject, body)
            delete - Delete emails matching query
            label - Apply labels to an email (use email_number + labels, or query + labels)
            labels - List all available labels
            create_label - Create a new label (requires name)

        Args:
            email_number: For read/label action, specify 1-5 to target that email from the last check
            labels: List of label names to apply (e.g., ["STARRED", "IMPORTANT", "GitHub"])
            name: For create_label action, the name of the new label
        """
        global _email_cache

        if not HTTPX_AVAILABLE:
            return "Error: httpx not installed"

        # Handle "read/label/delete email N" using cached IDs
        if action in ("read", "label", "delete") and email_number is not None:
            if not _email_cache:
                return "No emails cached. Please check your inbox first."
            if email_number < 1 or email_number > len(_email_cache):
                return f"Invalid email number. You have {len(_email_cache)} emails. Say 'read email 1' through 'read email {len(_email_cache)}'."

            # Get the cached email info
            cached_email = _email_cache[email_number - 1]
            email_subject = cached_email.get("subject", "")

            # Use the subject to find the email (most reliable with Gmail API)
            if email_subject:
                query = f'subject:"{email_subject}"'

        # Safety: require query for destructive actions
        if action in ("delete", "archive") and not query and email_number is None:
            return f"Please specify which emails to {action}. Say '{action} email 1' or '{action} emails from sender'."

        # Build request payload
        payload = {"action": action}

        if query:
            payload["query"] = query
        if to:
            payload["to"] = to
        if subject:
            payload["subject"] = subject
        if body:
            payload["body"] = body
        if labels:
            payload["labels"] = labels
        if name:
            payload["name"] = name

        try:
            async with httpx.AsyncClient(timeout=30.0) as client:
                response = await client.post(
                    GMAIL_WEBHOOK_URL,
                    json=payload
                )
                response.raise_for_status()
                data = response.json()

                # Cache email list from check action
                if action == "check" and "emails" in data:
                    _email_cache = data["emails"]
                    print(f"📧 Cached {len(_email_cache)} email IDs for quick access")

                # Return the summary field (formatted for voice)
                if "summary" in data:
                    return data["summary"]
                elif "error" in data:
                    return f"Error: {data.get('message', 'Unknown error')}"
                else:
                    return json.dumps(data)

        except httpx.ConnectError:
            return "Couldn't connect to n8n. Make sure it's running."
        except httpx.HTTPStatusError as e:
            return f"Gmail error: {e.response.status_code}"
        except Exception as e:
            return f"Error: {e}"


def register_gmail_tools() -> dict:
    """Create and return Gmail tool handler."""
    return {
        "gmail": GmailToolHandler(),
    }
