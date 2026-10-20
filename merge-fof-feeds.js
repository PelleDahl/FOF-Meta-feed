const https = require('https');
const fs = require('fs');
const path = require('path');

const FEED_URLS = [
  'https://www.fof.dk/feeds/fof-djursland/feed.xml',
  'https://www.fof.dk/feeds/fof-herning/feed.xml',
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
  'https://www.fof.dk/feeds/fof-syd-og-vestsjaelland/feed.xml',
  'https://www.fof.dk/feeds/fof-sydoest/feed.xml'
];

const SCHOOL_CODES = {
  'fof-djursland': 'DJU',
  'fof-herning': 'HER',
  'fof-nordvestjylland': 'NVJ',
  'fof-odder': 'ODD',
  'fof-randers-favrskov-mariagerfjord-viborg': 'RFMV',
  'fof-sydjylland': 'SJY',
  'fof-sydoestjylland': 'SOJ',
  'fof-soenderjylland': 'SDJ',
  'fof-sydvestjylland': 'SVJ',
  'fof-aalborg': 'AAL',
  'fof-aarhus': 'AAR',
  'fof-fyn-fredericia': 'FYN',
  'fof-oestfyn': 'OFY',
  'fof-koebenhavn-og-nordsjaelland': 'KBH',
  'fof-koebenhavns-omegn': 'KBO',
  'fof-koege-bugt': 'KOE',
  'fof-syd-og-vestsjaelland': 'SVS',
  'fof-sydoest': 'SYO'
};

// Skoler hvor <g:image_link> erstattes med kursussidens og:image (metabillede) i stedet for herobilledet.
const OG_IMAGE_SCHOOLS = new Set(FEED_URLS.map(slugFromUrl));

// Skoler hvor holdets tags hentes fra FOF's Azure AI Search-indeks og lægges i <g:custom_label_3> og <g:internal_label>.
// Kræver miljøvariablen AZURE_SEARCH_API_KEY (query-nøgle). Mangler den, springes tags over.
const TAG_SCHOOLS = new Set(['fof-koebenhavn-og-nordsjaelland']);
const AZURE_SEARCH_ENDPOINT = 'https://fof-ai-search.search.windows.net';
const AZURE_SEARCH_API_VERSION = '2024-05-01-preview';
const AZURE_COURSES_INDEX = 'fof-courses-production';
const AZURE_TAGS_INDEX = 'fof-external-production';

// Skoler hvis items bygges direkte fra søgeindekset (fof-courses-production) i stedet for fof.dk's natlige feed.
// fof.dk's feed mangler ca. 25 % af de ledige hold (se docs/fejlrapport-fof-feeds.md).
// Fejler opslaget i indekset, falder scriptet tilbage til fof.dk's feed for skolen.
const INDEX_SOURCE_SCHOOLS = new Set(FEED_URLS.map(slugFromUrl));
const PUBLIC_SITE_URL = 'https://www.fof.dk';
const FEED_MONTHS_AHEAD = 12;

const OUTPUT_FILE = path.join(process.cwd(), 'fof-alle-skoler-feed.xml');

// Skoler der hentes (f.eks. til deres eget feed), men ikke tages med i det samlede feed.
// KBH er holdt ude, indtil skolen aktivt har sagt ja til at indgå i det samlede feed.
const EXCLUDED_FROM_MERGED = new Set(['fof-koebenhavn-og-nordsjaelland']);

// Skoler der også får deres eget feed ved siden af det samlede feed (samme items som i det samlede feed).
const SCHOOL_FEEDS = {
  'fof-koebenhavn-og-nordsjaelland': {
    file: 'fof-koebenhavn-og-nordsjaelland-feed.xml',
    title: 'FOF København og Nordsjælland – Produktfeed',
    link: 'https://www.fof.dk/fof-koebenhavn-og-nordsjaelland',
    description: 'Meta produktfeed med alle ledige hold fra FOF København og Nordsjælland'
  }
};
const OG_IMAGE_CACHE_FILE = path.join(process.cwd(), 'og-image-cache.json');
const OG_IMAGE_CACHE_MAX_AGE_DAYS = 7;
const OG_IMAGE_FETCH_CONCURRENCY = 8;
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

