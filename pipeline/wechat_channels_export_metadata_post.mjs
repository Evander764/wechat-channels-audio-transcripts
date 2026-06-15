import fs from 'node:fs/promises';
import path from 'node:path';

import {
  DEFAULT_OUTPUT_ROOT,
  ensureDir,
  readJson,
  safeFileName,
  writeCsv,
} from './wechat_transcript_common.mjs';

function parseArgs(argv) {
  const args = {
    baseUrl: process.env.WX_CHANNEL_BASE_URL || `http://127.0.0.1:${process.env.WX_CHANNEL_PORT || 2025}`,
    outputRoot: DEFAULT_OUTPUT_ROOT,
    accountsJson: '',
    maxPages: 300,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === '--base-url') {
      args.baseUrl = next;
      i += 1;
    } else if (arg === '--output-root') {
      args.outputRoot = next;
      i += 1;
    } else if (arg === '--accounts-json') {
      args.accountsJson = next;
      i += 1;
    } else if (arg === '--max-pages') {
      args.maxPages = Number(next || args.maxPages);
      i += 1;
    }
  }
  return args;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function cleanText(value) {
  return String(value ?? '')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

function firstNumber(...values) {
  for (const value of values) {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim() !== '' && !Number.isNaN(Number(value))) return Number(value);
  }
  return '';
}

function getDurationSeconds(media) {
  const spec0 = Array.isArray(media?.spec) ? media.spec[0] : null;
  const durationMs = firstNumber(spec0?.durationMs, media?.durationMs);
  if (durationMs !== '') return Math.round(durationMs / 1000);
  const playLen = firstNumber(media?.videoPlayLen, media?.duration);
  return playLen === '' ? '' : Math.round(playLen);
}

function getWidth(media) {
  const spec0 = Array.isArray(media?.spec) ? media.spec[0] : null;
  return firstNumber(media?.width, media?.mediaWidth, spec0?.width);
}

function getHeight(media) {
  const spec0 = Array.isArray(media?.spec) ? media.spec[0] : null;
  return firstNumber(media?.height, media?.mediaHeight, spec0?.height);
}

function getReportedFeedsCount(data) {
  return firstNumber(
    data?.contact?.feedsCount,
    data?.contact?.feedCount,
    data?.contact?.feed_count,
    data?.feedsCount,
    data?.feedCount,
  );
}

function profileURL(username) {
  return `https://channels.weixin.qq.com/web/pages/profile?username=${encodeURIComponent(username)}`;
}

function feedURL(objectId, nonceId) {
  return `https://channels.weixin.qq.com/web/pages/feed?objectId=${encodeURIComponent(objectId || '')}&objectNonceId=${encodeURIComponent(nonceId || '')}`;
}

function localDetailURL(baseUrl, objectId, nonceId) {
  return `${baseUrl}/api/channels/feed/profile?object_id=${encodeURIComponent(objectId || '')}&nonce_id=${encodeURIComponent(nonceId || '')}`;
}

