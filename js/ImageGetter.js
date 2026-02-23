"use strict";

const COVER_CACHE_KEY = "bookCoverCache";
const WIKIPEDIA_API_URL = "https://en.wikipedia.org/w/api.php";
const WIKIPEDIA_REST_SUMMARY_URL =
    "https://en.wikipedia.org/api/rest_v1/page/summary";
const DEFAULT_PLACEHOLDER_SRC =
  "assets/placeholder_viewboxed_600x900_combo.svg";

const TYPE_PLACEHOLDER_TEXT = {
  book: "Book",
  movie: "Movie",
  game: "Game",
  music: "Music",
  paper: "Paper",
  unknown: "Item",
};

const TYPE_PLACEHOLDER_ICON = {
  book: "📘",
  movie: "🎬",
  game: "🎮",
  music: "🎵",
  paper: "📄",
  unknown: "📦",
};

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

const CACHE_VERSION = "v12.5"; // change when input format changes

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

function escapeHtml(text) {
  return String(text || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function getTypePlaceholder(type) {
  const normalized = normalizeType(type);
  const label =
    TYPE_PLACEHOLDER_TEXT[normalized] || TYPE_PLACEHOLDER_TEXT.unknown;
  const icon =
    TYPE_PLACEHOLDER_ICON[normalized] || TYPE_PLACEHOLDER_ICON.unknown;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="1200" viewBox="0 0 800 1200"><rect width="100%" height="100%" fill="#f4f6f8"/><rect x="40" y="40" width="720" height="1120" rx="24" fill="#ffffff" stroke="#d0d7de"/><text x="400" y="530" text-anchor="middle" font-size="120">${icon}</text><text x="400" y="640" text-anchor="middle" font-family="Arial, sans-serif" font-size="44" fill="#57606a">${escapeHtml(label)}</text></svg>`;

  try {
    const bytes = new TextEncoder().encode(svg);
    let binary = "";
    const chunkSize = 0x8000;
    for (let i = 0; i < bytes.length; i += chunkSize) {
      const chunk = bytes.subarray(i, i + chunkSize);
      binary += String.fromCharCode(...chunk);
    }
    return `data:image/svg+xml;base64,${btoa(binary)}`;
  } catch {
    return DEFAULT_PLACEHOLDER_SRC;
  }
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

async function fetchWikipediaThumbnailByTitle(title, thumbSize = 500) {
  const cleanTitle = String(title || "").trim();
  if (!cleanTitle) return null;

  const params = new URLSearchParams({
    action: "query",
    titles: cleanTitle,
    prop: "pageimages",
    piprop: "thumbnail",
    pithumbsize: String(thumbSize),
    redirects: "1",
    format: "json",
    formatversion: "2",
    origin: "*",
  });

  const data = await fetchJson(`${WIKIPEDIA_API_URL}?${params}`);
  const page = Array.isArray(data?.query?.pages) ? data.query.pages[0] : null;
  return page?.thumbnail?.source || null;
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

async function searchWikipediaTitle(searchTerm) {
  const cleanTerm = String(searchTerm || "").trim();
  if (!cleanTerm) return null;

  const params = new URLSearchParams({
    action: "query",
    list: "search",
    srsearch: cleanTerm,
    srwhat: "title",
    srlimit: "1",
    format: "json",
    origin: "*",
  });

  const data = await fetchJson(`${WIKIPEDIA_API_URL}?${params}`);
  return data?.query?.search?.[0]?.title || null;
}

async function fetchWikipediaThumbnail(item, typeHint = "") {
  const title = String(item?.title || "").trim();
  if (!title) return null;

  // const author = String(item?.author || "").trim();
  const candidates = [title];
  if (typeHint) {
    candidates.push(`${title} (${typeHint})`);
    // candidates.push(`${title} ${typeHint}`);
  }
  // if (author) {
  //   candidates.push(`${title} (${author})`);
  //   candidates.push(`${title} ${author}`);
  // }

  for (const candidate of candidates) {
    const leadImage = await fetchWikipediaLeadImageByTitle(candidate);
    if (leadImage) return leadImage;

    const directThumb = await fetchWikipediaThumbnailByTitle(candidate);
    if (directThumb) return directThumb;

    const foundTitle = await searchWikipediaTitle(candidate);
    if (!foundTitle) continue;

    // const leadImageFromSearch =
    //     await fetchWikipediaLeadImageByTitle(foundTitle);
    // if (leadImageFromSearch) return leadImageFromSearch;

    const thumbFromSearch = await fetchWikipediaThumbnailByTitle(foundTitle);
    if (thumbFromSearch) return thumbFromSearch;
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

  // As requested: do not query Wikipedia for papers.
  // Without DOI/URL, reliable paper thumbnails are generally unavailable.
  return fetchCoverWithCache(cacheKey, async () => null);
}

async function getFallbackCoverForType(item) {
  const type = normalizeType(item?.type);
  if (!type) return DEFAULT_PLACEHOLDER_SRC;
  return getTypePlaceholder(type);
}

function formatSubtitle(book) {
  const author = String(book?.author || "").trim();
  const year = isValidYear(book?.year) ? String(book.year) : "";
  if (author && year) return `${author} (${year})`;
  if (author) return author;
  if (year) return year;
  return "Unknown";
}

function safeText(value, fallback = "") {
  const text = String(value ?? "").trim();
  return text || fallback;
}

function safeRating(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return String(value);
  return n.toFixed(1);
}

async function createBookCard(book) {
  const col = document.createElement("div");
  col.className = "col-sm-6 col-md-4";

  const card = document.createElement("div");
  card.className = "card h-100";

  // Image
  const img = document.createElement("img");
  img.className = "card-img-top";
  img.alt = `${safeText(book.title, "Untitled")} ${safeText(book.type, "item")} cover`;

  const coverUrl = await getCover(book);
  img.src = coverUrl || (await getFallbackCoverForType(book));

  img.onerror = function () {
    if (img.dataset.fallbackApplied === "1") return;
    img.dataset.fallbackApplied = "1";
    img.src = DEFAULT_PLACEHOLDER_SRC;
  };

  // Card body
  const body = document.createElement("div");
  body.className = "card-body";

  const rating = safeRating(book?.rating);
  const genreText = safeText(book?.genre, "Unknown");
  const descriptionText = safeText(
    book?.description,
    "No description provided.",
  );
  const typeText = safeText(book?.type, "item");
  const subtitle = formatSubtitle(book);

  body.innerHTML = `
    <h5 class="card-title">${escapeHtml(safeText(book?.title, "Untitled"))}</h5>
    <h6 class="card-subtitle mb-2 text-muted">${escapeHtml(subtitle)}</h6>
    <p class="card-text">${escapeHtml(descriptionText)}</p>
    <span class="badge bg-secondary text-uppercase">${escapeHtml(typeText)}</span>
    <span class="badge bg-secondary ms-1">${escapeHtml(genreText)}</span>
    ${rating !== null ? `<span class="badge bg-primary ms-1">${escapeHtml(rating)} ★</span>` : ""}
  `;

  card.appendChild(img);
  card.appendChild(body);
  col.appendChild(card);

  return col;
}

function clearLocalStorage() {
  localStorage.removeItem(COVER_CACHE_KEY);
  coverCache.clear();
  console.log("LocalStorage Cleared!");
}