function fetchText(feedUrl, redirectCount = 0) {
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
        fetchText(redirectedUrl, redirectCount + 1).then(resolve).catch(reject);
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

function decodeXmlEntities(value) {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

function escapeXml(value) {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Percent-encoder ikke-ASCII-tegn (f.eks. á, é, æ) i stien. Uencodede specialtegn giver HTTP 500 fra fof.dk/media.
// new URL() lader allerede encodede tegn være, så funktionen kan køres flere gange.
function normalizeImageUrl(rawUrl) {
  try {
    return new URL(rawUrl.trim()).href;
  } catch {
    return rawUrl.trim();
  }
}

function encodeImageLinks(items) {
  return items.map((item) =>
    item.replace(/(<g:image_link>)([\s\S]*?)(<\/g:image_link>)/i, (match, open, url, close) =>
      `${open}${escapeXml(normalizeImageUrl(decodeXmlEntities(url)))}${close}`
    )
  );
}

// og:image på fof.dk peger på Next.js' billedproxy (/_next/image?url=/media/...). Vi bruger den underliggende /media-URL.
function extractOgImage(html, pageUrl) {
  const tag = html.match(/<meta\b[^>]*property=["']og:image["'][^>]*>/i);
  if (!tag) {
    return null;
  }

  const content = tag[0].match(/content=["']([^"']+)["']/i);
  if (!content) {
    return null;
  }

  try {
    const ogUrl = new URL(decodeXmlEntities(content[1]), pageUrl);
    if (ogUrl.pathname === '/_next/image' && ogUrl.searchParams.get('url')) {
      return new URL(ogUrl.searchParams.get('url'), ogUrl.origin).href;
    }
    return ogUrl.href;
  } catch {
    return null;
  }
}

function itemPageUrl(item) {
  const match = item.match(/<g:link>([\s\S]*?)<\/g:link>/i);
  if (!match) {
    return null;
  }

  try {
    const url = new URL(decodeXmlEntities(match[1].trim()));
    url.search = '';
    url.hash = '';
    return url.href;
  } catch {
    return null;
  }
}

function loadOgImageCache() {
  try {
    return JSON.parse(fs.readFileSync(OG_IMAGE_CACHE_FILE, 'utf8'));
  } catch {
    return {};
  }
}

function saveOgImageCache(cache) {
  const sorted = Object.fromEntries(Object.keys(cache).sort().map((key) => [key, cache[key]]));
  fs.writeFileSync(OG_IMAGE_CACHE_FILE, `${JSON.stringify(sorted, null, 2)}\n`, 'utf8');
}

async function runWithConcurrency(tasks, limit) {
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, tasks.length) }, async () => {
    while (next < tasks.length) {
      const task = tasks[next];
      next += 1;
      await task();
    }
  });
  await Promise.all(workers);
}

// Henter og:image for hver unik kursusside (cachet i OG_IMAGE_CACHE_MAX_AGE_DAYS) og sætter det som <g:image_link>.
// Fejler hentningen, bruges seneste cachede værdi, og ellers beholdes feedets herobillede.
async function applyOgImages(items, slug, cache, seenPages) {
  const maxAgeMs = OG_IMAGE_CACHE_MAX_AGE_DAYS * 24 * 60 * 60 * 1000;
  const pageUrls = [...new Set(items.map(itemPageUrl).filter(Boolean))];
  const stalePages = pageUrls.filter((pageUrl) => {
    const entry = cache[pageUrl];
    return !entry || Date.now() - Date.parse(entry.fetchedAt) > maxAgeMs;
  });

  let fetchErrors = 0;
  await runWithConcurrency(
    stalePages.map((pageUrl) => async () => {
      try {
        const ogImage = extractOgImage(await fetchText(pageUrl), pageUrl);
        cache[pageUrl] = { ogImage, fetchedAt: new Date().toISOString() };
      } catch (err) {
        fetchErrors += 1;
        logError(`[WARN] ${slug}: og:image could not be fetched for ${pageUrl}: ${err.message}`);
      }
    }),
    OG_IMAGE_FETCH_CONCURRENCY
  );

  let replaced = 0;
  const result = items.map((item) => {
    const pageUrl = itemPageUrl(item);
    if (!pageUrl) {
      return item;
    }

    seenPages.add(pageUrl);
    const ogImage = cache[pageUrl] && cache[pageUrl].ogImage;
    if (!ogImage) {
      return item;
    }

    replaced += 1;
    return item.replace(/(<g:image_link>)[\s\S]*?(<\/g:image_link>)/i, (match, open, close) => `${open}${escapeXml(ogImage)}${close}`);
  });

  logInfo(
    `[OG] ${slug}: ${pageUrls.length} page(s), ${stalePages.length} fetched, ${fetchErrors} error(s), og:image used on ${replaced}/${items.length} item(s)`
  );
  return result;
}

function postJson(url, headers, body) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const req = https.request(
      url,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload), ...headers }
      },
      (res) => {
        let data = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () => {
          if (res.statusCode !== 200) {
            reject(new Error(`HTTP ${res.statusCode}: ${data.slice(0, 200)}`));
            return;
          }
          try {
            resolve(JSON.parse(data));
          } catch (err) {
            reject(err);
          }
        });
      }
    );

    req.on('error', reject);
    req.setTimeout(30000, () => {
      req.destroy(new Error('Request timed out'));
    });
    req.end(payload);
  });
}

