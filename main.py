"""Local Uvicorn entry point for the instructions API."""

from __future__ import annotations

import asyncio
import os
import selectors
import sys

import uvicorn

from api import app


__all__ = ["app"]


def main() -> None:
    host = os.getenv("API_HOST", "127.0.0.1")
    port = int(os.getenv("API_PORT", "8000"))
    config = uvicorn.Config(app, host=host, port=port)
    server = uvicorn.Server(config)
    if sys.platform == "win32":
        asyncio.run(
            server.serve(),
            loop_factory=lambda: asyncio.SelectorEventLoop(selectors.SelectSelector()),
        )
        return
    asyncio.run(server.serve())


if __name__ == "__main__":
    main()
