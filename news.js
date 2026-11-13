// functions/api/news.js

const FEEDS_BY_COUNTRY = {
  cy: [
    'https://www.philenews.com/feed/',
    'https://www.sigmalive.com/rss'
  ],
  gr: [
    'https://www.kathimerini.gr/infeeds/rss/nx-rss-feed.xml',
    'https://www.naftemporiki.gr/feed/'
  ],
  gb: [
    'https://feeds.bbci.co.uk/news/uk/rss.xml',
    'https://www.theguardian.com/uk/rss'
  ],
  us: [
    'https://rss.nytimes.com/services/xml/rss/nyt/HomePage.xml',
    'https://feeds.npr.org/1001/rss.xml'
  ],
  de: [
    'https://www.tagesschau.de/infoservices/alle-meldungen-100~rss2.xml'
  ],
  fr: [
    'https://www.france24.com/fr/rss'
  ]
};

export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const country = (url.searchParams.get('country') || 'cy').toLowerCase();
  
  // Δυναμική επιλογή RSS: Αν είναι 'world', χρησιμοποιούμε το Google News RSS παγκοσμίως
  let feeds = FEEDS_BY_COUNTRY[country];
  if (country === 'world' || !feeds) {
    feeds = [`https://news.google.com/rss?hl=el&gl=GR&ceid=GR:el`];
  } else if (country === 'cy') {
    feeds.push(`https://news.google.com/rss?hl=el&gl=CY&ceid=CY:el`);
  } else if (country === 'gr') {
    feeds.push(`https://news.google.com/rss?hl=el&gl=GR&ceid=GR:el`);
  } else {
    feeds.push(`https://news.google.com/rss?hl=en&gl=${country.toUpperCase()}&ceid=${country.toUpperCase()}:en`);
  }

  // Έλεγχος Cache για ταχύτητα & μηδενική καθυστέρηση
  const cache = caches.default;
  const cacheKey = new Request(url.toString(), context.request);
  const cachedResponse = await cache.match(cacheKey);
  if (cachedResponse) return cachedResponse;

  try {
    let allArticles = [];

    for (const feedUrl of feeds) {
      try {
        const res = await fetch(feedUrl, {
          headers: { 'User-Agent': 'Mozilla/5.0 (compatible; GlobalNewsReader/2.0)' }
        });
        if (res.ok) {
          const xml = await res.text();
          allArticles = allArticles.concat(parseRSS(xml));
        }
      } catch {
        // Συνεχίζει αν κάποια πηγή αργήσει
      }
    }

    // Αφαίρεση διπλότυπων και συλλογή έως 50+ θέματα για προοπτική
    const uniqueArticles = [];
    const seenTitles = new Set();

    for (const item of allArticles) {
      const normalized = item.title.toLowerCase();
      if (!seenTitles.has(normalized) && item.title.length > 8) {
        seenTitles.add(normalized);
        uniqueArticles.push(item);
      }
      if (uniqueArticles.length >= 60) break;
    }

    const response = new Response(JSON.stringify(uniqueArticles), {
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'public, max-age=1800'
      }
    });

    context.waitUntil(cache.put(cacheKey, response.clone()));
    return response;

  } catch {
    return new Response(JSON.stringify({ error: 'Σφάλμα ανάκτησης ειδήσεων' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

function parseRSS(xml) {
  const items = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/g;
  let match;

  while ((match = itemRegex.exec(xml)) !== null) {
    const block = match[1];
    const title = cleanText(extractTag(block, 'title'));
    const link = cleanText(extractTag(block, 'link'));
    const rawDesc = extractTag(block, 'description') || extractTag(block, 'content:encoded') || '';

    // Εντοπισμός φωτογραφίας
    let image = '';
    const mediaMatch = block.match(/url=["'](https?:\/\/[^"']+\.(?:jpg|jpeg|png|webp)[^"']*)["']/i);
    const enclosureMatch = block.match(/<enclosure[^>]+url=["']([^"']+)["']/i);
    const imgTagMatch = rawDesc.match(/<img[^>]+src=["']([^"']+)["']/i);

    if (mediaMatch) image = mediaMatch[1];
    else if (enclosureMatch) image = enclosureMatch[1];
    else if (imgTagMatch) image = imgTagMatch[1];

    let summary = cleanText(rawDesc);
    if (summary.length > 350) {
      summary = summary.substring(0, 347).trim() + '...';
    }

    if (title && link) {
      items.push({ title, summary, image, link });
    }
  }
  return items;
}

function extractTag(text, tag) {
  const regex = new RegExp(`<${tag}[^>]*>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?<\\/${tag}>`, 'i');
  const match = text.match(regex);
  return match ? match[1] : '';
}

function cleanText(str) {
  return str
    .replace(/<[^>]*>?/gm, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&#8217;/g, "'")
    .replace(/&#8220;|&#8221;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}