async function searchAll(index, query) {
  const url = `${AZURE_SEARCH_ENDPOINT}/indexes/${index}/docs/search?api-version=${AZURE_SEARCH_API_VERSION}`;
  const headers = { 'api-key': process.env.AZURE_SEARCH_API_KEY };
  const pageSize = 1000;
  const docs = [];

  for (let skip = 0; ; skip += pageSize) {
    const result = await postJson(url, headers, { search: '*', top: pageSize, skip, ...query });
    docs.push(...result.value);
    if (result.value.length < pageSize) {
      return docs;
    }
  }
}

// Tag-navne ligger som 'tag'-noder i Umbracos indeks (fof-external-production); holdene peger på dem via tagIds (= x__Key).
async function loadTagNames() {
  const docs = await searchAll(AZURE_TAGS_INDEX, {
    filter: "x__NodeTypeAlias eq 'tag'",
    select: 'x__Key,nodeName'
  });
  const names = new Map();
  for (const doc of docs) {
    const name = Array.isArray(doc.nodeName) ? doc.nodeName[0] : doc.nodeName;
    if (doc.x__Key && name) {
      names.set(doc.x__Key, name.trim());
    }
  }
  return names;
}

// Returnerer holdnummer → liste af tag-navne for én skole.
async function loadSchoolTags(slug, tagNames) {
  const docs = await searchAll(AZURE_COURSES_INDEX, {
    filter: `associationSlug eq '${slug}' and docType eq 'courseVariant'`,
    select: 'variantCourseNo,tagIds'
  });
  const tagsByHoldnr = new Map();
  for (const doc of docs) {
    const names = (doc.tagIds || []).map((id) => tagNames.get(id)).filter(Boolean);
    if (doc.variantCourseNo && names.length > 0) {
      tagsByHoldnr.set(String(doc.variantCourseNo).trim(), [...new Set(names)]);
    }
  }
  return tagsByHoldnr;
}

// Taksonomi-noder i Umbracos indeks: route-sti (f.eks. /emnestruktur/kurser/sprog/italiensk/) → navne fra roden
// (['Kurser', 'Sprog', 'Italiensk']). Svarer til buildTaxonomyLookup i fof.dk's egen feed-generator.
async function loadTaxonomyLookup() {
  const docs = await searchAll(AZURE_TAGS_INDEX, {
    filter: "x__NodeTypeAlias eq 'taxonomy'",
    select: 'x__NodeId,x__Path,nodeName,urlName'
  });
  const byId = new Map(docs.map((doc) => [doc.x__NodeId, doc]));
  const lookup = new Map();

  for (const doc of docs) {
    const chain = doc.x__Path
      .split(',')
      .map((id) => byId.get(id))
      .filter(Boolean);
    const names = chain.map((node) => String(Array.isArray(node.nodeName) ? node.nodeName[0] : node.nodeName).trim());
    const routePath = `/emnestruktur/${chain.map((node) => node.urlName).join('/')}/`;
    lookup.set(routePath, names);
  }
  return lookup;
}

function cdata(value) {
  return `<![CDATA[${String(value || '').replace(/]]>/g, ']]&gt;')}]]>`;
}

// Prisen i feedet: pristypen ALMEN, ellers skolens standardpris, ellers første pris. Hold uden nogen pris
// (f.eks. aflyst i ASA, men ikke slettet i Umbraco) udelades.
function normalPrice(doc) {
  const prices = (doc.prices || []).filter((price) => typeof price.price === 'number');
  const chosen =
    prices.find((price) => String(price.type || '').trim().toUpperCase() === 'ALMEN') ||
    prices.find((price) => price.standard) ||
    prices[0];
  return chosen ? chosen.price : null;
}

