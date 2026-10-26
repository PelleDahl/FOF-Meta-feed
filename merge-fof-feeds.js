const https = require('https');
const fs = require('fs');
const path = require('path');

// Alle skoler i feedet (slug → kort kode, der bruges som præfiks på <g:id>, f.eks. AAR-264364; se UNPREFIXED_ID_SCHOOLS).
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

const SCHOOLS = Object.keys(SCHOOL_CODES);

// Skoler hvor <g:image_link> erstattes med kursussidens og:image (metabillede) i stedet for herobilledet.
const OG_IMAGE_SCHOOLS = new Set(SCHOOLS);

// Skoler hvor holdets tags hentes fra FOF's Azure AI Search-indeks og lægges i <g:custom_label_3> og <g:internal_label>.
const TAG_SCHOOLS = new Set(SCHOOLS);
const AZURE_SEARCH_ENDPOINT = 'https://fof-ai-search.search.windows.net';
const AZURE_SEARCH_API_VERSION = '2024-05-01-preview';
const AZURE_COURSES_INDEX = 'fof-courses-production';
const AZURE_TAGS_INDEX = 'fof-external-production';

const PUBLIC_SITE_URL = 'https://www.fof.dk';
const FEED_MONTHS_AHEAD = 12;

const OUTPUT_FILE = path.join(process.cwd(), 'fof-alle-skoler-feed.xml');

// Skoler der hentes (f.eks. til deres eget feed), men ikke tages med i det samlede feed.
const EXCLUDED_FROM_MERGED = new Set();

// Hver skole får sit eget feed (<slug>-feed.xml) ved siden af det samlede feed, f.eks. til skolens egen shop/katalog i Meta.
const SCHOOL_FEED_SCHOOLS = new Set(SCHOOLS);

// <g:id> er holdnummeret med skolens kode som præfiks (f.eks. AAR-264364) – samme format som pixlen sender via GTM.
// Skolerne her bruger det rå holdnummer uden præfiks. Formatet er det samme i skolefeeds og i det samlede feed.
const UNPREFIXED_ID_SCHOOLS = new Set(['fof-koebenhavn-og-nordsjaelland']);

function schoolFeedMeta(slug, items) {
  const brandMatch = items.map((item) => item.match(/<g:brand>([\s\S]*?)<\/g:brand>/i)).find(Boolean);
  const name = brandMatch ? decodeXmlEntities(brandMatch[1].trim()) : slug;
  return {
    file: `${slug}-feed.xml`,
    title: `${name} – Produktfeed`,
    link: `${PUBLIC_SITE_URL}/${slug}`,
    description: `Meta produktfeed med alle ledige hold fra ${name}`
  };
}
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

// Tag-mapping (tag-mapping.csv, vedligeholdes manuelt): pr. tag-id en type og et ensrettet navn,
// f.eks. 'hold køge' → sted: Køge. Tags af disse typer kommer ikke med i feedet.
const TAG_MAPPING_FILE = path.join(__dirname, 'tag-mapping.csv');
const EXCLUDED_TAG_TYPES = new Set(['intern', 'underviser']);

function parseCsvLine(line, delimiter) {
  const fields = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (quoted) {
      if (char === '"' && line[i + 1] === '"') {
        field += '"';
        i += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === delimiter) {
      fields.push(field);
      field = '';
    } else {
      field += char;
    }
  }
  fields.push(field);
  return fields;
}

function loadTagMapping() {
  const lines = fs.readFileSync(TAG_MAPPING_FILE, 'utf8').replace(/^\uFEFF/, '').split(/\r?\n/).filter(Boolean);
  const header = parseCsvLine(lines[0], ';');
  const mapping = new Map();
  for (const line of lines.slice(1)) {
    const row = Object.fromEntries(parseCsvLine(line, ';').map((value, i) => [header[i], value.trim()]));
    if (row.tag_id) {
      mapping.set(row.tag_id, { type: row.type.toLowerCase(), name: row.normaliseret || row.tag });
    }
  }
  return mapping;
}

// Tag-noderne ligger i Umbracos indeks (fof-external-production); holdene peger på dem via tagIds (= x__Key).
// Returnerer tag-id → { type, name }. Tags, der ikke står i tag-mapping.csv, får typen 'ukendt' og deres Umbraco-navn.
async function loadTagLookup() {
  const mapping = loadTagMapping();
  const docs = await searchAll(AZURE_TAGS_INDEX, {
    filter: "x__NodeTypeAlias eq 'tag'",
    select: 'x__Key,nodeName'
  });
  const lookup = new Map();
  for (const doc of docs) {
    const name = String((Array.isArray(doc.nodeName) ? doc.nodeName[0] : doc.nodeName) || '').trim();
    if (doc.x__Key && name) {
      lookup.set(doc.x__Key, mapping.get(doc.x__Key) || { type: 'ukendt', name, unmapped: true });
    }
  }
  logInfo(`[TAGS] ${lookup.size} tag(s) loaded, ${mapping.size} in tag-mapping.csv`);
  return lookup;
}

