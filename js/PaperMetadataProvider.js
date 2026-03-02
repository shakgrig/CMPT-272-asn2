"use strict";

/**
 * @typedef {Object} CatalogLikeItem
 * @property {string} [title] Candidate publication title.
 * @property {string} [type] Catalog type (only `paper` is preloaded by this module).
 * @property {string} [author] Primary author text used in query/scoring heuristics.
 * @property {number|string} [year] Publication year used for matching confidence.
 */

/**
 * @typedef {Object} PaperMetadata
 * @property {string|null} doi Normalized DOI text without resolver prefix.
 * @property {string|null} doiUrl Canonical DOI resolver URL.
 * @property {string|null} landingUrl Best known HTTP URL for article landing page.
 * @property {string|null} imageUrl Optional resolved cover/thumbnail URL.
 * @property {string} source Metadata source identifier.
 */

/**
 * @typedef {Object} PaperMetadataProviderApi
 * @property {(item: CatalogLikeItem) => (PaperMetadata|null)} getCached Reads already-computed metadata by stable item key.
 * @property {(item: CatalogLikeItem) => Promise<(PaperMetadata|null)>} get Fetches metadata with in-flight request de-duplication.
 * @property {(items?: CatalogLikeItem[], options?: {concurrency?: number}) => void} preload Background warmup for many paper-like items.
 */