function normalizeRow(baseUrl, account, item, page, index) {
  const objectDesc = item?.objectDesc || {};
  const media = Array.isArray(objectDesc.media) ? objectDesc.media[0] : null;
  const contact = item?.contact || {};
  const objectId = String(item?.id ?? item?.objectId ?? '');
  const nonceId = String(item?.objectNonceId ?? item?.nonce_id ?? '');
  const createTime = firstNumber(item?.createtime, item?.createTime);
  const mediaType = firstNumber(objectDesc?.mediaType, item?.mediaType);
  const mediaTypeLabel =
    mediaType === 4 ? 'video' :
    mediaType === 2 ? 'image' :
    mediaType === 9 ? 'article_or_other' :
    mediaType === '' ? '' : `media_type_${mediaType}`;

  return {
    account_name: account.name,
    account_username: account.username,
    account_profile_url: profileURL(account.username),
    contact_nickname: cleanText(contact.nickname || account.name),
    contact_username: String(contact.username || ''),
    object_id: objectId,
    object_nonce_id: nonceId,
    wechat_feed_url: feedURL(objectId, nonceId),
    local_detail_api_url: localDetailURL(baseUrl, objectId, nonceId),
    title: cleanText(objectDesc.description || item?.description || item?.title),
    create_time: createTime,
    create_time_iso: createTime === '' ? '' : new Date(createTime * 1000).toISOString(),
    media_type: mediaType,
    media_type_label: mediaTypeLabel,
    is_video: mediaType === 4,
    duration_seconds: mediaType === 4 ? getDurationSeconds(media) : '',
    width: getWidth(media),
    height: getHeight(media),
    file_size: firstNumber(media?.fileSize, media?.size),
    like_count: firstNumber(item?.likeCount, item?.like_count),
    favorite_count: firstNumber(item?.favCount, item?.favoriteCount, item?.fav_count),
    forward_count: firstNumber(item?.forwardCount, item?.forward_count),
    comment_count: firstNumber(item?.commentCount, item?.comment_count),
    read_count: firstNumber(item?.readCount, item?.read_count),
    friend_like_count: firstNumber(item?.friendLikeCount),
    ip_region: cleanText(item?.ipRegionInfo?.regionText || item?.ipRegionInfo?.region || ''),
    source_page: page,
    source_index: index,
    collected_at: new Date().toISOString(),
  };
}

async function requestFeedPage(baseUrl, account, nextMarker) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 70000);
  try {
    const response = await fetch(`${baseUrl}/api/channels/contact/feed/list`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: account.username, next_marker: nextMarker || '' }),
      signal: controller.signal,
    });
    const text = await response.text();
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      throw new Error(`HTTP ${response.status}: ${text.slice(0, 300)}`);
    }
    if (!response.ok || json.code !== 0) {
      throw new Error(`HTTP ${response.status}: ${json.message || text.slice(0, 300)}`);
    }
    if (json.data?.errCode && json.data.errCode !== 0) {
      throw new Error(`API ${json.data.errCode}: ${json.data.errMsg || 'unknown error'}`);
    }
    return json.data?.data || json.data || {};
  } finally {
    clearTimeout(timer);
  }
}

async function fetchPageWithRetry(baseUrl, account, marker, page) {
  let lastError;
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try {
      return await requestFeedPage(baseUrl, account, marker);
    } catch (error) {
      lastError = error;
      console.log(`[${account.slug}] page=${page} attempt=${attempt} failed: ${error.message}`);
      await sleep(1500 * attempt);
    }
  }
  throw lastError;
}

async function saveAccount(outDir, account, rows, meta, suffix = '') {
  const base = path.join(outDir, `${account.slug}.metadata${suffix}`);
  const payload = { meta, rows };
  await fs.writeFile(`${base}.json`, JSON.stringify(payload, null, 2), 'utf8');
  await writeCsv(`${base}.csv`, rows);
}

async function collectAccount(baseUrl, outDir, account, maxPages) {
  const seen = new Set();
  const rows = [];
  const pageStats = [];
  let marker = '';
  let reportedFeedsCount = '';
  let page = 0;

  while (page < maxPages) {
    page += 1;
    const data = await fetchPageWithRetry(baseUrl, account, marker, page);
    const items = Array.isArray(data.object) ? data.object : [];
    if (reportedFeedsCount === '') reportedFeedsCount = getReportedFeedsCount(data);

    let added = 0;
    items.forEach((item, index) => {
      const objectId = String(item?.id ?? item?.objectId ?? '');
      if (!objectId || seen.has(objectId)) return;
      seen.add(objectId);
      rows.push(normalizeRow(baseUrl, account, item, page, index + 1));
      added += 1;
    });

    const nextMarker = String(data.lastBuffer || '');
    pageStats.push({ page, items: items.length, added, total_unique: seen.size, has_next_marker: Boolean(nextMarker), next_marker_length: nextMarker.length });
    console.log(`[${account.slug}] page=${page} items=${items.length} added=${added} total=${seen.size} next=${nextMarker ? nextMarker.length : 0}`);

    marker = nextMarker;
    if (page % 10 === 0) {
      await saveAccount(outDir, account, rows, {
        account,
        reported_feeds_count: reportedFeedsCount,
        pages: page,
        collected_unique_count: rows.length,
        page_stats: pageStats,
        partial: true,
        partial_reason: 'checkpoint',
        saved_at: new Date().toISOString(),
      }, '.checkpoint');
    }
    if (!marker || items.length === 0) break;
  }

  const partial = page >= maxPages && Boolean(marker);
  const meta = {
    account,
    reported_feeds_count: reportedFeedsCount,
    pages: page,
    collected_unique_count: rows.length,
    video_count: rows.filter((row) => row.is_video).length,
    non_video_count: rows.filter((row) => !row.is_video).length,
    page_stats: pageStats,
    partial,
    partial_reason: partial ? `Stopped at safety page limit ${maxPages}.` : '',
    saved_at: new Date().toISOString(),
    note: 'Protected media direct URLs, tokens, and decode keys are intentionally excluded. Use object_id/object_nonce_id/page URLs for identification.',
  };
  await saveAccount(outDir, account, rows, meta);
  return { account, meta, rows };
}

