#!/usr/bin/env python3
"""Entry point for Voice Mirror MCP server."""

import sys
from pathlib import Path

# Ensure the parent directory is in the path
sys.path.insert(0, str(Path(__file__).parent))

from voice_mcp.server import main
import asyncio

if __name__ == "__main__":
    asyncio.run(main())