// Bygger <item>-elementer for én skole direkte fra fof-courses-production med samme felter som fof.dk's generator.
// Medtager kun kommende, offentlige hold med ledige pladser og en pris, der starter inden for FEED_MONTHS_AHEAD måneder.
async function buildItemsFromIndex(slug, taxonomyLookup) {
  const docs = await searchAll(AZURE_COURSES_INDEX, {
    filter: `associationSlug eq '${slug}' and docType eq 'courseVariant'`,
    select:
      'variantCourseNo,variantCourseName,name,description,bodyText,courseSlug,imageUrl,prices,price,' +
      'availableSeats,soldOut,variantStartDate,isPublic,taxonomyPaths,associationName'
  });

  const now = new Date();
  const futureLimit = new Date(now);
  futureLimit.setMonth(futureLimit.getMonth() + FEED_MONTHS_AHEAD);
  const seen = new Set();

  const variants = docs
    .filter((doc) => {
      const start = doc.variantStartDate ? new Date(doc.variantStartDate) : null;
      if (!doc.variantCourseNo || seen.has(doc.variantCourseNo)) {
        return false;
      }
      const include =
        doc.isPublic !== false &&
        !doc.soldOut &&
        doc.availableSeats > 0 &&
        normalPrice(doc) !== null &&
        start !== null &&
        start > now &&
        start <= futureLimit;
      if (include) {
        seen.add(doc.variantCourseNo);
      }
      return include;
    })
    .sort((a, b) => new Date(a.variantStartDate) - new Date(b.variantStartDate));

  return variants.map((doc) => {
    // Hold ligger under flere kategorier (blad + forældre); den længste sti er bladet.
    const taxonomyPath = (doc.taxonomyPaths || [])
      .map((routePath) => taxonomyLookup.get(routePath) || [])
      .reduce((longest, names) => (names.length > longest.length ? names : longest), []);
    const link = `${PUBLIC_SITE_URL}/aftenskolen/${slug}/${doc.courseSlug}?holdnr=${doc.variantCourseNo}`;
    const imageLink = doc.imageUrl ? `${PUBLIC_SITE_URL}${doc.imageUrl}?width=1200` : '';
    const description = doc.description || (doc.bodyText || '').slice(0, 5000);

    return [
      '<item>',
      `      <g:id>${escapeXml(doc.variantCourseNo)}</g:id>`,
      `      <g:title>${cdata(doc.variantCourseName || doc.name)}</g:title>`,
      `      <g:description>${cdata(description)}</g:description>`,
      `      <g:link>${escapeXml(link)}</g:link>`,
      `      <g:image_link>${escapeXml(imageLink)}</g:image_link>`,
      '      <g:availability>in_stock</g:availability>',
      '      <g:quantity>1</g:quantity>',
      `      <g:price>${normalPrice(doc).toFixed(2)} DKK</g:price>`,
      '      <g:condition>new</g:condition>',
      `      <g:brand>${escapeXml(doc.associationName || '')}</g:brand>`,
      '      <g:google_product_category>Education</g:google_product_category>',
      '      <g:fb_product_category>Education</g:fb_product_category>',
      `      <g:product_type>${escapeXml(taxonomyPath.join(' > '))}</g:product_type>`,
      `      <g:custom_label_0>${escapeXml(taxonomyPath[0] || '')}</g:custom_label_0>`,
      `      <g:custom_label_1>${escapeXml(taxonomyPath[1] || '')}</g:custom_label_1>`,
      `      <g:custom_label_2>${escapeXml(taxonomyPath[2] || '')}</g:custom_label_2>`,
      `      <g:start_date>${new Date(doc.variantStartDate).toISOString()}</g:start_date>`,
      '    </item>'
    ].join('\n');
  });
}

// custom_label_3: kommasepareret (maks. 100 tegn, Google/Meta-grænse) til produktsæt og rapportering.
// internal_label: Metas liste-format til filtrering af produktsæt.
function applyTags(items, slug, tagsByHoldnr) {
  let tagged = 0;
  const result = items.map((item) => {
    const idMatch = item.match(/<g:id>([\s\S]*?)<\/g:id>/i);
    const tags = idMatch && tagsByHoldnr.get(idMatch[1].trim());
    if (!tags) {
      return item;
    }

    tagged += 1;
    let label = '';
    for (const tag of tags) {
      const next = label ? `${label}, ${tag}` : tag;
      if (next.length > 100) {
        break;
      }
      label = next;
    }
    const internalLabel = `[${tags.map((tag) => `'${tag.replace(/'/g, '')}'`).join(',')}]`;

    return item.replace(
      /(\s*)<\/item>\s*$/i,
      `\n      <g:custom_label_3>${escapeXml(label)}</g:custom_label_3>` +
        `\n      <g:internal_label>${escapeXml(internalLabel)}</g:internal_label>$1</item>`
    );
  });

  logInfo(`[TAGS] ${slug}: tags added to ${tagged}/${items.length} item(s)`);
  return result;
}

