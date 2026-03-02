"use strict";

/**
 * @typedef {Object} CatalogLikeItem
 * @property {string} [title] Title used in provider-specific lookup queries.
 * @property {string} [type] Item type used to route to the correct cover strategy.
 * @property {string} [author] Author/creator/artist text for matching and query refinement.
 * @property {number|string} [year] Publication/release year hint for relevance scoring.
 */

/**
 * @typedef {Object} PaperMetadataProvider
 * @property {(item: CatalogLikeItem) => Promise<({imageUrl?: string|null}|null)>} get Async metadata resolver used for paper image URLs.
 */

const COVER_CACHE_KEY = "bookCoverCache";
const WIKIPEDIA_REST_SUMMARY_URL =
  "https://en.wikipedia.org/api/rest_v1/page/summary";
const DEFAULT_PLACEHOLDER_SRC = "assets/placeholder_viewboxed_600x900.svg";
const FETCH_BASE_DELAY_MS = 250;
const USE_LOCAL_STORAGE = false;
const STORAGE_TYPE = USE_LOCAL_STORAGE ? localStorage : sessionStorage;
const GOOGLE_BOOKS_DELAY_MS = 1500; // adjust as needed

// Load persisted cache into memory
const coverCache = new Map();
try {
  const persisted = JSON.parse(STORAGE_TYPE.getItem(COVER_CACHE_KEY) || "{}");
  Object.entries(persisted).forEach(([k, v]) => coverCache.set(k, v));
} catch {
  STORAGE_TYPE.removeItem(COVER_CACHE_KEY);
}

// Persist helper
/**
 * Persists the in-memory cover cache to browser storage.
 * The cache intentionally stores null misses to avoid repeated failed lookups
 * (except where specific strategies override that behavior).
 * @returns {void}
 */
function persistCoverCache() {
  STORAGE_TYPE.setItem(
    COVER_CACHE_KEY,
    JSON.stringify(Object.fromEntries(coverCache)),
  );
}

const CACHE_VERSION = "v13"; // change when input format changes

const previousCacheVersion = STORAGE_TYPE.getItem("cacheVersion");
if (previousCacheVersion && previousCacheVersion !== CACHE_VERSION) {
  coverCache.clear();
  STORAGE_TYPE.removeItem(COVER_CACHE_KEY);
}

STORAGE_TYPE.setItem("cacheVersion", CACHE_VERSION);

/**
 * Normalizes catalog type values for comparison.
 * @param {string} type Raw type string from data or UI.
 * @returns {string} Lowercase trimmed token suitable for switch routing.
 */
function normalizeType(type) {
  return String(type || "")
    .trim()
    .toLowerCase();
}

/**
 * Checks whether a year is within an expected catalog range.
 * @param {number|string|null|undefined} year Candidate numeric year value.
 * @returns {boolean} True when finite and in a plausible range.
 */
function isValidYear(year) {
  const n = Number(year);
  return Number.isFinite(n) && n > 1000 && n < 3000;
}

/**
 * Fetches JSON from a URL and throws for non-2xx responses.
 * Retries are applied for 429 and transient network failures only.
 * @param {string} url Fully-qualified endpoint URL.
 * @returns {Promise<any>} Parsed JSON response body.
 */
// async function fetchJson(url) {
//   const res = await fetch(url);
//   if (!res.ok) {
//     throw new Error(`Request failed (${res.status}) for ${url}`);
//   }
//   return await res.json();
// }
async function fetchJson(
  url,
  {
    retries = 3,
    retryDelayMs = FETCH_BASE_DELAY_MS,
    maxRetryDelayMs = GOOGLE_BOOKS_DELAY_MS,
  } = {},
) {
  let attempt = 0;
  let currentDelayMs = Math.max(0, retryDelayMs);

  if (currentDelayMs > 0) {
    await delay(currentDelayMs);
  }

  while (true) {
    try {
      const res = await fetch(url);

      if (res.status === 429) {
        if (attempt >= retries) {
          throw new Error(`429 after ${attempt + 1} attempts: ${url}`);
        }

        attempt++;
        currentDelayMs = Math.min(
          maxRetryDelayMs,
          Math.max(currentDelayMs * 2, retryDelayMs),
        );
        await delay(currentDelayMs);
        continue;
      }

      if (!res.ok) {
        throw new Error(`Request failed (${res.status}) for ${url}`);
      }

      return await res.json();
    } catch (err) {
      // Retry only network-level failures; HTTP errors (like 404/500)
      // should fail fast to avoid repeated bad requests.
      const isNetworkError = err instanceof TypeError;
      if (!isNetworkError) throw err;

      if (attempt >= retries) throw err;

      attempt++;
      currentDelayMs = Math.min(maxRetryDelayMs, currentDelayMs + retryDelayMs);
      await delay(currentDelayMs);
    }
  }
}

