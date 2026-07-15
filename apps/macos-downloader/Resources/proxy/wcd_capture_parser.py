from __future__ import annotations

import hashlib
import json
import re
import time
from typing import Any, Dict, Iterable, List, Optional
from urllib.parse import unquote, urlparse

MEDIA_EXT_RE = re.compile(r"\.(m3u8|mp4|m4s|flv)(?:[?#]|$)", re.I)
URL_RE = re.compile(r"https?://[^\s\"'<>\\]+", re.I)
TITLE_KEYS = {
    "title",
    "desc",
    "description",
    "objectdesc",
    "nickname",
    "nickname",
    "nick_name",
    "username",
    "name",
    "feedtitle",
}
SENSITIVE_HEADERS = {"cookie", "authorization", "x-wx-token", "xweb_xhr"}
WECHAT_HOST_HINTS = (
    "channels.weixin.qq.com",
    "finder.video.qq.com",
    "wxapp.tc.qq.com",
    "weixin.qq.com",
    "qpic.cn",
    "qq.com",
)


def classify_url(url: str, content_type: str = "") -> Optional[str]:
    lower = url.lower()
    ctype = (content_type or "").lower()
    if ".m3u8" in lower or "application/vnd.apple.mpegurl" in ctype or "mpegurl" in ctype:
        return "hls"
    if ".flv" in lower or "video/x-flv" in ctype:
        return "live"
    if ".mp4" in lower or "video/mp4" in ctype:
        return "video"
    if ".m4s" in lower:
        return "fragment"
    return None


def is_wechat_related(url: str) -> bool:
    parsed = urlparse(url)
    host = parsed.netloc.lower()
    lower = url.lower()
    return any(hint in host for hint in WECHAT_HOST_HINTS) or "finder" in lower or "wechat" in lower or "weixin" in lower


def sanitize_headers(headers: Dict[str, str]) -> Dict[str, str]:
    cleaned: Dict[str, str] = {}
    for key, value in headers.items():
        lk = key.lower()
        if lk in SENSITIVE_HEADERS or "cookie" in lk or "token" in lk or "auth" in lk:
            continue
        if lk in {"user-agent", "referer", "origin", "accept", "accept-language", "range"}:
            cleaned[key] = value
    return cleaned


def safe_text(value: Any) -> Optional[str]:
    if value is None:
        return None
    if not isinstance(value, str):
        return None
    text = value.strip()
    if not text or len(text) > 180:
        return None
    if text.startswith("http://") or text.startswith("https://"):
        return None
    return text


def walk_json(value: Any) -> Iterable[tuple[str, Any]]:
    if isinstance(value, dict):
        for key, child in value.items():
            yield str(key), child
            yield from walk_json(child)
    elif isinstance(value, list):
        for child in value:
            yield from walk_json(child)


def extract_title_from_json(value: Any) -> Optional[str]:
    for key, child in walk_json(value):
        normalized = key.replace("_", "").lower()
        if normalized in TITLE_KEYS:
            text = safe_text(child)
            if text:
                return text
    return None


def extract_urls_from_text(text: str) -> List[str]:
    found: List[str] = []
    seen = set()
    for raw in URL_RE.findall(text):
        url = unquote(raw).rstrip("\\,.;)")
        if url in seen:
            continue
        seen.add(url)
        if classify_url(url) or is_wechat_related(url):
            found.append(url)
    return found


def parse_capture(
    request_url: str,
    request_headers: Dict[str, str],
    response_headers: Optional[Dict[str, str]] = None,
    response_text: str = "",
    status_code: int = 0,
) -> List[Dict[str, Any]]:
    response_headers = response_headers or {}
    content_type = response_headers.get("content-type") or response_headers.get("Content-Type") or ""
    candidates: List[str] = []

    direct_type = classify_url(request_url, content_type)
    if direct_type or is_wechat_related(request_url):
        candidates.append(request_url)

    if response_text:
        candidates.extend(extract_urls_from_text(response_text))

    title: Optional[str] = None
    if response_text:
        try:
            title = extract_title_from_json(json.loads(response_text))
        except Exception:
            title = None

    records: List[Dict[str, Any]] = []
    seen = set()
    for url in candidates:
        if url in seen:
            continue
        seen.add(url)
        media_type = classify_url(url, content_type)
        if not media_type and not is_wechat_related(url):
            continue
        if not media_type and not MEDIA_EXT_RE.search(url):
            continue
        record_id = hashlib.sha256(url.encode("utf-8")).hexdigest()[:16]
        parsed = urlparse(url)
        fallback_title = title or parsed.path.rsplit("/", 1)[-1] or parsed.netloc
        records.append(
            {
                "id": record_id,
                "url": url,
                "title": fallback_title[:180],
                "source": parsed.netloc,
                "media_type": media_type or "candidate",
                "status": "captured" if status_code < 400 else "http_error",
                "status_code": status_code,
                "captured_at": int(time.time()),
                "headers": sanitize_headers(request_headers),
            }
        )
    return records
