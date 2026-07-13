#!/usr/bin/env python3
"""在本机启动「钱都去哪了」，不提供局域网或互联网访问。"""

from __future__ import annotations

import argparse
import contextlib
import http.server
import os
import socket
import threading
import webbrowser
from pathlib import Path


ROOT = Path(__file__).resolve().parent

# 不允许通过 HTTP 服务暴露的文件/目录
_SENSITIVE_PATTERNS = [
    ".env", ".git", "__pycache__", "analysis_data.json", "categories.local.json",
    "*.csv", "*.xls", "*.xlsx", "*.pdf", "decrypted_", "_tmp_", "report*.html",
    "boc_report.html", "*.py", ".claude",
]

def _is_path_safe(request_path: str) -> bool:
    """检查请求路径是否指向敏感文件"""
    basename = os.path.basename(request_path)
    for pattern in _SENSITIVE_PATTERNS:
        if pattern.startswith("*"):
            if basename.endswith(pattern[1:]):
                return False
        elif pattern in basename or pattern in request_path:
            return False
    return True


class SafeRequestHandler(http.server.SimpleHTTPRequestHandler):
    """限制访问敏感文件的自定义 handler"""

    def __init__(self, *args, **kwargs):
        self.directory = str(ROOT)
        super().__init__(*args, **kwargs)

    def translate_path(self, path):
        """拦截对敏感文件的请求"""
        if not _is_path_safe(path):
            return os.path.join(self.directory, "__nonexistent__")
        return super().translate_path(path)

    def log_message(self, format, *args):
        """精简日志，减少信息泄露"""
        if "404" in str(args):
            return
        super().log_message(format, *args)


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
    handler = SafeRequestHandler  # noqa: E731
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