/**
 * Pauses execution for a specified duration.
 * @param {number} ms Milliseconds to delay.
 * @returns {Promise<void>} Promise that resolves after the delay.
 */
function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Builds the Wikipedia REST summary endpoint URL for a title.
 * @param {string} title Candidate page title.
 * @returns {string} Full summary endpoint URL.
 */
function buildWikipediaSummaryUrl(title) {
  const cleanTitle = String(title || "").trim();
  const normalizedTitle = cleanTitle.replace(/\s+/g, " ").replace(/ /g, "_");
  return `${WIKIPEDIA_REST_SUMMARY_URL}/${encodeURIComponent(normalizedTitle)}`;
}

/**
 * Builds candidate Wikipedia page titles for a catalog item.
 * @param {CatalogLikeItem} item Source item.
 * @param {string} [typeHint=""] Optional disambiguation hint.
 * @returns {string[]} Ordered title candidates.
 */
function getWikipediaCandidateTitles(item, typeHint = "") {
  const title = String(item?.title || "").trim();
  if (!title) return [];

  const year = isValidYear(item?.year) ? String(Number(item.year)) : "";
  const candidates = [];
  const seen = new Set();

  const addCandidate = (value) => {
    const normalized = String(value || "").trim();
    if (!normalized || seen.has(normalized)) return;
    seen.add(normalized);
    candidates.push(normalized);
  };

  // Most specific first (helps with titles like "Tusk" and
  // "Star Wars Battlefront II" that have multiple pages/meanings).
  if (typeHint && year) addCandidate(`${title} (${year} ${typeHint})`);
  if (typeHint) addCandidate(`${title} (${typeHint})`);
  if (year) addCandidate(`${title} (${year})`);
  addCandidate(title);

  return candidates;
}

/**
 * Retrieves a cover URL from cache or computes and stores it.
 * @param {string} cacheKey Stable key for the item/source strategy.
 * @param {() => Promise<(string|null|undefined)>} fetcher Async lookup callback used on cache miss.
 * @returns {Promise<string|null>} Cached or freshly fetched URL (null when unavailable).
 */
async function fetchCoverWithCache(cacheKey, fetcher) {
  if (coverCache.has(cacheKey)) {
    return coverCache.get(cacheKey);
  }

  try {
    const coverUrl = await fetcher();
    coverCache.set(cacheKey, coverUrl || null);
    persistCoverCache();
    return coverUrl || null;
  } catch (error) {
    console.warn("Cover lookup failed:", error);
    coverCache.set(cacheKey, null);
    persistCoverCache();
    return null;
  }
}

/**
 * Looks up a lead image for a Wikipedia page title.
 * @param {string} title Page title candidate before URL normalization.
 * @returns {Promise<string|null>} Thumbnail/original image URL when present.
 */
async function fetchWikipediaLeadImageByTitle(title) {
  const cleanTitle = String(title || "").trim();
  if (!cleanTitle) return { imageUrl: null, lookupUrl: null };

  const url = buildWikipediaSummaryUrl(cleanTitle);

  try {
    const data = await fetchJson(url);
    return {
      imageUrl: data?.thumbnail?.source || data?.originalimage?.source || null,
      lookupUrl: url,
    };
  } catch {
    return { imageUrl: null, lookupUrl: url };
  }
}

/**
 * Attempts to fetch a Wikipedia thumbnail using title variants.
 * @param {CatalogLikeItem} item Item whose title is used to build candidates.
 * @param {string} [typeHint=""] Optional parenthetical disambiguator (for example `film`).
 * @returns {Promise<string|null>} First successful image URL from attempted variants.
 */
