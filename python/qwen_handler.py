#!/usr/bin/env python3
"""
Qwen Handler for Voice Mirror

Routes voice commands to local Qwen LLM via Ollama. Parses tool calls
and dispatches to registered handlers.

Usage:
    from qwen_handler import QwenHandler

    handler = QwenHandler()
    response = await handler.process("turn on the TV")
    response = await handler.process("what's the weather")
"""

import asyncio
import json
import re
import time
from collections import deque
from typing import Optional, Dict, Any, List

from settings import load_voice_settings
from prompts import build_system_prompt
from tools import register_smart_home_tools, register_web_search_tools, register_n8n_tools, register_gmail_tools, register_github_ci_tools, register_weather_tools, register_n8n_builder_tools

# Conversation memory settings
MEMORY_WINDOW_SIZE = 5  # Number of exchanges to remember
MEMORY_TIMEOUT = 300  # 5 minutes - clear memory after inactivity

try:
    import httpx
    HTTPX_AVAILABLE = True
except ImportError:
    HTTPX_AVAILABLE = False

# Ollama settings
OLLAMA_URL = "http://localhost:11434"
OLLAMA_MODEL = "qwen-coder-14b"


class QwenHandler:
    """Route voice commands to Qwen and dispatch tool calls."""

    def __init__(self, smart_home=None):
        self.settings = load_voice_settings()

        # Register all tool handlers
        self.handlers: Dict[str, Any] = {}
        self._register_handlers(smart_home)

        # Conversation memory - sliding window of recent exchanges
        self.memory: deque = deque(maxlen=MEMORY_WINDOW_SIZE)
        self.last_interaction: float = 0

    def _register_handlers(self, smart_home):
        """Register all tool handlers."""
        # Smart home tools
        self.handlers.update(register_smart_home_tools(smart_home))

        # Web search (uses SearXNG, just needs LLM caller for summarization)
        self.handlers.update(
            register_web_search_tools(None, self._call_ollama)
        )

        # n8n workflow automation
        self.handlers.update(
            register_n8n_tools(None, self._call_ollama)
        )

        # Gmail (via n8n webhook)
        self.handlers.update(register_gmail_tools())

        # GitHub CI status (via gh CLI)
        self.handlers.update(register_github_ci_tools())

        # Weather (via Open-Meteo API - free, no auth)
        location = self.settings.get("location", "London, UK")
        self.handlers.update(register_weather_tools(location))

        # n8n workflow builder (full n8n access via shared client)
        self.handlers.update(register_n8n_builder_tools())

    async def _call_ollama(self, messages: List[Dict]) -> str:
        """Call Ollama API and return content."""
        if not HTTPX_AVAILABLE:
            return "Error: httpx not installed"

        payload = {
            "model": OLLAMA_MODEL,
            "messages": messages,
            "stream": False,
        }

        async with httpx.AsyncClient(timeout=60.0) as client:
            response = await client.post(
                f"{OLLAMA_URL}/api/chat",
                json=payload
            )
            response.raise_for_status()
            data = response.json()
            return data.get("message", {}).get("content", "")

    def _parse_tool_call(self, content: str) -> Optional[Dict]:
        """Parse a tool call from the response content."""
        content = content.strip()

        # Strip markdown code blocks (```json ... ```)
        code_block_match = re.search(r'```(?:json)?\s*([\s\S]*?)```', content)
        if code_block_match:
            content = code_block_match.group(1).strip()

        # Try parsing the whole content as JSON first (most common case)
        try:
            data = json.loads(content)
            if "tool" in data:
                return data
        except json.JSONDecodeError:
            pass

        # Find JSON by matching balanced braces (handles deep nesting)
        def extract_json_objects(text: str) -> list:
            """Extract JSON objects with balanced braces."""
            objects = []
            i = 0
            while i < len(text):
                if text[i] == '{':
                    depth = 1
                    start = i
                    i += 1
                    while i < len(text) and depth > 0:
                        if text[i] == '{':
                            depth += 1
                        elif text[i] == '}':
                            depth -= 1
                        i += 1
                    if depth == 0:
                        objects.append(text[start:i])
                else:
                    i += 1
            return objects

        for json_str in extract_json_objects(content):
            try:
                data = json.loads(json_str)
                if isinstance(data, dict) and "tool" in data:
                    return data
            except json.JSONDecodeError:
                continue

        return None

    async def _execute_tool(self, tool_call: Dict) -> str:
        """Execute a tool call and return the result."""
        tool_name = tool_call.get("tool", "")
        args = tool_call.get("args", {})

        handler = self.handlers.get(tool_name)
        if handler:
            try:
                return await handler.execute(**args)
            except Exception as e:
                return f"Tool error: {e}"

        return f"Unknown tool: {tool_name}"

    async def _summarize_for_speech(self, tool_result: str, original_request: str) -> str:
        """Have Qwen summarize a tool result into natural speech."""
        messages = [
            {"role": "system", "content": """You are summarizing tool results for text-to-speech.
Convert the data into a natural, spoken response. Keep it concise (2-4 sentences).
Do NOT read out markdown syntax like ## or ** or bullet points.
Just speak naturally as if telling someone the information."""},
            {"role": "user", "content": f"User asked: {original_request}\n\nTool returned:\n{tool_result}\n\nSummarize this naturally for speech:"}
        ]

        try:
            summary = await self._call_ollama(messages)
            return summary if summary else tool_result
        except Exception:
            # Fallback: strip markdown manually
            import re
            clean = re.sub(r'#{1,6}\s*', '', tool_result)  # Remove headers
            clean = re.sub(r'\*\*([^*]+)\*\*', r'\1', clean)  # Remove bold
            clean = re.sub(r'\*([^*]+)\*', r'\1', clean)  # Remove italic
            clean = re.sub(r'^- ', '', clean, flags=re.MULTILINE)  # Remove bullets
            return clean.strip()

    def _get_system_prompt(self) -> str:
        """Build system prompt with location."""
        location = self.settings.get("location", "United Kingdom")
        return build_system_prompt(location=location)

    def _check_memory_timeout(self):
        """Clear memory if inactive for too long."""
        if time.time() - self.last_interaction > MEMORY_TIMEOUT:
            self.memory.clear()
            print("🧠 Memory cleared (timeout)")

    def _build_messages_with_memory(self, text: str) -> List[Dict]:
        """Build message list including conversation history."""
        messages = [{"role": "system", "content": self._get_system_prompt()}]

        # Add conversation history
        for exchange in self.memory:
            messages.append({"role": "user", "content": exchange["user"]})
            messages.append({"role": "assistant", "content": exchange["assistant"]})

        # Add current message
        messages.append({"role": "user", "content": text})
        return messages

    def _add_to_memory(self, user_msg: str, assistant_msg: str):
        """Add an exchange to memory."""
        self.memory.append({
            "user": user_msg,
            "assistant": assistant_msg
        })
        self.last_interaction = time.time()

    def clear_memory(self):
        """Manually clear conversation memory."""
        self.memory.clear()
        print("🧠 Memory cleared")

    async def process(self, text: str) -> str:
        """
        Process a voice command via Qwen.
        Returns the response text to speak.
        """
        if not HTTPX_AVAILABLE:
            return "HTTP client not available. Install httpx."

        # Check for memory timeout
        self._check_memory_timeout()

        # Build messages with conversation history
        messages = self._build_messages_with_memory(text)

        if len(self.memory) > 0:
            print(f"🧠 Memory: {len(self.memory)} previous exchanges")

        try:
            response = await self._call_ollama(messages)

            if not response:
                return "I didn't get a response."

            # Check for tool call
            tool_call = self._parse_tool_call(response)
            if tool_call:
                print(f"🔧 Tool call detected: {tool_call.get('tool')}")
                result = await self._execute_tool(tool_call)
                print(f"🔧 Tool result: {result[:100]}..." if len(result) > 100 else f"🔧 Tool result: {result}")

                # Summarize the result for natural speech (converts markdown to spoken form)
                spoken_result = await self._summarize_for_speech(result, text)
                print(f"🗣️ Spoken: {spoken_result[:80]}..." if len(spoken_result) > 80 else f"🗣️ Spoken: {spoken_result}")

                # Add to memory (store the tool result as the assistant response)
                self._add_to_memory(text, result)
                return spoken_result

            # Conversational response - add to memory
            self._add_to_memory(text, response)
            return response

        except httpx.ConnectError:
            return "Couldn't connect to Ollama. Make sure it's running."
        except httpx.HTTPStatusError as e:
            return f"Ollama error: {e.response.status_code}"
        except Exception as e:
            return f"Error: {e}"


