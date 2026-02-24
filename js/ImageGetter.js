"use strict";

const COVER_CACHE_KEY = "bookCoverCache";
const WIKIPEDIA_REST_SUMMARY_URL =
  "https://en.wikipedia.org/api/rest_v1/page/summary";
const DEFAULT_PLACEHOLDER_SRC = "assets/placeholder_viewboxed_600x900.svg";
const CROSSREF_WORKS_URL = "https://api.crossref.org/works";

const paperMetadataMap = new Map();
const paperMetadataPendingMap = new Map();

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

function getImageItemKey(item) {
  return [
    String(item?.title || "").trim(),
    String(item?.type || "").trim(),
    String(item?.author || "").trim(),
    String(item?.year ?? "").trim(),
  ].join("|");
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

function extractYearFromDateParts(dateParts) {
  const year = Number(dateParts?.[0]?.[0]);
  return Number.isFinite(year) ? year : null;
}

function getCrossrefWorkYear(work) {
  return (
    extractYearFromDateParts(work?.issued?.["date-parts"]) ||
    extractYearFromDateParts(work?.["published-print"]?.["date-parts"]) ||
    extractYearFromDateParts(work?.["published-online"]?.["date-parts"]) ||
    extractYearFromDateParts(work?.created?.["date-parts"]) ||
    null
  );
}

function getCrossrefWorkTitle(work) {
  if (Array.isArray(work?.title) && work.title.length > 0) {
    return String(work.title[0] || "").trim();
  }
  return "";
}

function getCrossrefAuthorText(work) {
  if (!Array.isArray(work?.author)) return "";
  return work.author
    .map((author) => {
      const given = String(author?.given || "").trim();
      const family = String(author?.family || "").trim();
      const name = String(author?.name || "").trim();
      return `${given} ${family}`.trim() || name;
    })
    .filter(Boolean)
    .join(" ");
}

function isSpringerDoi(doi) {
  const normalized = normalizeDoi(doi);
  return /^10\.(1007|1186)\//i.test(normalized);
}

function scoreCrossrefWork(work, paper) {
  const targetTitle = normalizeForMatch(paper?.title);
  const targetAuthor = normalizeForMatch(paper?.author);
  const targetYear = isValidYear(paper?.year) ? Number(paper.year) : null;

  const workTitle = normalizeForMatch(getCrossrefWorkTitle(work));
  const workAuthors = normalizeForMatch(getCrossrefAuthorText(work));
  const workYear = getCrossrefWorkYear(work);

  let score = 0;
  if (targetTitle && workTitle === targetTitle) score += 6;
  else if (targetTitle && workTitle.includes(targetTitle)) score += 3;

  if (targetAuthor && workAuthors.includes(targetAuthor)) score += 3;
  if (targetYear && workYear && targetYear === workYear) score += 2;

  const doi = normalizeDoi(work?.DOI);
  if (isSpringerDoi(doi)) score += 2;

  const workType = String(work?.type || "").toLowerCase();
  if (workType === "journal-article") score += 2;
  if (workType === "posted-content") score -= 2;

  // Common preprint DOI prefix; de-prioritize when a peer-reviewed item is available.
  if (/^10\.21203\//i.test(doi)) score -= 2;

  return score;
}

function isLikelyImageUrl(url) {
  const value = String(url || "").toLowerCase();
  return /\.(png|jpe?g|gif|webp|svg)(\?|#|$)/.test(value);
}

function pickCrossrefImageUrl(work) {
  const links = Array.isArray(work?.link) ? work.link : [];

  const imageLink = links.find((link) =>
    String(link?.["content-type"] || "")
      .toLowerCase()
      .startsWith("image/"),
  );
  if (imageLink?.URL) return String(imageLink.URL);

  const likelyImageLink = links.find((link) => isLikelyImageUrl(link?.URL));
  if (likelyImageLink?.URL) return String(likelyImageLink.URL);

  return null;
}

function normalizeDoi(value) {
  return String(value || "")
    .trim()
    .replace(/^https?:\/\/(dx\.)?doi\.org\//i, "");
}

function toDoiUrl(doi) {
  const normalized = normalizeDoi(doi);
  return normalized ? `https://doi.org/${normalized}` : null;
}

function toSafeHttpUrl(url) {
  try {
    const parsed = new URL(String(url || ""));
    if (parsed.protocol === "http:" || parsed.protocol === "https:") {
      return parsed.href;
    }
    return null;
  } catch {
    return null;
  }
}

function extractSpringerJournalIdFromDoi(doi) {
  const normalized = normalizeDoi(doi);
  const match = normalized.match(/^10\.(1007|1186)\/s(\d{4,6})(?:[-/]|$)/i);
  return match?.[2] || null;
}

function extractSpringerJournalIdFromUrl(url) {
  const value = String(url || "").trim();
  const match = value.match(/\/journal\/(\d{4,6})(?:[/?#]|$)/i);
  return match?.[1] || null;
}

function buildSpringerJournalCoverCandidates(journalId) {
  if (!journalId) return [];
  return [
    `https://media.springernature.com/full/springer-static/cover-hires/journal/${journalId}`,
    `https://media.springernature.com/w158/springer-static/cover-hires/journal/${journalId}`,
  ];
}

function canLoadImageUrl(imageSrc) {
  return new Promise((resolve) => {
    const safeUrl = toSafeHttpUrl(imageSrc);
    if (!safeUrl) {
      resolve(false);
      return;
    }

    const img = new Image();
    let settled = false;

    const finish = (ok) => {
      if (settled) return;
      settled = true;
      resolve(ok);
    };

    img.onload = () => finish(true);
    img.onerror = () => finish(false);

    const timeoutId = setTimeout(() => finish(false), 5000);
    img.onload = () => {
      clearTimeout(timeoutId);
      finish(true);
    };
    img.onerror = () => {
      clearTimeout(timeoutId);
      finish(false);
    };

    img.src = safeUrl;
  });
}

async function resolveSpringerJournalCoverUrl(doi, landingUrl) {
  const journalId =
    extractSpringerJournalIdFromDoi(doi) ||
    extractSpringerJournalIdFromUrl(landingUrl);

  if (!journalId) return null;

  const candidates = buildSpringerJournalCoverCandidates(journalId);
  for (const candidate of candidates) {
    if (await canLoadImageUrl(candidate)) {
      return candidate;
    }
  }

  return null;
}

async function fetchPaperMetadataFromCrossref(paper) {
  const title = String(paper?.title || "").trim();
  const author = String(paper?.author || "").trim();
  const year = isValidYear(paper?.year) ? String(paper.year) : "";

  if (!title) return null;

  const bibliographicQuery = [title, author, year].filter(Boolean).join(" ");

  const params = new URLSearchParams({
    "query.bibliographic": bibliographicQuery,
    rows: "8",
    select:
      "DOI,URL,title,author,issued,published-print,published-online,created,link,type",
  });

  const data = await fetchJson(`${CROSSREF_WORKS_URL}?${params}`);
  const items = Array.isArray(data?.message?.items) ? data.message.items : [];
  if (!items.length) return null;

  const best = items
    .map((work) => ({ work, score: scoreCrossrefWork(work, paper) }))
    .sort((a, b) => b.score - a.score)[0]?.work;

  if (!best) return null;

  const doi = normalizeDoi(best?.DOI);
  const doiUrl = toSafeHttpUrl(toDoiUrl(doi));
  const landingUrl = toSafeHttpUrl(best?.URL) || doiUrl || null;
  let imageUrl = toSafeHttpUrl(pickCrossrefImageUrl(best));

  if (!imageUrl) {
    imageUrl = await resolveSpringerJournalCoverUrl(doi, landingUrl);

    // If the top match is not Springer (e.g., a preprint), try a Springer candidate
    // from the same result set before giving up.
    if (!imageUrl) {
      const springerFallback = items
        .map((work) => ({ work, score: scoreCrossrefWork(work, paper) }))
        .sort((a, b) => b.score - a.score)
        .map((entry) => entry.work)
        .find((work) => isSpringerDoi(work?.DOI));

      if (springerFallback) {
        imageUrl = await resolveSpringerJournalCoverUrl(
          springerFallback?.DOI,
          springerFallback?.URL,
        );
      }
    }
  }

  if (!doi && !landingUrl && !imageUrl) return null;

  return {
    doi: doi || null,
    doiUrl,
    landingUrl,
    imageUrl,
    source: "crossref",
  };
}

async function getPaperMetadata(paper) {
  const key = getImageItemKey(paper);

  if (paperMetadataMap.has(key)) {
    return paperMetadataMap.get(key);
  }

  if (paperMetadataPendingMap.has(key)) {
    return paperMetadataPendingMap.get(key);
  }

  const pending = (async () => {
    try {
      const metadata = await fetchPaperMetadataFromCrossref(paper);
      paperMetadataMap.set(key, metadata || null);
      return metadata || null;
    } catch {
      paperMetadataMap.set(key, null);
      return null;
    } finally {
      paperMetadataPendingMap.delete(key);
    }
  })();

  paperMetadataPendingMap.set(key, pending);
  return pending;
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