async function fetchWikipediaThumbnail(item, typeHint = "") {
  const candidates = getWikipediaCandidateTitles(item, typeHint);
  if (!candidates.length) return null;

  for (const candidate of candidates) {
    const result = await fetchWikipediaLeadImageByTitle(candidate);
    if (result?.imageUrl) {
      if (item) {
        item.coverLookupUrl = result.lookupUrl || null;
      }
      return result.imageUrl;
    }
  }

  return null;
}

/**
 * Routes an item to the appropriate cover fetch strategy by type.
 * @param {CatalogLikeItem} item Item to resolve.
 * @returns {Promise<string|null>} Provider-specific cover URL or null.
 */
function getCover(item) {
  const type = normalizeType(item?.type);
  switch (type) {
    case "book":
      return getBookCover(item);
    case "movie":
      return getMoviePoster(item);
    case "tv":
      return getTVPoster(item);
    case "game":
      return getGameCover(item);
    case "music":
      return getMusicCover(item);
    case "paper":
      return getPaperCover(item);
    default:
      return Promise.resolve(null);
  }
}

/**
 * Computes a simple relevance score for OpenLibrary book matches.
 * @param {any} doc OpenLibrary search result document.
 * @param {CatalogLikeItem} book Target book item.
 * @returns {number} Higher score indicates stronger title/author/year alignment.
 */
function scoreResult(doc, book) {
  let score = 0;

  if (doc.title?.toLowerCase() === book.title.toLowerCase()) score += 3;

  if (
    doc.author_name?.some((a) =>
      a.toLowerCase().includes(book.author.toLowerCase()),
    )
  )
    score += 2;

  if (doc.first_publish_year === book.year) score += 1;

  return score;
}

/*
 * Queries OpenLibrary and returns the best cover image URL for a book.
 * @param {CatalogLikeItem} book Book-like item containing title/author hints.
 * @returns {Promise<string|null>} OpenLibrary cover URL for best-ranked match.
 */
// async function fetchCoverFromOpenLibrary(book) {
//   const params = new URLSearchParams({
//     title: String(book?.title || ""),
//     author: String(book?.author || ""),
//   });

//   const data = await fetchJson(`https://openlibrary.org/search.json?${params}`);

//   if (!data.docs || data.docs.length === 0) {
//     return null;
//   }

//   const best = data.docs
//     .map((doc) => ({ doc, score: scoreResult(doc, book) }))
//     .sort((a, b) => b.score - a.score)[0];

//   const coverId = best.doc.cover_i;
//   return coverId
//     ? `https://covers.openlibrary.org/b/id/${coverId}-L.jpg`
//     : null;
// }

/**
 * Queries Google Books and returns the best cover image URL for a book.
 * @param {CatalogLikeItem} book Book-like item containing title/author hints.
 * @returns {Promise<string|null>} Google Books cover URL for best-ranked match.
 */
function scoreGoogleBooksResult(volume, book) {
  const info = volume?.volumeInfo || {};

  const targetTitle = normalizeForMatch(book?.title);
  const actualTitle = normalizeForMatch(info?.title);
  const targetAuthor = normalizeForMatch(book?.author);
  const actualAuthors = Array.isArray(info?.authors)
    ? normalizeForMatch(info.authors.join(" "))
    : "";

  const targetYear = isValidYear(book?.year) ? Number(book.year) : null;
  const actualYear = extractYearFromDate(info?.publishedDate);

  let score = 0;

  if (targetTitle && actualTitle === targetTitle) score += 5;
  else if (targetTitle && actualTitle.includes(targetTitle)) score += 2;

  if (targetAuthor && actualAuthors.includes(targetAuthor)) score += 3;
  if (targetYear && actualYear && targetYear === actualYear) score += 2;

  // Prefer entries that are likely actual books and have ready image links.
  if (String(info?.printType || "").toUpperCase() === "BOOK") score += 1;
  if (info?.imageLinks?.thumbnail || info?.imageLinks?.smallThumbnail)
    score += 1;

  return score;
}

/**
 * Builds the Google Books feed query string for a catalog item.
 * @param {CatalogLikeItem} book Book-like item used for lookup.
 * @returns {string} Query text sent to the Google Books feed endpoint.
 */
