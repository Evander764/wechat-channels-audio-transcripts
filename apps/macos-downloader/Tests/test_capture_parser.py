import json
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "Resources" / "proxy"))

from wcd_capture_parser import classify_url, parse_capture, sanitize_headers


class CaptureParserTests(unittest.TestCase):
    def test_classifies_media_urls(self):
        self.assertEqual(classify_url("https://example.com/a.m3u8?x=1"), "hls")
        self.assertEqual(classify_url("https://example.com/a.mp4"), "video")
        self.assertEqual(classify_url("https://example.com/a.flv"), "live")
        self.assertEqual(classify_url("https://example.com/a.m4s"), "fragment")

    def test_drops_sensitive_headers(self):
        headers = sanitize_headers({
            "User-Agent": "UA",
            "Cookie": "secret",
            "Authorization": "Bearer secret",
            "Referer": "https://channels.weixin.qq.com/",
        })
        self.assertEqual(headers["User-Agent"], "UA")
        self.assertEqual(headers["Referer"], "https://channels.weixin.qq.com/")
        self.assertNotIn("Cookie", headers)
        self.assertNotIn("Authorization", headers)

    def test_extracts_title_and_nested_media_url(self):
        body = json.dumps({
            "objectDesc": "测试标题",
            "object": {
                "media": {
                    "url": "https://finder.video.qq.com/path/playlist.m3u8?token=abc"
                }
            }
        })
        records = parse_capture(
            "https://channels.weixin.qq.com/cgi-bin/mmfinderassistant-bin/helper",
            {"User-Agent": "UA", "Cookie": "secret"},
            {"content-type": "application/json"},
            body,
            200,
        )
        self.assertEqual(len(records), 1)
        self.assertEqual(records[0]["media_type"], "hls")
        self.assertEqual(records[0]["title"], "测试标题")
        self.assertNotIn("Cookie", records[0]["headers"])


if __name__ == "__main__":
    unittest.main()