// Returnerer holdnummer → { tags, district } for én skole: tag-navne (ensrettede, uden dubletter, i Umbracos
// rækkefølge) og holdets postdistrikt fra indekset (f.eks. 'København K').
async function loadSchoolTags(slug, tagLookup) {
  const docs = await searchAll(AZURE_COURSES_INDEX, {
    filter: `associationSlug eq '${slug}' and docType eq 'courseVariant'`,
    select: 'variantCourseNo,tagIds,cities'
  });
  const tagsByHoldnr = new Map();
  const unmapped = new Set();
  for (const doc of docs) {
    const tags = (doc.tagIds || []).map((id) => tagLookup.get(id)).filter(Boolean);
    tags.filter((tag) => tag.unmapped).forEach((tag) => unmapped.add(tag.name));
    const names = [...new Set(tags.filter((tag) => !EXCLUDED_TAG_TYPES.has(tag.type)).map((tag) => tag.name))];
    const district = holdDistrict(doc);
    if (doc.variantCourseNo && (names.length > 0 || district)) {
      tagsByHoldnr.set(String(doc.variantCourseNo).trim(), { tags: names, district });
    }
  }
  if (unmapped.size > 0) {
    logInfo(`[TAGS] ${slug}: ${unmapped.size} tag(s) not in tag-mapping.csv: ${[...unmapped].join(', ')}`);
  }
  return tagsByHoldnr;
}

// custom_label_3: holdets første tag (én værdi, maks. 100 tegn). custom_label_4 er byen (sættes i buildItemsFromIndex).
// internal_label: alle holdets tags plus postdistriktet i Metas listeformat, til filtrering af produktsæt.
function applyTags(items, slug, tagsByHoldnr) {
  let tagged = 0;
  const result = items.map((item) => {
    const idMatch = item.match(/<g:id>([\s\S]*?)<\/g:id>/i);
    const entry = idMatch && tagsByHoldnr.get(idMatch[1].trim());
    if (!entry) {
      return item;
    }

    if (entry.tags.length > 0) {
      tagged += 1;
    }
    const labels =
      entry.tags.length > 0 ? `\n      <g:custom_label_3>${escapeXml(entry.tags[0].slice(0, 100))}</g:custom_label_3>` : '';
    const all = [...new Set([...entry.tags, entry.district].filter(Boolean))];
    const internalLabel = `[${all.map((label) => `'${label.replace(/'/g, '')}'`).join(',')}]`;

    return item.replace(
      /(\s*)<\/item>\s*$/i,
      `${labels}\n      <g:internal_label>${escapeXml(internalLabel)}</g:internal_label>$1</item>`
    );
  });

  logInfo(`[TAGS] ${slug}: tags added to ${tagged}/${items.length} item(s)`);
  return result;
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

// Holdets postdistrikt fra indekset, f.eks. 'København K' eller 'Aarhus C'. Næsten alle hold har præcis én by.
function holdDistrict(doc) {
  return String((doc.cities || [])[0] || '').trim();
}

// Bynavn uden postdistrikt-endelse: 'København K' → 'København', 'Aalborg SV' → 'Aalborg'. Bruges i custom_label_4,
// så et produktsæt for en by er ét filter; selve distriktet ligger i internal_label.
function cityName(district) {
  return district.replace(/\s+(C|K|M|N|S|V|Ø|NV|NØ|SV|SØ)$/u, '');
}

// Bygger <item>-elementer for én skole direkte fra fof-courses-production med samme felter som fof.dk's generator.
// Medtager kun kommende, offentlige hold med ledige pladser og en pris, der starter inden for FEED_MONTHS_AHEAD måneder.
async function buildItemsFromIndex(slug, taxonomyLookup) {
  const docs = await searchAll(AZURE_COURSES_INDEX, {
    filter: `associationSlug eq '${slug}' and docType eq 'courseVariant'`,
    select:
      'variantCourseNo,variantCourseName,name,description,bodyText,courseSlug,imageUrl,prices,price,' +
      'availableSeats,soldOut,variantStartDate,isPublic,taxonomyPaths,associationName,cities'
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
      `      <g:custom_label_4>${escapeXml(cityName(holdDistrict(doc)))}</g:custom_label_4>`,
      `      <g:start_date>${new Date(doc.variantStartDate).toISOString()}</g:start_date>`,
      '    </item>'
    ].join('\n');
  });
}

