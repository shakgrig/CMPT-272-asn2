"use strict";

const COVER_CACHE_KEY = "bookCoverCache";
const WIKIPEDIA_SUMMARY_URL =
  "https://en.wikipedia.org/api/rest_v1/page/summary";
const DEFAULT_PLACEHOLDER_SRC = "assets/placeholder_viewboxed_600x900.svg";
const USE_LOCAL_STORAGE = false;
const STORAGE_TYPE = USE_LOCAL_STORAGE ? localStorage : sessionStorage;
const CACHE_VERSION = "v13";

const coverCache = new Map();

try {
  const saved = JSON.parse(STORAGE_TYPE.getItem(COVER_CACHE_KEY) || "{}");
  const keys = Object.keys(saved);
  for (let i = 0; i < keys.length; i++) {
    coverCache.set(keys[i], saved[keys[i]]);
  }
} catch {
  STORAGE_TYPE.removeItem(COVER_CACHE_KEY);
}

const oldVersion = STORAGE_TYPE.getItem("cacheVersion");
if (oldVersion && oldVersion !== CACHE_VERSION) {
  coverCache.clear();
  STORAGE_TYPE.removeItem(COVER_CACHE_KEY);
}
STORAGE_TYPE.setItem("cacheVersion", CACHE_VERSION);

/**
 * Persists the in-memory cover cache to browser storage.
 * @returns {void}
 */
function persistCoverCache() {
  STORAGE_TYPE.setItem(
    COVER_CACHE_KEY,
    JSON.stringify(Object.fromEntries(coverCache)),
  );
}

/**
 * Normalizes a catalog type string for comparisons.
 * @param {string} type Raw item type.
 * @returns {string} Lowercase trimmed type.
 */
function normalizeType(type) {
  return String(type || "")
    .trim()
    .toLowerCase();
}

/**
 * Checks whether a year value is numeric.
 * @param {number|string} year Year candidate.
 * @returns {boolean} True when the value is finite.
 */
function isValidYear(year) {
  return Number.isFinite(Number(year));
}

/**
 * Waits for a given number of milliseconds.
 * @param {number} ms Delay in milliseconds.
 * @returns {Promise<void>} Resolves after the delay.
 */
function delay(ms) {
  return new Promise(function (resolve) {
    setTimeout(resolve, ms);
  });
}

/**
 * Fetches JSON from a URL with basic retry behavior.
 * Retries transient failures and HTTP 429 responses.
 * @param {string} url Endpoint URL.
 * @returns {Promise<any>} Parsed JSON response.
 */
async function fetchJson(url) {
  let waitMs = 250;

  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const res = await fetch(url);

      if (res.ok) return await res.json();

      if (res.status === 429 && attempt < 3) {
        await delay(waitMs);
        waitMs = Math.min(waitMs * 2, 1500);
        continue;
      }

      throw new Error(`Request failed (${res.status})`);
    } catch (error) {
      if (attempt >= 3 || !(error instanceof TypeError)) {
        throw error;
      }

      await delay(waitMs);
      waitMs = Math.min(waitMs + 250, 1500);
    }
  }

  throw new Error("Request failed.");
}

/**
 * Builds Wikipedia summary endpoint URL for a title.
 * @param {string} title Page title text.
 * @returns {string} Wikipedia REST summary URL.
 */
function buildWikipediaSummaryUrl(title) {
  const clean = String(title || "")
    .trim()
    .replace(/\s+/g, " ");
  const pageTitle = clean.replace(/ /g, "_");
  return `${WIKIPEDIA_SUMMARY_URL}/${encodeURIComponent(pageTitle)}`;
}

/**
 * Generates candidate Wikipedia titles for better hit rates.
 * @param {{title?:string, year?:number|string}} item Catalog item.
 * @param {string} [typeHint=""] Optional hint like "film".
 * @returns {string[]} Ordered unique title candidates.
 */
function getWikipediaCandidateTitles(item, typeHint = "") {
  const title = String(item && item.title ? item.title : "").trim();
  if (!title) return [];

  const year = isValidYear(item && item.year) ? String(Number(item.year)) : "";
  const candidates = [];

  if (typeHint && year) candidates.push(`${title} (${year} ${typeHint})`);
  if (typeHint) candidates.push(`${title} (${typeHint})`);
  if (year) candidates.push(`${title} (${year})`);
  candidates.push(title);

  const unique = [];
  for (let i = 0; i < candidates.length; i++) {
    if (!unique.includes(candidates[i])) {
      unique.push(candidates[i]);
    }
  }

  return unique;
}

