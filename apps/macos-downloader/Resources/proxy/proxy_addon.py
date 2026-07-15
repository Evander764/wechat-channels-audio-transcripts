from __future__ import annotations

import json
import os
import sys
from pathlib import Path

from mitmproxy import http

HERE = Path(__file__).resolve().parent
if str(HERE) not in sys.path:
    sys.path.insert(0, str(HERE))

from wcd_capture_parser import parse_capture


class WeChatChannelsCapture:
    def __init__(self) -> None:
        root = Path(os.environ.get("WCD_STATE_DIR", Path.home() / "Library/Application Support/WeChat Channels Downloader"))
        self.capture_log = root / "captures.jsonl"
        self.capture_log.parent.mkdir(parents=True, exist_ok=True)

    def response(self, flow: http.HTTPFlow) -> None:
        text = ""
        if flow.response and flow.response.raw_content:
            content_type = flow.response.headers.get("content-type", "")
            if "json" in content_type or "text" in content_type or "mpegurl" in content_type:
                text = flow.response.get_text(strict=False)[:1_000_000]
        records = parse_capture(
            request_url=flow.request.pretty_url,
            request_headers=dict(flow.request.headers),
            response_headers=dict(flow.response.headers) if flow.response else {},
            response_text=text,
            status_code=flow.response.status_code if flow.response else 0,
        )
        if not records:
            return
        with self.capture_log.open("a", encoding="utf-8") as f:
            for record in records:
                f.write(json.dumps(record, ensure_ascii=False, separators=(",", ":")) + "\n")


addons = [WeChatChannelsCapture()]
