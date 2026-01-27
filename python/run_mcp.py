#!/usr/bin/env python3
"""Entry point for Voice Mirror MCP server."""

import sys
from pathlib import Path

# Ensure the parent directory is in the path
sys.path.insert(0, str(Path(__file__).parent))

import asyncio

from voice_mcp.server import main

if __name__ == "__main__":
    asyncio.run(main())