/**
 * Resolves a thumbnail URL from Wikipedia using candidate titles.
 * @param {Object} item Catalog item; may be updated with `coverLookupUrl`.
 * @param {string} [typeHint=""] Optional disambiguation hint.
 * @returns {Promise<string|null>} Image URL when found.
 */
async function fetchWikipediaThumbnail(item, typeHint = "") {
  const candidates = getWikipediaCandidateTitles(item, typeHint);

  for (let i = 0; i < candidates.length; i++) {
    const lookupUrl = buildWikipediaSummaryUrl(candidates[i]);

    try {
      const data = await fetchJson(lookupUrl);
      const imageUrl =
        (data && data.thumbnail && data.thumbnail.source) ||
        (data && data.originalimage && data.originalimage.source) ||
        null;

      if (imageUrl) {
        if (item) item.coverLookupUrl = lookupUrl;
        return imageUrl;
      }
    } catch {
      // Try next candidate title.
    }
  }

  return null;
}

/**
 * Gets a cover URL from cache or fetches and stores it.
 * @param {string} cacheKey Key for this lookup target.
 * @param {() => Promise<string|null>} fetcher Async fetch callback.
 * @returns {Promise<string|null>} Cover URL or null.
 */
async function fetchCoverWithCache(cacheKey, fetcher) {
  if (coverCache.has(cacheKey)) {
    return coverCache.get(cacheKey);
  }

  try {
    const coverUrl = (await fetcher()) || null;
    coverCache.set(cacheKey, coverUrl);
    persistCoverCache();
    return coverUrl;
  } catch (error) {
    console.warn("Cover lookup failed:", error);
    coverCache.set(cacheKey, null);
    persistCoverCache();
    return null;
  }
}

/**
 * Routes a catalog item to its type-specific cover resolver.
 * @param {{type?:string}} item Catalog item.
 * @returns {Promise<string|null>} Resolved cover URL or null.
 */
function getCover(item) {
  const type = normalizeType(item && item.type);

  if (type === "book") return getBookCover(item);
  if (type === "movie") return getMoviePoster(item);
  if (type === "tv") return getTVPoster(item);
  if (type === "game") return getGameCover(item);
  if (type === "music") return getMusicCover(item);
  if (type === "paper") return getPaperCover(item);

  return Promise.resolve(null);
}

/**
 * Builds a simple Google Books query string from item fields.
 * @param {{title?:string, author?:string, year?:number|string}} book Book item.
 * @returns {string} Query text.
 */
function buildGoogleBooksQuery(book) {
  const title = String(book && book.title ? book.title : "");
  const author = String(book && book.author ? book.author : "");
  const year = String(book && book.year ? book.year : "");
  return `${title} ${author} ${year}`;
}

/**
 * Builds the Google Books feed URL for a book lookup.
 * @param {{title?:string, author?:string, year?:number|string}} book Book item.
 * @returns {string} Feed URL.
 */
function buildGoogleBooksFeedUrl(book) {
  const query = buildGoogleBooksQuery(book);
  return `https://books.google.com/books/feeds/volumes?q=${encodeURIComponent(query)}&max-results=5&min-viewability=none&alt=json`;
}

/**
 * Fetches a book cover URL from Google Books feed data.
 * @param {{title?:string, author?:string, year?:number|string}} book Book item.
 * @returns {Promise<string|null>} Cover URL or null.
 */
