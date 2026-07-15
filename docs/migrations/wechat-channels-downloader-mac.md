# WeChat Channels Downloader Mac migration

Imported on 2026-07-15 from:

- repository: `Evander764/wechat-channels-downloader-mac`
- source HEAD: `681615b061752a3445bc86dfffc62da22ccd4a0b`
- destination: `apps/macos-downloader/`
- method: Git subtree with source history retained

## Safety ruling

The source app's proxy-capture path is historical and disabled by policy because it triggered WeChat account risk control. The parent repository's current flow remains authoritative:

1. copied WeChat Channels share link / SPH intake;
2. explicit current-window recording only when link-based acquisition is unavailable;
3. `npm run mac:listen` remains disabled;
4. no bypass of paid access, DRM, login, or platform protections.

This import preserves provenance and useful implementation history; it does not make the old proxy path supported again.