# Intent classification for smart routing (Voice Mirror uses this)
SMART_HOME_KEYWORDS = [
    "turn on", "turn off", "switch on", "switch off", "power on", "power off",
    "wake up", "start", "shut down",
    "is the", "is my", "check if", "status of", "is it online", "is it on",
    "discover devices", "scan network", "find devices", "search for devices",
    "list devices", "what devices", "show devices",
    "tv on", "tv off", "mute", "unmute", "volume up", "volume down",
    "louder", "quieter", "pause", "play", "resume",
    "netflix", "youtube", "disney", "amazon", "spotify", "twitch",
    "hdmi", "switch to", "open", "launch",
    "playstation", "xbox", "tv", "television", "computer", "pc",
]

WEB_SEARCH_KEYWORDS = [
    "news", "latest", "current events",
    "price", "cost", "how much",
    "store hours", "open until", "closing time",
    "search for", "look up", "find out",
    "what is", "who is", "where is", "when is",
    # Traffic/road conditions - web search handles these
    "traffic", "roads", "road conditions",
    "accidents", "accident", "crash",
    "roadworks", "road works",
    "how are the roads", "what are the roads like",
    "any delays", "commute",
]

WEATHER_KEYWORDS = [
    "weather", "forecast", "temperature",
    "will it rain", "is it raining", "rain today", "rain tomorrow",
    "how cold", "how hot", "how warm",
    "sunny", "cloudy", "snowing", "snow",
]