async function fetchCoverFromGoogleBooks(book) {
  const query = buildGoogleBooksQuery(book);
  if (!query.trim()) return null;

  const data = await fetchJson(buildGoogleBooksFeedUrl(book));
  const entries =
    data && data.feed && Array.isArray(data.feed.entry) ? data.feed.entry : [];

  if (!entries.length) return null;

  const firstEntry = entries[0];
  const rawId = String(
    firstEntry && firstEntry.id ? firstEntry.id.$t || "" : "",
  );
  const bookId = rawId.split("/volumes/")[1]
    ? rawId.split("/volumes/")[1].split(/[?#]/)[0]
    : null;

  if (!bookId) return null;

  return `https://play.google.com/books/publisher/content/images/frontcover/${bookId}?fife=h1000`;
}

/**
 * Gets a cached/fetched book cover URL.
 * @param {{title:string, author:string, year:number|string, coverLookupUrl?:string}} book Book item.
 * @returns {Promise<string|null>} Cover URL or null.
 */
async function getBookCover(book) {
  const cacheKey = `book|${book.title}|${book.author}|${book.year}`;
  const lookupUrl = buildGoogleBooksFeedUrl(book);

  const coverUrl = await fetchCoverWithCache(cacheKey, function () {
    return fetchCoverFromGoogleBooks(book);
  });

  if (coverUrl) {
    book.coverLookupUrl = lookupUrl;
  } else {
    delete book.coverLookupUrl;
  }

  return coverUrl;
}

/**
 * Gets a cached/fetched movie poster from Wikipedia.
 * @param {{title:string, year:number|string, coverLookupUrl?:string}} movie Movie item.
 * @returns {Promise<string|null>} Poster URL or null.
 */
async function getMoviePoster(movie) {
  const cacheKey = `movie|${movie.title}|${movie.year}`;

  const coverUrl = await fetchCoverWithCache(cacheKey, function () {
    return fetchWikipediaThumbnail(movie, "film");
  });

  if (!coverUrl) delete movie.coverLookupUrl;
  return coverUrl;
}

/**
 * Gets a cached/fetched TV poster from Wikipedia.
 * @param {{title:string, year:number|string, coverLookupUrl?:string}} tv TV item.
 * @returns {Promise<string|null>} Poster URL or null.
 */
async function getTVPoster(tv) {
  const cacheKey = `tv|${tv.title}|${tv.year}`;

  const coverUrl = await fetchCoverWithCache(cacheKey, function () {
    return fetchWikipediaThumbnail(tv, "show");
  });

  if (!coverUrl) delete tv.coverLookupUrl;
  return coverUrl;
}

/**
 * Gets a cached/fetched game cover from Wikipedia.
 * @param {{title:string, year:number|string, coverLookupUrl?:string}} game Game item.
 * @returns {Promise<string|null>} Cover URL or null.
 */
async function getGameCover(game) {
  const cacheKey = `game|${game.title}|${game.year}`;

  const coverUrl = await fetchCoverWithCache(cacheKey, function () {
    return fetchWikipediaThumbnail(game, "video game");
  });

  if (!coverUrl) delete game.coverLookupUrl;
  return coverUrl;
}

/**
 * Normalizes free text for loose matching/scoring.
 * @param {string} value Text input.
 * @returns {string} Lowercase alphanumeric tokenized text.
 */
function normalizeForMatch(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Extracts year component from date-like text.
 * @param {string} dateValue Date string.
 * @returns {number|null} Parsed year or null.
 */
function extractYearFromDate(dateValue) {
  const year = Number(String(dateValue || "").slice(0, 4));
  return Number.isFinite(year) ? year : null;
}

/**
 * Escapes special characters for MusicBrainz Lucene queries.
 * @param {string} value Raw query value.
 * @returns {string} Escaped query-safe value.
 */
function escapeLuceneValue(value) {
  return String(value || "").replace(/([+\-!(){}\[\]^\"~*?:\\/])/g, "\\$1");
}

/**
 * Flattens MusicBrainz artist-credit array into plain text.
 * @param {Object} release MusicBrainz release object.
 * @returns {string} Joined artist credit text.
 */
function getArtistCreditText(release) {
  const credits = release && release["artist-credit"];
  if (!Array.isArray(credits)) return "";

  let joined = "";
  for (let i = 0; i < credits.length; i++) {
    const entry = credits[i];

    if (typeof entry === "string") {
      joined += entry;
      continue;
    }

    if (entry && typeof entry === "object") {
      const text = entry.name || (entry.artist && entry.artist.name) || "";
      joined += text;
    }
  }

  return joined.trim();
}

/**
 * Scores a MusicBrainz release against title/artist/year hints.
 * @param {Object} release Candidate release.
 * @param {string} title Target title.
 * @param {string} artist Target artist.
 * @param {number|null} yearNum Target year.
 * @returns {number} Higher score means better match.
 */
function scoreMusicRelease(release, title, artist, yearNum) {
  let score = 0;

  const releaseTitle = normalizeForMatch(release && release.title);
  const targetTitle = normalizeForMatch(title);
  const releaseArtist = normalizeForMatch(getArtistCreditText(release));
  const targetArtist = normalizeForMatch(artist);
  const releaseYear = extractYearFromDate(release && release.date);

  if (targetTitle && releaseTitle === targetTitle) score += 5;
  else if (targetTitle && releaseTitle.includes(targetTitle)) score += 2;

  if (targetArtist && releaseArtist.includes(targetArtist)) score += 3;
  if (yearNum && releaseYear && yearNum === releaseYear) score += 2;

  return score;
}

/**
 * Resolves music cover art via MusicBrainz + Cover Art Archive.
 * Falls back to Wikipedia song image lookup when needed.
 * @param {{title?:string, author?:string, year?:number|string}} item Music item.
 * @returns {Promise<string|null>} Cover URL or null.
 */
async function fetchMusicCoverFromMusicBrainz(item) {
  const title = String(item && item.title ? item.title : "").trim();
  const artist = String(item && item.author ? item.author : "").trim();
  const yearNum = isValidYear(item && item.year) ? Number(item.year) : null;
  const year = yearNum ? String(yearNum) : "";

  let query = "";
  if (title) query += `release:${escapeLuceneValue(title)}`;
  if (artist)
    query += `${query ? " AND " : ""}artist:${escapeLuceneValue(artist)}`;
  if (year) query += `${query ? " AND " : ""}date:${escapeLuceneValue(year)}`;

  if (!query) {
    return await fetchWikipediaThumbnail(item, "song");
  }

  try {
    const params = new URLSearchParams({ query, limit: "25", fmt: "json" });
    const data = await fetchJson(
      `https://musicbrainz.org/ws/2/release?${params}`,
    );
    const releases = data && Array.isArray(data.releases) ? data.releases : [];

    if (!releases.length) {
      return await fetchWikipediaThumbnail(item, "song");
    }

    let best = null;
    let bestScore = -Infinity;

    for (let i = 0; i < releases.length; i++) {
      const score = scoreMusicRelease(releases[i], title, artist, yearNum);
      if (score > bestScore) {
        bestScore = score;
        best = releases[i];
      }
    }

    const releaseId = best && best.id ? best.id : null;
    if (!releaseId) {
      return await fetchWikipediaThumbnail(item, "song");
    }

    return `https://coverartarchive.org/release/${releaseId}/front-500`;
  } catch {
    return await fetchWikipediaThumbnail(item, "song");
  }
}

/**
 * Gets cached/fetched music cover URL.
 * @param {{title:string, author:string, year:number|string, coverLookupUrl?:string}} item Music item.
 * @returns {Promise<string|null>} Cover URL or null.
 */
async function getMusicCover(item) {
  const cacheKey = `music|${item.title}|${item.author}|${item.year}`;

  const coverUrl = await fetchCoverWithCache(cacheKey, function () {
    return fetchMusicCoverFromMusicBrainz(item);
  });

  if (coverUrl && !item.coverLookupUrl) {
    item.coverLookupUrl = String(coverUrl);
  }
  if (!coverUrl) {
    delete item.coverLookupUrl;
  }

  return coverUrl;
}

/**
 * Returns the optional paper metadata provider when available.
 * @returns {{get: Function}|null} Provider instance or null.
 */
function getPaperMetadataProvider() {
  if (typeof CATALOG_PAPER_METADATA_PROVIDER === "undefined") return null;
  if (!CATALOG_PAPER_METADATA_PROVIDER) return null;
  if (typeof CATALOG_PAPER_METADATA_PROVIDER.get !== "function") return null;
  return CATALOG_PAPER_METADATA_PROVIDER;
}

/**
 * Retrieves metadata for a paper item through the provider.
 * @param {Object} paper Paper item.
 * @returns {Promise<Object|null>} Metadata object or null.
 */
async function getPaperMetadata(paper) {
  const provider = getPaperMetadataProvider();
  if (!provider) return null;

  try {
    return (await provider.get(paper)) || null;
  } catch {
    return null;
  }
}

/**
 * Gets paper cover art from metadata provider and caches successful hits.
 * @param {{title:string, author:string, year:number|string, coverLookupUrl?:string}} item Paper item.
 * @returns {Promise<string|null>} Cover URL or null.
 */
async function getPaperCover(item) {
  const cacheKey = `paper|${item.title}|${item.author}|${item.year}`;

  if (coverCache.has(cacheKey)) {
    return coverCache.get(cacheKey);
  }

  try {
    const metadata = await getPaperMetadata(item);
    const imageUrl = metadata && metadata.imageUrl ? metadata.imageUrl : null;

    if (imageUrl) {
      item.coverLookupUrl =
        metadata.landingUrl || metadata.doiUrl || String(imageUrl);
      coverCache.set(cacheKey, imageUrl);
      persistCoverCache();
      return imageUrl;
    }

    delete item.coverLookupUrl;
    return null;
  } catch {
    return null;
  }
}

/**
 * Returns a fallback placeholder cover source.
 * @returns {Promise<string>} Placeholder source URL.
 */
async function getFallbackCoverForType() {
  if (typeof getPlaceholderSrc === "function") {
    return getPlaceholderSrc();
  }

  return DEFAULT_PLACEHOLDER_SRC;
}

/**
 * Clears cover cache from memory and storage.
 * @returns {void}
 */
function clearLocalStorage() {
  STORAGE_TYPE.removeItem(COVER_CACHE_KEY);
  coverCache.clear();
  console.log("Storage Cleared!");
}
