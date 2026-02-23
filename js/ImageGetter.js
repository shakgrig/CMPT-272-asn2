"use strict";

const COVER_CACHE_KEY = "bookCoverCache";
const WIKIPEDIA_REST_SUMMARY_URL =
  "https://en.wikipedia.org/api/rest_v1/page/summary";
const DEFAULT_PLACEHOLDER_SRC =
  "assets/placeholder_viewboxed_600x900_combo.svg";
const DETAIL_MODAL_ID = "catalogItemDetailModal";
const CROSSREF_WORKS_URL = "https://api.crossref.org/works";

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

const modalImagePreloadMap = new Map();
const modalImageResolvedMap = new Map();
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

function getCachedPaperMetadata(paper) {
  return paperMetadataMap.get(getModalItemKey(paper)) || null;
}

async function getPaperMetadata(paper) {
  const key = getModalItemKey(paper);

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
  // Best-effort approach: Crossref can provide DOI/links and occasionally image links.
  // We keep this uncached in localStorage so papers aren't permanently stuck at null.
  const metadata = await getPaperMetadata(item);
  return metadata?.imageUrl || null;
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

function getModalItemKey(item) {
  return [
    safeText(item?.title, ""),
    safeText(item?.type, ""),
    safeText(item?.author, ""),
    String(item?.year ?? ""),
  ].join("|");
}

function setModalImage(modal, title, typeText, imageSrc) {
  const modalImage = modal?.querySelector("[data-modal-image]");
  if (!modalImage) return;

  modalImage.src = imageSrc || DEFAULT_PLACEHOLDER_SRC;
  modalImage.alt = `${title} ${typeText} cover`;
  modalImage.onerror = function () {
    modalImage.src = DEFAULT_PLACEHOLDER_SRC;
  };
}

function renderModalFields(modal, item) {
  const modalFields = modal?.querySelector("[data-modal-fields]");
  if (!modalFields) return;

  const typeText = safeText(item?.type, "Unknown");
  const author = safeText(item?.author, "Unknown");
  const year = isValidYear(item?.year) ? String(item.year) : "Unknown";
  const genre = safeText(item?.genre, "Unknown");
  const rating = safeRating(item?.rating);
  const description = safeText(item?.description, "No description provided.");

  const rows = [
    { label: "Type", value: typeText },
    { label: "Author / Creator", value: author },
    { label: "Year", value: year },
    { label: "Genre", value: genre },
    { label: "Rating", value: rating !== null ? `${rating} ★` : "N/A" },
    { label: "Description", value: description },
  ];

  if (normalizeType(item?.type) === "paper") {
    const metadata = getCachedPaperMetadata(item);
    if (metadata?.doiUrl) {
      rows.push({
        label: "DOI",
        value: metadata.doi || metadata.doiUrl,
        href: metadata.doiUrl,
      });
    } else if (metadata?.landingUrl) {
      rows.push({
        label: "Paper URL",
        value: metadata.landingUrl,
        href: metadata.landingUrl,
      });
    } else {
      rows.push({ label: "DOI", value: "Searching Crossref…" });
    }
  }

  modalFields.innerHTML = rows
    .map((row) => {
      const label = escapeHtml(row.label);
      const value = escapeHtml(row.value);
      const href = toSafeHttpUrl(row.href);

      const renderedValue = href
        ? `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${value}</a>`
        : value;

      return `
        <dt class="col-5 text-muted">${label}</dt>
        <dd class="col-7">${renderedValue}</dd>
      `;
    })
    .join("");
}

function renderModalRaw(modal, item) {
  const modalRaw = modal?.querySelector("[data-modal-raw]");
  if (!modalRaw) return;

  const rawData = {
    title: safeText(item?.title, ""),
    type: safeText(item?.type, ""),
    author: safeText(item?.author, ""),
    year: Number.isFinite(Number(item?.year)) ? Number(item.year) : item?.year,
    genre: safeText(item?.genre, ""),
    rating:
      item?.rating === undefined || item?.rating === null
        ? null
        : Number.isFinite(Number(item?.rating))
          ? Number(item.rating)
          : item.rating,
    description: safeText(item?.description, ""),
  };

  if (normalizeType(item?.type) === "paper") {
    const metadata = getCachedPaperMetadata(item);
    rawData.doi = metadata?.doi || null;
    rawData.doiUrl = metadata?.doiUrl || null;
    rawData.paperUrl = metadata?.landingUrl || null;
    rawData.paperMetaSource = metadata?.source || null;
  }

  modalRaw.textContent = JSON.stringify(rawData, null, 2);
}

function ensureCatalogDetailModal() {
  let modal = document.getElementById(DETAIL_MODAL_ID);
  if (modal) return modal;

  modal = document.createElement("div");
  modal.className = "modal fade";
  modal.id = DETAIL_MODAL_ID;
  modal.tabIndex = -1;
  modal.setAttribute("aria-labelledby", `${DETAIL_MODAL_ID}Label`);
  modal.setAttribute("aria-hidden", "true");

  modal.innerHTML = `
    <div class="modal-dialog modal-lg modal-dialog-centered modal-dialog-scrollable">
      <div class="modal-content">
        <div class="modal-header">
          <h1 class="modal-title fs-5" id="${DETAIL_MODAL_ID}Label">Item details</h1>
          <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
        </div>
        <div class="modal-body">
          <div class="row g-3">
            <div class="col-12 col-md-5">
              <img class="img-fluid rounded border w-100" data-modal-image src="${DEFAULT_PLACEHOLDER_SRC}" alt="Item cover">
            </div>
            <div class="col-12 col-md-7">
              <dl class="row mb-0" data-modal-fields></dl>
            </div>
          </div>
          <hr>
          <h2 class="h6">Raw parsed data</h2>
          <pre class="small border rounded p-2 mb-0" data-modal-raw></pre>
        </div>
        <div class="modal-footer">
          <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Close</button>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(modal);
  return modal;
}

function openCatalogItemModal(item, imageSrc) {
  const modal = ensureCatalogDetailModal();

  const title = safeText(item?.title, "Untitled");
  const typeText = safeText(item?.type, "Unknown");

  const modalTitle = modal.querySelector(`#${DETAIL_MODAL_ID}Label`);

  modal.dataset.currentItemKey = getModalItemKey(item);

  if (modalTitle) {
    modalTitle.textContent = title;
  }

  setModalImage(modal, title, typeText, imageSrc);

  renderModalFields(modal, item);
  renderModalRaw(modal, item);

  if (window.bootstrap?.Modal) {
    const modalInstance = window.bootstrap.Modal.getOrCreateInstance(modal);
    modalInstance.show();
  }
}

function updateModalImageIfCurrentItem(item, imageSrc) {
  const modal = document.getElementById(DETAIL_MODAL_ID);
  if (!modal) return;

  const requestedKey = getModalItemKey(item);
  if (modal.dataset.currentItemKey !== requestedKey) return;

  const title = safeText(item?.title, "Untitled");
  const typeText = safeText(item?.type, "Unknown");
  setModalImage(modal, title, typeText, imageSrc || DEFAULT_PLACEHOLDER_SRC);
}

function refreshPaperModalMetadataIfCurrentItem(item) {
  const modal = document.getElementById(DETAIL_MODAL_ID);
  if (!modal) return;

  const requestedKey = getModalItemKey(item);
  if (modal.dataset.currentItemKey !== requestedKey) return;

  renderModalFields(modal, item);
  renderModalRaw(modal, item);

  const metadata = getCachedPaperMetadata(item);
  if (metadata?.imageUrl) {
    const title = safeText(item?.title, "Untitled");
    const typeText = safeText(item?.type, "Unknown");
    setModalImage(modal, title, typeText, metadata.imageUrl);
  }
}

async function resolveModalImageSource(item) {
  const coverUrl = await getCover(item);
  return coverUrl || (await getFallbackCoverForType(item));
}

function preloadImageToBrowserCache(imageSrc) {
  return new Promise((resolve) => {
    if (!imageSrc) {
      resolve();
      return;
    }

    const img = new Image();
    img.onload = () => resolve();
    img.onerror = () => resolve();
    img.src = imageSrc;
  });
}

async function getPreloadedModalImageSource(item) {
  const key = getModalItemKey(item);
  if (modalImageResolvedMap.has(key)) {
    return modalImageResolvedMap.get(key);
  }

  if (modalImagePreloadMap.has(key)) {
    return modalImagePreloadMap.get(key);
  }

  const preloadPromise = (async () => {
    try {
      const imageSrc = await resolveModalImageSource(item);
      await preloadImageToBrowserCache(imageSrc);
      const resolved = imageSrc || DEFAULT_PLACEHOLDER_SRC;
      modalImageResolvedMap.set(key, resolved);
      return resolved;
    } catch {
      const resolved = DEFAULT_PLACEHOLDER_SRC;
      modalImageResolvedMap.set(key, resolved);
      return resolved;
    }
  })();

  modalImagePreloadMap.set(key, preloadPromise);
  return preloadPromise;
}

function preloadModalImagesInBackground(items = [], options = {}) {
  if (!Array.isArray(items) || items.length === 0) return;

  const requestedConcurrency = Number(options?.concurrency);
  const concurrency = Number.isFinite(requestedConcurrency)
    ? Math.min(6, Math.max(1, Math.floor(requestedConcurrency)))
    : 2;

  const queue = items.filter((item) => item && typeof item === "object");
  let nextIndex = 0;
  let active = 0;

  const runNext = () => {
    while (active < concurrency && nextIndex < queue.length) {
      const item = queue[nextIndex++];
      active += 1;

      getPreloadedModalImageSource(item)
        .catch(() => DEFAULT_PLACEHOLDER_SRC)
        .finally(() => {
          active -= 1;
          runNext();
        });
    }
  };

  if (typeof window !== "undefined" && "requestIdleCallback" in window) {
    window.requestIdleCallback(() => runNext(), { timeout: 1200 });
  } else {
    setTimeout(runNext, 0);
  }
}

globalThis.preloadModalImagesInBackground = preloadModalImagesInBackground;

async function createBookCard(book) {
  const col = document.createElement("div");
  col.className = "col-6 col-md-4 col-lg-3";

  const card = document.createElement("div");
  card.className = "card h-100 catalog-item-card catalog-item-card--compact";

  // Card body
  const body = document.createElement("div");
  body.className = "card-body p-2";

  const rating = safeRating(book?.rating);
  const typeText = safeText(book?.type, "item");
  const subtitle = formatSubtitle(book);

  body.innerHTML = `
    <h6 class="card-title mb-1">${escapeHtml(safeText(book?.title, "Untitled"))}</h6>
    <p class="card-subtitle text-muted small mb-2">${escapeHtml(subtitle)}</p>
    <div class="d-flex flex-wrap align-items-center gap-1">
      <span class="badge bg-secondary text-uppercase">${escapeHtml(typeText)}</span>
      ${rating !== null ? `<span class="badge bg-primary">${escapeHtml(rating)} ★</span>` : ""}
      <span class="small text-muted ms-auto">Click for details</span>
    </div>
  `;

  card.appendChild(body);

  const trigger = document.createElement("button");
  trigger.type = "button";
  trigger.className =
    "catalog-card-trigger btn p-0 border-0 bg-transparent text-start w-100 h-100";
  trigger.setAttribute(
    "aria-label",
    `Open details for ${safeText(book?.title, "Untitled")}`,
  );
  trigger.addEventListener("click", async () => {
    const key = getModalItemKey(book);
    const readyImage = modalImageResolvedMap.get(key);

    if (readyImage) {
      openCatalogItemModal(book, readyImage);
      return;
    }

    openCatalogItemModal(book, DEFAULT_PLACEHOLDER_SRC);
    try {
      const imageSrc = await getPreloadedModalImageSource(book);
      updateModalImageIfCurrentItem(book, imageSrc);
    } catch {
      // Keep placeholder on failure.
    }

    if (normalizeType(book?.type) === "paper") {
      getPaperMetadata(book)
        .then(() => {
          refreshPaperModalMetadataIfCurrentItem(book);
        })
        .catch(() => {
          refreshPaperModalMetadataIfCurrentItem(book);
        });
    }
  });
  trigger.appendChild(card);

  col.appendChild(trigger);

  return col;
}

function clearLocalStorage() {
  localStorage.removeItem(COVER_CACHE_KEY);
  coverCache.clear();
  console.log("LocalStorage Cleared!");
}