N8N_KEYWORDS = [
    "workflow", "workflows", "automation", "automations",
    "run workflow", "trigger workflow", "list workflows",
    "n8n", "automate",
]

GMAIL_KEYWORDS = [
    "email", "emails", "inbox", "mail",
    "check my email", "check my emails", "check my inbox",
    "read my email", "read my emails", "read email",
    "any emails", "any new emails", "new emails",
    "archive email", "archive emails", "archive my",
    "delete email", "delete emails",
    "send email", "send an email", "email to",
]

GITHUB_CI_KEYWORDS = [
    "ci status", "ci failing", "ci passing", "ci failed",
    "build status", "build failing", "build passing", "build failed",
    "github actions", "workflow status", "workflow failing",
    "did the build pass", "is the build passing", "any ci failures",
    "check ci", "check the build", "check the ci",
]

def is_smart_home_command(text: str) -> bool:
    """Check if text is likely a smart home command."""
    text_lower = text.lower()
    return any(keyword in text_lower for keyword in SMART_HOME_KEYWORDS)


def is_web_search_query(text: str) -> bool:
    """Check if text is likely a web search query."""
    text_lower = text.lower()
    return any(keyword in text_lower for keyword in WEB_SEARCH_KEYWORDS)


def is_n8n_command(text: str) -> bool:
    """Check if text is likely an n8n workflow command."""
    text_lower = text.lower()
    return any(keyword in text_lower for keyword in N8N_KEYWORDS)


def is_gmail_command(text: str) -> bool:
    """Check if text is likely an email command."""
    text_lower = text.lower()
    return any(keyword in text_lower for keyword in GMAIL_KEYWORDS)


def is_github_ci_command(text: str) -> bool:
    """Check if text is likely a GitHub CI status command."""
    text_lower = text.lower()
    return any(keyword in text_lower for keyword in GITHUB_CI_KEYWORDS)


def is_weather_query(text: str) -> bool:
    """Check if text is likely a weather query."""
    text_lower = text.lower()
    return any(keyword in text_lower for keyword in WEATHER_KEYWORDS)


def should_route_to_qwen(text: str) -> bool:
    """Check if query should be routed to Qwen (local)."""
    return (
        is_smart_home_command(text) or
        is_web_search_query(text) or
        is_n8n_command(text) or
        is_gmail_command(text) or
        is_github_ci_command(text) or
        is_weather_query(text)
    )


# CLI for testing
async def main():
    """Test the Qwen handler."""
    from smart_home import SmartHome

    print("=" * 50)
    print("Qwen Handler Test")
    print("=" * 50)

    smart_home = SmartHome()
    handler = QwenHandler(smart_home)

    test_commands = [
        "turn on the playstation",
        "is the xbox online?",
        "list devices",
        "what's the weather like?",
        "open netflix",
    ]

    for cmd in test_commands:
        print(f"\nCommand: {cmd}")
        print(f"   Is smart home: {is_smart_home_command(cmd)}")
        response = await handler.process(cmd)
        print(f"   Response: {response}")


if __name__ == "__main__":
    asyncio.run(main())