// Sætter skolens kode foran holdnummeret i <g:id>, undtagen for skolerne i UNPREFIXED_ID_SCHOOLS.
function applyItemIds(items, slug) {
  if (UNPREFIXED_ID_SCHOOLS.has(slug)) {
    return items;
  }
  return items.map((item) =>
    item.replace(/(<g:id>)([\s\S]*?)(<\/g:id>)/i, (match, open, id, close) => `${open}${SCHOOL_CODES[slug]}-${id.trim()}${close}`)
  );
}

// Sikkerhedsnet for det samlede feed: dubletter i <g:id> giver fejl i Meta, så et id, der allerede er brugt, udelades og logges.
function withoutDuplicateIds(items, usedIds, slug) {
  return items.filter((item) => {
    const match = item.match(/<g:id>([\s\S]*?)<\/g:id>/i);
    const id = match ? match[1].trim() : '';
    if (usedIds.has(id)) {
      logError(`[WARN] ${slug}: id ${id} already used in merged feed – item skipped`);
      return false;
    }
    usedIds.add(id);
    return true;
  });
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
  const usedIds = new Set();
  let successCount = 0;
  const ogImageCache = loadOgImageCache();
  const seenOgPages = new Set();
  const failedSchools = new Set();

  setupLogFile();
  cleanupOldLogs();

  if (!process.env.AZURE_SEARCH_API_KEY) {
    logError('[FATAL] AZURE_SEARCH_API_KEY is not set – no feeds written, existing feeds are kept');
    process.exitCode = 1;
    return;
  }

  logInfo(`Building feeds for ${SCHOOLS.length} schools from ${AZURE_COURSES_INDEX}...`);
  const taxonomyLookup = await loadTaxonomyLookup();
  const tagLookup = await loadTagLookup();

  for (const slug of SCHOOLS) {
    try {
      let items = await buildItemsFromIndex(slug, taxonomyLookup);
      logInfo(`[INDEX] ${slug}: ${items.length} item(s) built from ${AZURE_COURSES_INDEX}`);

      if (OG_IMAGE_SCHOOLS.has(slug)) {
        items = await applyOgImages(items, slug, ogImageCache, seenOgPages);
      }

      if (TAG_SCHOOLS.has(slug)) {
        items = applyTags(items, slug, await loadSchoolTags(slug, tagLookup));
      }

      // Id-formatet sættes til sidst, fordi tags og by matches på det rå holdnummer.
      items = applyItemIds(encodeImageLinks(items), slug);

      if (SCHOOL_FEED_SCHOOLS.has(slug)) {
        const schoolFeed = schoolFeedMeta(slug, items);
        const schoolFile = path.join(process.cwd(), schoolFeed.file);
        fs.writeFileSync(schoolFile, buildFeedXml(items, schoolFeed), 'utf8');
        logInfo(`[OK] ${slug}: saved school feed ${schoolFile}`);
      }

      successCount += 1;

      if (EXCLUDED_FROM_MERGED.has(slug)) {
        logInfo(`[OK] ${slug}: ${items.length} item(s) – excluded from merged feed`);
        continue;
      }

      allItems.push(...withoutDuplicateIds(items, usedIds, slug));
      logInfo(`[OK] ${slug}: ${items.length} item(s)`);
    } catch (err) {
      failedSchools.add(slug);
      logError(`[ERROR] ${slug}: ${err.message} – school feed not updated`);
    }
  }

  // Ryd cachede kursussider, der ikke længere er i feedet – men kun hvis alle skoler blev bygget.
  if (failedSchools.size === 0) {
    for (const pageUrl of Object.keys(ogImageCache)) {
      if (!seenOgPages.has(pageUrl)) {
        delete ogImageCache[pageUrl];
      }
    }
  }
  saveOgImageCache(ogImageCache);

  logInfo('---');
  logInfo(`Successful schools: ${successCount}/${SCHOOLS.length}`);

  // Et samlet feed uden en af skolerne må ikke erstatte det forrige; kørslen fejler, så workflowen prøver igen.
  if (failedSchools.size > 0) {
    logError(`[ERROR] Merged feed not updated – failed schools: ${[...failedSchools].join(', ')}`);
    process.exitCode = 1;
  } else {
    fs.writeFileSync(OUTPUT_FILE, buildFeedXml(allItems, MERGED_FEED_META), 'utf8');
    logInfo(`Total merged items: ${allItems.length}`);
    logInfo(`Saved merged feed: ${OUTPUT_FILE}`);
  }
  logInfo(`Saved run log: ${currentLogFile}`);
}

mergeFeeds().catch((err) => {
  logError(`[FATAL] ${err.message}`);
  process.exitCode = 1;
});