function prefixItemIds(items, slug) {
  return items.map((item) =>
    item.replace(/(<g:id>)([\s\S]*?)(<\/g:id>)/i, (match, open, id, close) => `${open}${slug}-${id.trim()}${close}`)
  );
}

const MERGED_FEED_META = {
  title: 'FOF Alle skoler – Samlet produktfeed',
  link: 'https://www.fof.dk',
  description: 'Samlet Meta produktfeed med alle ledige hold fra alle FOF-skoler'
};

function buildFeedXml(items, meta) {
  const itemSection = items.join('\n');

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss xmlns:g="http://base.google.com/ns/1.0" version="2.0">',
    '<channel>',
    `<title>${escapeXml(meta.title)}</title>`,
    `<link>${escapeXml(meta.link)}</link>`,
    `<description>${escapeXml(meta.description)}</description>`,
    '<language>da-DK</language>',
    itemSection,
    '</channel>',
    '</rss>'
  ].join('\n');
}

async function mergeFeeds() {
  const allItems = [];
  let successCount = 0;
  const ogImageCache = loadOgImageCache();
  const seenOgPages = new Set();
  const failedOgSchools = new Set();
  let tagNames = null;
  let taxonomyLookup = null;

  setupLogFile();
  cleanupOldLogs();

  logInfo(`Starting merge of ${FEED_URLS.length} feeds...`);

  for (const feedUrl of FEED_URLS) {
    const slug = slugFromUrl(feedUrl);
    const code = SCHOOL_CODES[slug] || slug;

    try {
      let items = null;

      if (INDEX_SOURCE_SCHOOLS.has(slug)) {
        if (!process.env.AZURE_SEARCH_API_KEY) {
          logError(`[WARN] ${slug}: AZURE_SEARCH_API_KEY is not set – falling back to fof.dk feed`);
        } else {
          try {
            taxonomyLookup = taxonomyLookup || (await loadTaxonomyLookup());
            items = await buildItemsFromIndex(slug, taxonomyLookup);
            logInfo(`[INDEX] ${slug}: ${items.length} item(s) built from ${AZURE_COURSES_INDEX}`);
          } catch (err) {
            logError(`[WARN] ${slug}: could not build items from search index – falling back to fof.dk feed: ${err.message}`);
          }
        }
      }

      if (!items) {
        items = extractItems(await fetchText(feedUrl));
      }

      if (OG_IMAGE_SCHOOLS.has(slug)) {
        items = await applyOgImages(items, slug, ogImageCache, seenOgPages);
      }

      if (TAG_SCHOOLS.has(slug)) {
        if (!process.env.AZURE_SEARCH_API_KEY) {
          logError(`[WARN] ${slug}: AZURE_SEARCH_API_KEY is not set – skipping tags`);
        } else {
          try {
            tagNames = tagNames || (await loadTagNames());
            items = applyTags(items, slug, await loadSchoolTags(slug, tagNames));
          } catch (err) {
            logError(`[WARN] ${slug}: tags could not be loaded from Azure Search – skipping tags: ${err.message}`);
          }
        }
      }

      items = encodeImageLinks(items);

      // Skolens eget feed beholder de rå holdnumre som <g:id>, så de matcher holdnummeret i pixel-events.
      const schoolFeed = SCHOOL_FEEDS[slug];
      if (schoolFeed) {
        const schoolFile = path.join(process.cwd(), schoolFeed.file);
        fs.writeFileSync(schoolFile, buildFeedXml(items, schoolFeed), 'utf8');
        logInfo(`[OK] ${slug}: saved school feed ${schoolFile}`);
      }

      successCount += 1;

      if (EXCLUDED_FROM_MERGED.has(slug)) {
        logInfo(`[OK] ${slug}: ${items.length} item(s) – excluded from merged feed`);
        continue;
      }

      items = prefixItemIds(items, code);
      allItems.push(...items);

      logInfo(`[OK] ${slug}: ${items.length} item(s)`);
    } catch (err) {
      if (OG_IMAGE_SCHOOLS.has(slug)) {
        failedOgSchools.add(slug);
      }
      logError(`[ERROR] ${slug}: ${err.message}`);
    }
  }

  // Ryd cachede kursussider, der ikke længere er i feedet – men kun hvis alle og:image-skoler blev hentet.
  if (failedOgSchools.size === 0) {
    for (const pageUrl of Object.keys(ogImageCache)) {
      if (!seenOgPages.has(pageUrl)) {
        delete ogImageCache[pageUrl];
      }
    }
  }
  saveOgImageCache(ogImageCache);

  const mergedXml = buildFeedXml(allItems, MERGED_FEED_META);
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