function buildGoogleBooksQuery(book) {
  return `${String(book?.title || "")} ${String(book?.author || "")} ${String(book?.year || 0)}`;
}

/**
 * Builds the Google Books feed endpoint URL for a catalog item.
 * @param {CatalogLikeItem} book Book-like item used for lookup.
 * @returns {string} Full Google Books feed URL.
 */
function buildGoogleBooksFeedUrl(book) {
  const query = buildGoogleBooksQuery(book);
  return `https://books.google.com/books/feeds/volumes?q=${encodeURIComponent(query)}&max-results=5&min-viewability=none&alt=json`;
}

// let googleBooksQueue = Promise.resolve();
async function fetchCoverFromGoogleBooks(book) {
  // console.log("entered google book function");
  const query = buildGoogleBooksQuery(book);
  // console.log("query made");

  if (!query.trim()) return null;
  // console.log("post query check");

  const lookupUrl = buildGoogleBooksFeedUrl(book);
  const data = await fetchJson(lookupUrl);

  // console.log("got json?");

  const entries = Array.isArray(data?.feed?.entry) ? data.feed.entry : [];
  if (!entries.length) {
    return null;
  }

  // console.log("array check");

  const firstEntry = entries[0];
  const rawId = String(firstEntry?.id?.$t || "");
  const bookId = rawId.split("/volumes/")[1]?.split(/[?#]/)[0] || null;

  return bookId
    ? // ? `https://books.google.com/books/content?id=${bookId}&printsec=frontcover&img=1`
      `https://play.google.com/books/publisher/content/images/frontcover/${bookId}?fife=h1000`
    : null;
  // }));
}

/**
 * Gets a cached OpenLibrary cover for a book item.
 * @param {CatalogLikeItem} book Book item to resolve.
 * @returns {Promise<string|null>} Cached/fetched cover URL.
 */
async function getBookCover(book) {
  const cacheKey = `book|${book.title}|${book.author}|${book.year}`;
  const lookupUrl = buildGoogleBooksFeedUrl(book);

  const coverUrl = await fetchCoverWithCache(cacheKey, async () => {
    // return await fetchCoverFromOpenLibrary(book);
    return await fetchCoverFromGoogleBooks(book);
  });

  if (coverUrl) {
    book.coverLookupUrl = lookupUrl;
  } else {
    delete book.coverLookupUrl;
  }

  return coverUrl;
}

/**
 * Gets a cached movie poster URL.
 * @param {CatalogLikeItem} movie Movie item to resolve.
 * @returns {Promise<string|null>} Poster-like image URL.
 */
async function getMoviePoster(movie) {
  const cacheKey = `movie|${movie.title}|${movie.year}`;
  const coverUrl = await fetchCoverWithCache(cacheKey, async () => {
    return await fetchWikipediaThumbnail(movie, "film");
  });

  if (coverUrl && !movie?.coverLookupUrl) {
    movie.coverLookupUrl = String(coverUrl);
  }
  if (!coverUrl) {
    delete movie.coverLookupUrl;
  }

  return coverUrl;
}

/**
 * Gets a cached TV poster URL.
 * @param {CatalogLikeItem} tv TV item to resolve.
 * @returns {Promise<string|null>} Poster-like image URL.
 */
async function getTVPoster(tv) {
  const cacheKey = `tv|${tv.title}|${tv.year}`;
  const coverUrl = await fetchCoverWithCache(cacheKey, async () => {
    return await fetchWikipediaThumbnail(tv, "show");
  });

  if (coverUrl && !tv?.coverLookupUrl) {
    tv.coverLookupUrl = String(coverUrl);
  }
  if (!coverUrl) {
    delete tv.coverLookupUrl;
  }

  return coverUrl;
}

/**
 * Gets a cached game cover URL.
 * @param {CatalogLikeItem} game Game item to resolve.
 * @returns {Promise<string|null>} Cover-like image URL.
 */
async function getGameCover(game) {
  const cacheKey = `game|${game.title}|${game.year}`;
  const coverUrl = await fetchCoverWithCache(cacheKey, async () => {
    return await fetchWikipediaThumbnail(game, "video game");
  });

  if (coverUrl && !game?.coverLookupUrl) {
    game.coverLookupUrl = String(coverUrl);
  }
  if (!coverUrl) {
    delete game.coverLookupUrl;
  }

  return coverUrl;
}

/**
 * Escapes Lucene special characters in a query token.
 * @param {string} value Raw query fragment.
 * @returns {string} Escaped fragment safe for MusicBrainz Lucene queries.
 */
function escapeLuceneValue(value) {
  return String(value || "").replace(/([+\-!(){}\[\]^\"~*?:\\/])/g, "\\$1");
}

/**
 * Normalizes strings to alphanumeric tokens for loose matching.
 * @param {string} value Input text for approximate comparisons.
 * @returns {string} Lowercased token string with punctuation removed.
 */
function normalizeForMatch(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Extracts a 4-digit year from an ISO-like date string.
 * @param {string} dateValue Date string such as `YYYY-MM-DD`.
 * @returns {number|null} Parsed year or null when invalid.
 */
function extractYearFromDate(dateValue) {
  const year = Number(String(dateValue || "").slice(0, 4));
  return Number.isFinite(year) ? year : null;
}

/**
 * Returns the optional paper metadata provider if available.
 * @returns {PaperMetadataProvider|null} Provider instance when loaded and shape-compatible.
 */
function getPaperMetadataProvider() {
  const provider =
    typeof CATALOG_PAPER_METADATA_PROVIDER !== "undefined"
      ? CATALOG_PAPER_METADATA_PROVIDER
      : null;
  if (!provider || typeof provider !== "object") return null;
  if (typeof provider.get !== "function") return null;
  return provider;
}

/**
 * Retrieves metadata for a paper item using the optional provider.
 * @param {CatalogLikeItem} paper Paper-like item to resolve.
 * @returns {Promise<any|null>} Provider metadata payload or null on failure/unavailable provider.
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
 * Builds a flattened artist credit string from a MusicBrainz entity.
 * @param {any} entity MusicBrainz release/recording entity.
 * @returns {string} Concatenated artist-credit text.
 */
function getArtistCreditText(entity) {
  const credits = entity?.["artist-credit"];
  if (!Array.isArray(credits)) return "";

  return credits
    .map((entry) => {
      if (typeof entry === "string") return entry;
      if (!entry || typeof entry !== "object") return "";
      return entry.name || entry.artist?.name || "";
    })
    .join(" ")
    .trim();
}

/**
 * Checks for exact normalized title equivalence.
 * @param {string} actualTitle Candidate title from API result.
 * @param {string} targetTitle Input item title.
 * @returns {boolean} True when normalized forms match exactly.
 */
function hasExactTitleMatch(actualTitle, targetTitle) {
  const actual = normalizeForMatch(actualTitle);
  const target = normalizeForMatch(targetTitle);
  return Boolean(actual && target && actual === target);
}

/**
 * Checks whether a MusicBrainz entity matches the target artist text.
 * @param {any} entity Candidate MusicBrainz entity.
 * @param {string} targetArtist Desired artist text.
 * @returns {boolean} True when candidate credit contains target artist tokens.
 */
function hasArtistMatch(entity, targetArtist) {
  const target = normalizeForMatch(targetArtist);
  if (!target) return true;
  const credit = normalizeForMatch(getArtistCreditText(entity));
  return credit.includes(target);
}

/**
 * Builds a MusicBrainz release search query.
 * @param {{title?: string, artist?: string, year?: string}} options Structured query hints.
 * @returns {string} Lucene expression joined with `AND` terms.
 */
function buildMusicBrainzReleaseQuery(options) {
  const luceneParts = [];
  if (options.title)
    luceneParts.push(`release:${escapeLuceneValue(options.title)}`);
  if (options.artist)
    luceneParts.push(`artist:${escapeLuceneValue(options.artist)}`);
  if (options.year) luceneParts.push(`date:${escapeLuceneValue(options.year)}`);
  return luceneParts.join(" AND ");
}

/**
 * Resolves music cover art using MusicBrainz + Cover Art Archive with Wikipedia fallback.
 * @param {CatalogLikeItem} item Music item with title/artist/year hints.
 * @returns {Promise<string|null>} Cover Art Archive URL or Wikipedia fallback.
 */
async function fetchMusicCoverFromMusicBrainz(item) {
  const title = String(item?.title || "").trim();
  const artist = String(item?.author || "").trim();
  const yearNum = isValidYear(item?.year) ? Number(item.year) : null;
  const yearStr = yearNum ? String(yearNum) : "";

  // Release search only: cover art belongs to releases.
  const releaseQuery =
    buildMusicBrainzReleaseQuery({ title, artist, year: yearStr }) ||
    buildMusicBrainzReleaseQuery({ title, artist });

  if (!releaseQuery) return await fetchWikipediaThumbnail(item, "song");

  try {
    const releaseParams = new URLSearchParams({
      query: releaseQuery,
      limit: "25",
      fmt: "json",
    });

    const releaseData = await fetchJson(
      `https://musicbrainz.org/ws/2/release?${releaseParams}`,
    );
    const releases = Array.isArray(releaseData?.releases)
      ? releaseData.releases
      : [];
    if (!releases.length) {
      return await fetchWikipediaThumbnail(item, "song");
    }

    const strictReleases = releases.filter(
      (r) =>
        hasExactTitleMatch(r?.title, title) &&
        hasArtistMatch(r, artist) &&
        (!yearNum || extractYearFromDate(r?.date) === yearNum),
    );

    const relaxedReleases = releases.filter(
      (r) => hasExactTitleMatch(r?.title, title) && hasArtistMatch(r, artist),
    );

    const chosenRelease = strictReleases[0] || relaxedReleases[0] || null;
    const releaseId = chosenRelease?.id;
    if (!releaseId) {
      return await fetchWikipediaThumbnail(item, "song");
    }

    return `https://coverartarchive.org/release/${releaseId}/front-500`;
  } catch {
    return await fetchWikipediaThumbnail(item, "song");
  }
}

/**
 * Gets a cached music cover URL.
 * @param {CatalogLikeItem} item Music item to resolve.
 * @returns {Promise<string|null>} Cached/fetched cover URL.
 */
async function getMusicCover(item) {
  const cacheKey = `music|${item.title}|${item.author}|${item.year}`;
  const coverUrl = await fetchCoverWithCache(cacheKey, async () => {
    return await fetchMusicCoverFromMusicBrainz(item);
  });

  if (coverUrl && !item?.coverLookupUrl) {
    item.coverLookupUrl = String(coverUrl);
  }
  if (!coverUrl) {
    delete item.coverLookupUrl;
  }

  return coverUrl;
}

/**
 * Resolves paper cover art from paper metadata, caching successful hits.
 * Misses are intentionally not cached so future metadata enrichments can recover.
 * @param {CatalogLikeItem} item Paper item whose provider metadata may contain an image URL.
 * @returns {Promise<string|null>} Resolved paper cover URL or null.
 */
async function getPaperCover(item) {
  const cacheKey = `paper|${item.title}|${item.author}|${item.year}`;

  if (coverCache.has(cacheKey)) {
    return coverCache.get(cacheKey);
  }

  try {
    const metadata = await getPaperMetadata(item);
    const imageUrl = metadata?.imageUrl || null;

    if (imageUrl) {
      item.coverLookupUrl =
        metadata?.landingUrl || metadata?.doiUrl || String(imageUrl);
    } else {
      delete item.coverLookupUrl;
    }

    // Cache only successful hits so temporary misses can recover later.
    if (imageUrl) {
      coverCache.set(cacheKey, imageUrl);
      persistCoverCache();
    }

    return imageUrl;
  } catch {
    return null;
  }
}

/**
 * Returns a fallback placeholder cover source.
 * @param {CatalogLikeItem} item Unused placeholder for future type-specific fallback logic.
 * @returns {Promise<string>} Placeholder source path/data URI.
 */
async function getFallbackCoverForType(item) {
  if (typeof getPlaceholderSrc === "function") {
    return getPlaceholderSrc();
  }

  return DEFAULT_PLACEHOLDER_SRC;
}

/**
 * Clears persisted and in-memory cover cache.
 * @returns {void}
 */
function clearLocalStorage() {
  STORAGE_TYPE.removeItem(COVER_CACHE_KEY);
  coverCache.clear();
  console.log("Storage Cleared!");
}
