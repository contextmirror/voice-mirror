"""Web search tool handler using SearXNG with LLM summarization."""

import urllib.parse
import urllib.request
import json
import uuid
from pathlib import Path
from datetime import datetime
from typing import List, Dict, Callable, Awaitable, Optional

from prompts import SEARCH_SUMMARIZE_PROMPT

# MCP inbox path for Voice Mirror
INBOX_PATH = Path.home() / ".config" / "voice-mirror-electron" / "data" / "inbox.json"

# SearXNG local instance
SEARXNG_URL = "http://localhost:8888"


class WebSearchHandler:
    """
    Search the web via SearXNG and summarize results for voice output.

    SearXNG aggregates results from Google, Brave, Startpage, etc.
    Much better quality than DuckDuckGo alone.
    """

    def __init__(self, llm_caller: Callable[[List[Dict]], Awaitable[str]]):
        """
        Args:
            llm_caller: Async function to call Ollama (messages -> content)
        """
        self.llm_caller = llm_caller
        self.last_sources: Optional[List[Dict]] = None  # Store sources from last search

    async def execute(self, query: str = "", max_results: int = 5, **kwargs) -> str:
        if not query:
            return "No search query provided"

        try:
            results = await self._search(query, max_results)

            if not results:
                self.last_sources = None
                return f"I couldn't find any results for {query}."

            # Store sources for sidebar display
            self.last_sources = [
                {"title": r.get("title", ""), "url": r.get("url", "")}
                for r in results if r.get("url")
            ]

            # Write sources to MCP inbox for Context Mirror sidebar
            self._write_sources_to_inbox(query, self.last_sources)

            return await self._summarize_results(query, results)

        except Exception as e:
            self.last_sources = None
            return f"Search error: {e}"

    def _write_sources_to_inbox(self, query: str, sources: List[Dict]) -> None:
        """Write search sources to MCP inbox for Context Mirror sidebar."""
        if not sources:
            return

        try:
            # Ensure inbox exists
            if not INBOX_PATH.exists():
                INBOX_PATH.parent.mkdir(parents=True, exist_ok=True)
                data = {"messages": []}
            else:
                with open(INBOX_PATH, 'r') as f:
                    data = json.load(f)

            # Create voice_sources message
            msg = {
                "id": f"msg-{uuid.uuid4().hex[:12]}",
                "from": "voice-mirror",
                "type": "voice_sources",
                "message": json.dumps({
                    "query": query,
                    "sources": sources[:5]  # Limit to 5 sources
                }),
                "timestamp": datetime.now().isoformat(),
                "thread_id": "voice-mirror",
                "read_by": []
            }

            data["messages"].append(msg)

            with open(INBOX_PATH, 'w') as f:
                json.dump(data, f, indent=2)

            print(f"📚 Sources sent to sidebar ({len(sources)} links)")

        except Exception as e:
            print(f"⚠️ Failed to write sources to inbox: {e}")

    async def _search(self, query: str, max_results: int = 5) -> List[Dict]:
        """Query SearXNG and return results."""
        import asyncio

        # Build URL with query params
        params = urllib.parse.urlencode({
            "q": query,
            "format": "json"
        })
        url = f"{SEARXNG_URL}/search?{params}"

        # Run blocking request in thread pool
        def _fetch():
            req = urllib.request.Request(url, headers={"User-Agent": "VoiceMirror/1.0"})
            with urllib.request.urlopen(req, timeout=10) as resp:
                return json.loads(resp.read().decode())

        loop = asyncio.get_event_loop()
        data = await loop.run_in_executor(None, _fetch)

        # Extract results (SearXNG uses 'content' not 'body')
        raw_results = data.get("results", [])[:max_results]

        # Normalize to our format
        return [
            {
                "title": r.get("title", ""),
                "body": r.get("content", ""),  # SearXNG uses 'content'
                "url": r.get("url", ""),
                "engines": r.get("engines", []),
            }
            for r in raw_results
        ]

    async def _summarize_results(self, query: str, results: List[Dict]) -> str:
        """Summarize search results into voice-friendly response."""
        if not results:
            return f"I couldn't find any results for {query}."

        # Format results for LLM
        formatted = []
        for i, r in enumerate(results[:5], 1):
            title = r.get("title", "")[:100]
            body = r.get("body", "")[:200]
            formatted.append(f"{i}. {title}: {body}")

        results_text = "\n".join(formatted)
        prompt = SEARCH_SUMMARIZE_PROMPT.format(query=query, results=results_text)

        try:
            messages = [{"role": "user", "content": prompt}]
            summary = await self.llm_caller(messages)
            return summary.strip() if summary else f"Found results for {query} but couldn't summarize."
        except Exception:
            # Fallback to first result snippet
            return results[0].get("body", f"Found results for {query}.")[:200]


def register_web_search_tools(tool_registry, llm_caller) -> dict:
    """Create and return web search tool handlers.

    Note: tool_registry is no longer needed (was for Docker).
    Kept for API compatibility.
    """
    return {
        "web_search": WebSearchHandler(llm_caller),
    }
