#!/usr/bin/env python3
"""在本机启动「钱都去哪了」，不提供局域网或互联网访问。"""

from __future__ import annotations

import argparse
import contextlib
import http.server
import socket
import threading
import webbrowser
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent


class LocalOnlyServer(http.server.ThreadingHTTPServer):
    allow_reuse_address = True


def choose_port(preferred: int) -> int:
    """Return the preferred local port, or a free local port if it is busy."""
    with contextlib.closing(socket.socket(socket.AF_INET, socket.SOCK_STREAM)) as probe:
        try:
            probe.bind(("127.0.0.1", preferred))
            return preferred
        except OSError:
            probe.bind(("127.0.0.1", 0))
            return int(probe.getsockname()[1])


def main() -> None:
    parser = argparse.ArgumentParser(description="在本机浏览器中打开「钱都去哪了」")
    parser.add_argument("--port", type=int, default=8765, help="本机端口，默认 8765")
    parser.add_argument("--no-browser", action="store_true", help="只启动服务，不自动打开浏览器")
    args = parser.parse_args()

    port = choose_port(args.port)
    handler = lambda *handler_args, **handler_kwargs: http.server.SimpleHTTPRequestHandler(  # noqa: E731
        *handler_args, directory=str(ROOT), **handler_kwargs
    )
    server = LocalOnlyServer(("127.0.0.1", port), handler)
    url = f"http://127.0.0.1:{port}/index.html"

    print(f"钱都去哪了：{url}")
    print("账单只在当前浏览器中解析。按 Ctrl+C 可关闭工具。")
    if not args.no_browser:
        threading.Timer(0.25, lambda: webbrowser.open(url)).start()

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n工具已关闭。")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()

