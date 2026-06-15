const https = require('https');
const fs = require('fs');
const path = require('path');

const FEED_URLS = [
  'https://www.fof.dk/feeds/fof-djursland/feed.xml',
  'https://www.fof.dk/feeds/fof-herning/feed.xml',
  'https://www.fof.dk/feeds/fof-nordals/feed.xml',
  'https://www.fof.dk/feeds/fof-nordvestjylland/feed.xml',
  'https://www.fof.dk/feeds/fof-odder/feed.xml',
  'https://www.fof.dk/feeds/fof-randers-favrskov-mariagerfjord-viborg/feed.xml',
  'https://www.fof.dk/feeds/fof-sydjylland/feed.xml',
  'https://www.fof.dk/feeds/fof-sydoestjylland/feed.xml',
  'https://www.fof.dk/feeds/fof-soenderjylland/feed.xml',
  'https://www.fof.dk/feeds/fof-sydvestjylland/feed.xml',
  'https://www.fof.dk/feeds/fof-aalborg/feed.xml',
  'https://www.fof.dk/feeds/fof-aarhus/feed.xml',
  'https://www.fof.dk/feeds/fof-fyn-fredericia/feed.xml',
  'https://www.fof.dk/feeds/fof-oestfyn/feed.xml',
  'https://www.fof.dk/feeds/fof-koebenhavn-og-nordsjaelland/feed.xml',
  'https://www.fof.dk/feeds/fof-koebenhavns-omegn/feed.xml',
  'https://www.fof.dk/feeds/fof-koege-bugt/feed.xml',
  'https://www.fof.dk/feeds/fof-fjordlandet/feed.xml',
  'https://www.fof.dk/feeds/fof-syd-og-vestsjaelland/feed.xml',
  'https://www.fof.dk/feeds/fof-sydoest/feed.xml'
];

const OUTPUT_FILE = path.join(process.cwd(), 'fof-alle-skoler-feed.xml');
const LOG_DIR = path.join(process.cwd(), 'logs');
const LOG_RETENTION_DAYS = 60;

let currentLogFile = null;

function dateStamp(date) {
  return date.toISOString().slice(0, 10);
}

function appendLogLine(line) {
  if (!currentLogFile) {
    return;
  }

  try {
    fs.appendFileSync(currentLogFile, `${line}\n`, 'utf8');
  } catch (err) {
    console.error(`[WARN] Could not write to log file: ${err.message}`);
  }
}

function logInfo(message) {
  const line = `[${new Date().toISOString()}] ${message}`;
  console.log(message);
  appendLogLine(line);
}

function logError(message) {
  const line = `[${new Date().toISOString()}] ${message}`;
  console.error(message);
  appendLogLine(line);
}

function setupLogFile() {
  fs.mkdirSync(LOG_DIR, { recursive: true });
  currentLogFile = path.join(LOG_DIR, `feed-merge-${dateStamp(new Date())}.log`);
}

function cleanupOldLogs() {
  const cutoffTime = Date.now() - LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000;
  const entries = fs.readdirSync(LOG_DIR, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isFile()) {
      continue;
    }

    const match = entry.name.match(/^feed-merge-(\d{4}-\d{2}-\d{2})\.log$/);
    if (!match) {
      continue;
    }

    const fileTime = Date.parse(`${match[1]}T00:00:00.000Z`);
    if (Number.isNaN(fileTime)) {
      continue;
    }

    if (fileTime < cutoffTime) {
      fs.unlinkSync(path.join(LOG_DIR, entry.name));
    }
  }
}

function slugFromUrl(feedUrl) {
  try {
    const url = new URL(feedUrl);
    const parts = url.pathname.split('/').filter(Boolean);
    if (parts.length >= 2) {
      return decodeURIComponent(parts[parts.length - 2]);
    }
    return feedUrl;
  } catch {
    return feedUrl;
  }
}

function fetchXml(feedUrl, redirectCount = 0) {
  return new Promise((resolve, reject) => {
    const req = https.get(feedUrl, (res) => {
      const { statusCode, headers } = res;

      if (statusCode >= 300 && statusCode < 400 && headers.location) {
        if (redirectCount >= 5) {
          res.resume();
          reject(new Error('Too many redirects'));
          return;
        }

        const redirectedUrl = new URL(headers.location, feedUrl).toString();
        res.resume();
        fetchXml(redirectedUrl, redirectCount + 1).then(resolve).catch(reject);
        return;
      }

      if (statusCode !== 200) {
        res.resume();
        reject(new Error(`HTTP ${statusCode}`));
        return;
      }

      let data = '';
      res.setEncoding('utf8');

      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        resolve(data);
      });
    });

    req.on('error', (err) => {
      reject(err);
    });

    req.setTimeout(20000, () => {
      req.destroy(new Error('Request timed out'));
    });
  });
}

function extractItems(xml) {
  const matches = xml.match(/<item\b[\s\S]*?<\/item>/gi);
  return matches || [];
}

function buildMergedXml(items) {
  const itemSection = items.join('\n');

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss xmlns:g="http://base.google.com/ns/1.0" version="2.0">',
    '<channel>',
    '<title>FOF Alle skoler – Samlet produktfeed</title>',
    '<link>https://www.fof.dk</link>',
    '<description>Samlet Meta produktfeed med alle ledige hold fra alle FOF-skoler</description>',
    '<language>da-DK</language>',
    itemSection,
    '</channel>',
    '</rss>'
  ].join('\n');
}

async function mergeFeeds() {
  const allItems = [];
  let successCount = 0;

  setupLogFile();
  cleanupOldLogs();

  logInfo(`Starting merge of ${FEED_URLS.length} feeds...`);

  for (const feedUrl of FEED_URLS) {
    const slug = slugFromUrl(feedUrl);

    try {
      const xml = await fetchXml(feedUrl);
      const items = extractItems(xml);

      allItems.push(...items);
      successCount += 1;

      logInfo(`[OK] ${slug}: ${items.length} item(s)`);
    } catch (err) {
      logError(`[ERROR] ${slug}: ${err.message}`);
    }
  }

  const mergedXml = buildMergedXml(allItems);
  fs.writeFileSync(OUTPUT_FILE, mergedXml, 'utf8');

  logInfo('---');
  logInfo(`Successful feeds: ${successCount}/${FEED_URLS.length}`);
  logInfo(`Total merged items: ${allItems.length}`);
  logInfo(`Saved merged feed: ${OUTPUT_FILE}`);
  logInfo(`Saved run log: ${currentLogFile}`);
}

mergeFeeds().catch((err) => {
  logError(`[FATAL] ${err.message}`);
  process.exitCode = 1;
});