async function loadAccounts(file) {
  if (!file) throw new Error('Pass --accounts-json or configure accounts in wechat.config.json.');
  const payload = await readJson(file);
  const accounts = Array.isArray(payload) ? payload : payload.accounts;
  if (!Array.isArray(accounts) || !accounts.length) throw new Error('accounts JSON must contain a non-empty accounts array');
  return accounts.map((account, index) => ({
    name: account.name || account.nickname || `account-${index + 1}`,
    slug: account.slug || safeFileName(account.name || `account-${index + 1}`).toLowerCase(),
    username: account.username,
  })).filter((account) => account.username);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const accounts = await loadAccounts(args.accountsJson);
  const timestamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+$/, '').replace('T', '_');
  const outDir = path.join(args.outputRoot, `wechat_channels_metadata_full_${timestamp}`);
  await ensureDir(outDir);
  console.log(`OUTPUT_DIR=${outDir}`);

  const results = [];
  for (const account of accounts) {
    results.push(await collectAccount(args.baseUrl, outDir, account, args.maxPages));
  }

  const allRows = results.flatMap((result) => result.rows);
  const videoRows = allRows.filter((row) => row.is_video);

  await fs.writeFile(path.join(outDir, 'all_accounts.metadata.json'), JSON.stringify({
    meta: {
      total_rows: allRows.length,
      video_rows: videoRows.length,
      accounts: results.map((result) => result.meta),
      saved_at: new Date().toISOString(),
      note: 'Protected media direct URLs, tokens, and decode keys are intentionally excluded.',
    },
    rows: allRows,
  }, null, 2), 'utf8');
  await writeCsv(path.join(outDir, 'all_accounts.metadata.csv'), allRows);

  const videosOnlyPath = path.join(outDir, 'all_accounts.videos_only.json');
  await fs.writeFile(videosOnlyPath, JSON.stringify({
    meta: {
      total_rows: videoRows.length,
      accounts: results.map((result) => ({
        name: result.account.name,
        username: result.account.username,
        video_count: result.rows.filter((row) => row.is_video).length,
      })),
      saved_at: new Date().toISOString(),
      note: 'Only rows with media_type=4 are included here.',
    },
    rows: videoRows,
  }, null, 2), 'utf8');
  await writeCsv(path.join(outDir, 'all_accounts.videos_only.csv'), videoRows);

  const summary = {
    output_dir: outDir,
    metadata_json: videosOnlyPath,
    total_rows: allRows.length,
    video_rows: videoRows.length,
    accounts: results.map((result) => ({
      account_name: result.account.name,
      account_username: result.account.username,
      reported_feeds_count: result.meta.reported_feeds_count,
      collected_unique_count: result.meta.collected_unique_count,
      video_count: result.meta.video_count,
      non_video_count: result.meta.non_video_count,
      pages: result.meta.pages,
      partial: result.meta.partial,
      partial_reason: result.meta.partial_reason,
    })),
    saved_at: new Date().toISOString(),
  };
  await fs.writeFile(path.join(outDir, 'summary.json'), JSON.stringify(summary, null, 2), 'utf8');
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error(`FATAL ${error.stack || error.message}`);
  process.exitCode = 1;
});