/** @type {PaperMetadataProviderApi} */
const CATALOG_PAPER_METADATA_PROVIDER = (() => {
  const CROSSREF_WORKS_URL = "https://api.crossref.org/works";
  const metadataMap = new Map();
  const pendingMap = new Map();

  /**
   * Converts unknown values to trimmed text.
   * @param {unknown} value Arbitrary value from item/work payloads.
   * @returns {string} Trimmed string representation.
   */
  function safeText(value) {
    return String(value ?? "").trim();
  }

  /**
   * Normalizes type strings for comparisons.
   * @param {string} type Raw type value from item data.
   * @returns {string} Lowercased/trimmed token suitable for equality checks.
   */
  function normalizeType(type) {
    return String(type || "")
      .trim()
      .toLowerCase();
  }

  /**
   * Checks whether the year is in a reasonable range.
   * @param {number|string|null|undefined} year Candidate publication year.
   * @returns {boolean} True when finite and in a likely real-world range.
   */
  function isValidYear(year) {
    const n = Number(year);
    return Number.isFinite(n) && n > 1000 && n < 3000;
  }

  /**
   * Builds a stable cache key for an item.
   * @param {CatalogLikeItem} item Catalog row identity input.
   * @returns {string} Pipe-delimited cache key derived from title/type/author/year.
   */
  function getItemKey(item) {
    return [
      safeText(item?.title),
      safeText(item?.type),
      safeText(item?.author),
      String(item?.year ?? "").trim(),
    ].join("|");
  }

  /**
   * Normalizes text for fuzzy comparisons.
   * @param {string} value Input text from title/author fields.
   * @returns {string} Lowercase alphanumeric token string.
   */
  function normalizeForMatch(value) {
    return String(value || "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  }

  /**
   * Normalizes DOI values by stripping resolver URL prefixes.
   * @param {string} value DOI text or DOI URL.
   * @returns {string} Bare DOI token.
   */
  function normalizeDoi(value) {
    return String(value || "")
      .trim()
      .replace(/^https?:\/\/(dx\.)?doi\.org\//i, "");
  }

  /**
   * Converts a DOI into a canonical DOI URL.
   * @param {string} doi Raw DOI value.
   * @returns {string|null} https://doi.org URL when DOI is valid; else null.
   */
  function toDoiUrl(doi) {
    const normalized = normalizeDoi(doi);
    return normalized ? `https://doi.org/${normalized}` : null;
  }

  /**
   * Accepts only valid HTTP/HTTPS URLs.
   * @param {string} url Candidate URL from remote metadata.
   * @returns {string|null} Safe absolute URL or null for invalid/unsupported protocols.
   */
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

  /**
   * Extracts a year from Crossref-style date-parts arrays.
   * @param {any} dateParts Crossref `date-parts` value (typically nested array).
   * @returns {number|null} Parsed year or null when unavailable.
   */
  function extractYearFromDateParts(dateParts) {
    const year = Number(dateParts?.[0]?.[0]);
    return Number.isFinite(year) ? year : null;
  }

  /**
   * Reads the primary title from a Crossref work.
   * @param {any} work Crossref work object.
   * @returns {string} Primary title text or empty string.
   */
  function getCrossrefWorkTitle(work) {
    if (Array.isArray(work?.title) && work.title.length > 0) {
      return String(work.title[0] || "").trim();
    }
    return "";
  }

  /**
   * Flattens Crossref author entries into plain text.
   * @param {any} work Crossref work object.
   * @returns {string} Joined author text used for fuzzy matching.
   */
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

  /**
   * Selects the best available publication year from a Crossref work.
   * @param {any} work Crossref work object.
   * @returns {number|null} First usable year from issued/published/created fields.
   */
  function getCrossrefYear(work) {
    return (
      extractYearFromDateParts(work?.issued?.["date-parts"]) ||
      extractYearFromDateParts(work?.["published-print"]?.["date-parts"]) ||
      extractYearFromDateParts(work?.["published-online"]?.["date-parts"]) ||
      extractYearFromDateParts(work?.created?.["date-parts"]) ||
      null
    );
  }

  /**
   * Detects Springer-family DOI prefixes.
   * @param {string} doi DOI value to inspect.
   * @returns {boolean} True when DOI likely belongs to Springer/BMC namespaces.
   */
  function isSpringerDoi(doi) {
    return /^10\.(1007|1186)\//i.test(normalizeDoi(doi));
  }

  /**
   * Heuristic check for image URL-like endings.
   * @param {string} url Candidate URL from Crossref links.
   * @returns {boolean} True when path appears to reference an image asset.
   */
  function isLikelyImageUrl(url) {
    const value = String(url || "").toLowerCase();
    return /\.(png|jpe?g|gif|webp|svg)(\?|#|$)/.test(value);
  }

  /**
   * Picks a likely image URL from Crossref link data.
   * @param {any} work Crossref work object containing optional `link` entries.
   * @returns {string|null} Best image-like URL candidate, if any.
   */
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

  /**
   * Extracts a Springer journal id from DOI text when possible.
   * @param {string} doi DOI to parse.
   * @returns {string|null} Journal id token used for Springer cover URL construction.
   */
  function extractSpringerJournalIdFromDoi(doi) {
    const normalized = normalizeDoi(doi);
    const match = normalized.match(/^10\.(1007|1186)\/s(\d{4,6})(?:[-/]|$)/i);
    return match?.[2] || null;
  }

  /**
   * Extracts a Springer journal id from a landing URL.
   * @param {string} url Article landing URL.
   * @returns {string|null} Journal id token when URL contains `/journal/{id}`.
   */
  function extractSpringerJournalIdFromUrl(url) {
    const value = String(url || "").trim();
    const match = value.match(/\/journal\/(\d{4,6})(?:[/?#]|$)/i);
    return match?.[1] || null;
  }

  /**
   * Builds candidate Springer journal cover URLs.
   * @param {string|null} journalId Parsed Springer journal identifier.
   * @returns {string[]} Ordered high-res and resized candidate URLs.
   */
  function buildSpringerJournalCoverCandidates(journalId) {
    if (!journalId) return [];
    return [
      `https://media.springernature.com/full/springer-static/cover-hires/journal/${journalId}`,
      `https://media.springernature.com/w158/springer-static/cover-hires/journal/${journalId}`,
    ];
  }

  /**
   * Tests whether an image URL is loadable in the browser.
   * @param {string} imageSrc Candidate image URL to probe.
   * @returns {Promise<boolean>} True if image loads before timeout/error.
   */
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

  /**
   * Attempts to resolve a Springer journal cover URL from DOI/landing data.
   * @param {string} doi DOI candidate used to infer Springer journal id.
   * @param {string} landingUrl Landing URL fallback for journal id extraction.
   * @returns {Promise<string|null>} First loadable Springer cover URL or null.
   */
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

  /**
   * Scores Crossref works by title, author, year, and content-type heuristics.
   * @param {any} work Crossref candidate work.
   * @param {CatalogLikeItem} item Target catalog item.
   * @returns {number} Higher score means better candidate fit.
   */
  function scoreCrossrefCandidate(work, item) {
    const targetTitle = normalizeForMatch(item?.title);
    const targetAuthor = normalizeForMatch(item?.author);
    const targetYear = isValidYear(item?.year) ? Number(item.year) : null;

    const workTitle = normalizeForMatch(getCrossrefWorkTitle(work));
    const workAuthors = normalizeForMatch(getCrossrefAuthorText(work));
    const workYear = getCrossrefYear(work);

    let score = 0;
    if (targetTitle && workTitle === targetTitle) score += 6;
    else if (targetTitle && workTitle.includes(targetTitle)) score += 3;

    if (targetAuthor && workAuthors.includes(targetAuthor)) score += 3;
    if (targetYear && workYear && targetYear === workYear) score += 2;

    const doi = normalizeDoi(work?.DOI);
    const workType = String(work?.type || "").toLowerCase();

    if (isSpringerDoi(doi)) score += 2;
    if (workType === "journal-article") score += 2;
    if (workType === "posted-content") score -= 2;
    if (/^10\.21203\//i.test(doi)) score -= 2;

    return score;
  }

  /**
   * Fetches, ranks, and normalizes metadata for paper-like catalog items.
   * Queries Crossref, ranks candidates, then attempts to resolve DOI, landing URL,
   * and a likely image URL (including Springer-specific fallbacks).
   * @param {CatalogLikeItem} item Paper-like catalog item.
   * @returns {Promise<PaperMetadata|null>} Normalized metadata object or null.
   */
  async function fetchPaperMetadata(item) {
    const title = safeText(item?.title);
    if (!title) return null;

    const author = safeText(item?.author);
    const year = isValidYear(item?.year) ? String(item.year) : "";
    const query = [title, author, year].filter(Boolean).join(" ");

    const params = new URLSearchParams({
      "query.bibliographic": query,
      rows: "8",
      select:
        "DOI,URL,title,author,issued,published-print,published-online,created,link,type",
    });

    const res = await fetch(`${CROSSREF_WORKS_URL}?${params}`);
    if (!res.ok) throw new Error(`Crossref request failed (${res.status})`);
    const data = await res.json();

    const items = Array.isArray(data?.message?.items) ? data.message.items : [];
    if (!items.length) return null;

    const best = items
      .map((work) => ({ work, score: scoreCrossrefCandidate(work, item) }))
      .sort((a, b) => b.score - a.score)[0]?.work;

    if (!best) return null;

    const doi = normalizeDoi(best?.DOI);
    const doiUrl = toSafeHttpUrl(toDoiUrl(doi));
    const landingUrl = toSafeHttpUrl(best?.URL) || doiUrl || null;
    let imageUrl = toSafeHttpUrl(pickCrossrefImageUrl(best));

    if (!imageUrl) {
      imageUrl = await resolveSpringerJournalCoverUrl(doi, landingUrl);

      // If the top match is not Springer (e.g., a preprint), try a Springer result.
      if (!imageUrl) {
        const springerFallback = items
          .map((work) => ({ work, score: scoreCrossrefCandidate(work, item) }))
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

  /**
   * Retrieves previously cached metadata if available.
   * @param {CatalogLikeItem} item Item to look up in the local metadata cache.
   * @returns {PaperMetadata|null} Cached metadata hit or null.
   */
  function getCached(item) {
    return metadataMap.get(getItemKey(item)) || null;
  }

  /**
   * Gets metadata for an item with deduplicated in-flight requests.
   * @param {CatalogLikeItem} item Item requiring metadata retrieval.
   * @returns {Promise<PaperMetadata|null>} Cached/ongoing/fetched metadata result.
   */
  async function get(item) {
    const key = getItemKey(item);

    if (metadataMap.has(key)) {
      return metadataMap.get(key);
    }

    if (pendingMap.has(key)) {
      return pendingMap.get(key);
    }

    const pending = (async () => {
      try {
        const metadata = await fetchPaperMetadata(item);
        metadataMap.set(key, metadata || null);
        return metadata || null;
      } catch {
        metadataMap.set(key, null);
        return null;
      } finally {
        pendingMap.delete(key);
      }
    })();

    pendingMap.set(key, pending);
    return pending;
  }

  /**
   * Preloads metadata in the background for paper items.
   * Uses idle-time scheduling where supported and bounds worker count to 1..4.
   * @param {CatalogLikeItem[]} [items=[]] Candidate catalog items.
   * @param {{concurrency?: number}} [options={}] Optional preload tuning.
   * @returns {void}
   */
  function preload(items = [], options = {}) {
    const requestedConcurrency = Number(options?.concurrency);
    const concurrency = Number.isFinite(requestedConcurrency)
      ? Math.min(4, Math.max(1, Math.floor(requestedConcurrency)))
      : 1;

    const queue = (Array.isArray(items) ? items : []).filter(
      (item) => item && normalizeType(item.type) === "paper",
    );

    if (!queue.length) return;

    let nextIndex = 0;
    let active = 0;

    const runNext = () => {
      while (active < concurrency && nextIndex < queue.length) {
        const item = queue[nextIndex++];
        active += 1;

        get(item)
          .catch(() => null)
          .finally(() => {
            active -= 1;
            runNext();
          });
      }
    };

    if (
      typeof window !== "undefined" &&
      typeof window.requestIdleCallback === "function"
    ) {
      window.requestIdleCallback(() => runNext(), { timeout: 1500 });
    } else {
      setTimeout(runNext, 0);
    }
  }

  return {
    getCached,
    get,
    preload,
  };
})();
