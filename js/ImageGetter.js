"use strict";

const COVER_CACHE_KEY = "bookCoverCache";
const WIKIPEDIA_REST_SUMMARY_URL =
  "https://en.wikipedia.org/api/rest_v1/page/summary";
const DEFAULT_PLACEHOLDER_SRC = "assets/placeholder_viewboxed_600x900.svg";

// Load persisted cache into memory
const coverCache = new Map();
try {
  const persisted = JSON.parse(localStorage.getItem(COVER_CACHE_KEY) || "{}");
  Object.entries(persisted).forEach(([k, v]) => coverCache.set(k, v));
} catch {
  localStorage.removeItem(COVER_CACHE_KEY);
}

// Persist helper
function persistCoverCache() {
  localStorage.setItem(
    COVER_CACHE_KEY,
    JSON.stringify(Object.fromEntries(coverCache)),
  );
}

const CACHE_VERSION = "v13"; // change when input format changes

const previousCacheVersion = localStorage.getItem("cacheVersion");
if (previousCacheVersion && previousCacheVersion !== CACHE_VERSION) {
  coverCache.clear();
  localStorage.removeItem(COVER_CACHE_KEY);
}

localStorage.setItem("cacheVersion", CACHE_VERSION);

function normalizeType(type) {
  return String(type || "")
    .trim()
    .toLowerCase();
}

function isValidYear(year) {
  const n = Number(year);
  return Number.isFinite(n) && n > 1000 && n < 3000;
}

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Request failed (${res.status}) for ${url}`);
  }
  return await res.json();
}

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

async function fetchWikipediaLeadImageByTitle(title) {
  const cleanTitle = String(title || "").trim();
  if (!cleanTitle) return null;

  const normalizedTitle = cleanTitle.replace(/\s+/g, " ").replace(/ /g, "_");
  const url = `${WIKIPEDIA_REST_SUMMARY_URL}/${encodeURIComponent(normalizedTitle)}`;

  try {
    const data = await fetchJson(url);
    return data?.thumbnail?.source || data?.originalimage?.source || null;
  } catch {
    return null;
  }
}

async function fetchWikipediaThumbnail(item, typeHint = "") {
  const title = String(item?.title || "").trim();
  if (!title) return null;

  const candidates = [title];
  if (typeHint) {
    candidates.push(`${title} (${typeHint})`);
  }

  for (const candidate of candidates) {
    const leadImage = await fetchWikipediaLeadImageByTitle(candidate);
    if (leadImage) return leadImage;
  }

  return null;
}

function getCover(item) {
  const type = normalizeType(item?.type);
  switch (type) {
    case "book":
      return getBookCover(item);
    case "movie":
      return getMoviePoster(item);
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

async function fetchCoverFromOpenLibrary(book) {
  const params = new URLSearchParams({
    title: String(book?.title || ""),
    author: String(book?.author || ""),
  });

  const data = await fetchJson(`https://openlibrary.org/search.json?${params}`);

  if (!data.docs || data.docs.length === 0) {
    return null;
  }

  const best = data.docs
    .map((doc) => ({ doc, score: scoreResult(doc, book) }))
    .sort((a, b) => b.score - a.score)[0];

  const coverId = best.doc.cover_i;
  return coverId
    ? `https://covers.openlibrary.org/b/id/${coverId}-L.jpg`
    : null;
}

async function getBookCover(book) {
  const cacheKey = `book|${book.title}|${book.author}|${book.year}`;

  return fetchCoverWithCache(cacheKey, async () => {
    return await fetchCoverFromOpenLibrary(book);
  });
}

async function getMoviePoster(movie) {
  const cacheKey = `movie|${movie.title}|${movie.year}`;
  return fetchCoverWithCache(cacheKey, async () => {
    return await fetchWikipediaThumbnail(movie, "film");
  });
}

async function getGameCover(game) {
  const cacheKey = `game|${game.title}|${game.year}`;
  return fetchCoverWithCache(cacheKey, async () => {
    return await fetchWikipediaThumbnail(game, "video game");
  });
}

function escapeLuceneValue(value) {
  return String(value || "").replace(/([+\-!(){}\[\]^\"~*?:\\/])/g, "\\$1");
}

function normalizeForMatch(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function extractYearFromDate(dateValue) {
  const year = Number(String(dateValue || "").slice(0, 4));
  return Number.isFinite(year) ? year : null;
}

function getPaperMetadataProvider() {
  const provider =
    typeof CATALOG_PAPER_METADATA_PROVIDER !== "undefined"
      ? CATALOG_PAPER_METADATA_PROVIDER
      : null;
  if (!provider || typeof provider !== "object") return null;
  if (typeof provider.get !== "function") return null;
  return provider;
}

async function getPaperMetadata(paper) {
  const provider = getPaperMetadataProvider();
  if (!provider) return null;

  try {
    return (await provider.get(paper)) || null;
  } catch {
    return null;
  }
}

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

function hasExactTitleMatch(actualTitle, targetTitle) {
  const actual = normalizeForMatch(actualTitle);
  const target = normalizeForMatch(targetTitle);
  return Boolean(actual && target && actual === target);
}

function hasArtistMatch(entity, targetArtist) {
  const target = normalizeForMatch(targetArtist);
  if (!target) return true;
  const credit = normalizeForMatch(getArtistCreditText(entity));
  return credit.includes(target);
}

function buildMusicBrainzReleaseQuery(options) {
  const luceneParts = [];
  if (options.title)
    luceneParts.push(`release:${escapeLuceneValue(options.title)}`);
  if (options.artist)
    luceneParts.push(`artist:${escapeLuceneValue(options.artist)}`);
  if (options.year) luceneParts.push(`date:${escapeLuceneValue(options.year)}`);
  return luceneParts.join(" AND ");
}

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

async function getMusicCover(item) {
  const cacheKey = `music|${item.title}|${item.author}|${item.year}`;
  return fetchCoverWithCache(cacheKey, async () => {
    return await fetchMusicCoverFromMusicBrainz(item);
  });
}

async function getPaperCover(item) {
  const cacheKey = `paper|${item.title}|${item.author}|${item.year}`;

  if (coverCache.has(cacheKey)) {
    return coverCache.get(cacheKey);
  }

  try {
    const metadata = await getPaperMetadata(item);
    const imageUrl = metadata?.imageUrl || null;

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

async function getFallbackCoverForType(item) {
  if (typeof getPlaceholderSrc === "function") {
    return getPlaceholderSrc();
  }

  return DEFAULT_PLACEHOLDER_SRC;
}

function clearLocalStorage() {
  localStorage.removeItem(COVER_CACHE_KEY);
  coverCache.clear();
  console.log("LocalStorage Cleared!");
}
