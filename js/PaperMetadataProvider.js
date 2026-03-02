"use strict";

const CATALOG_PAPER_METADATA_PROVIDER = (function () {
  const CROSSREF_WORKS_URL = "https://api.crossref.org/works";
  const metadataMap = new Map();
  const pendingMap = new Map();

  /**
   * Converts unknown values to trimmed strings.
   * @param {any} value Input value.
   * @returns {string} Trimmed string result.
   */
  function safeText(value) {
    return String(value == null ? "" : value).trim();
  }

  /**
   * Normalizes a type label for comparisons.
   * @param {string} type Raw type string.
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
   * @returns {boolean} True when finite.
   */
  function isValidYear(year) {
    return Number.isFinite(Number(year));
  }

  /**
   * Builds a stable cache key from core item fields.
   * @param {{title?:string,type?:string,author?:string,year?:number|string}} item Catalog item.
   * @returns {string} Cache key.
   */
  function getItemKey(item) {
    return [
      safeText(item && item.title),
      safeText(item && item.type),
      safeText(item && item.author),
      safeText(item && item.year),
    ].join("|");
  }

  /**
   * Normalizes text for fuzzy matching.
   * @param {string} value Text input.
   * @returns {string} Tokenized lowercase string.
   */
  function normalizeForMatch(value) {
    return String(value || "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  }

  /**
   * Normalizes DOI values by removing resolver prefixes.
   * @param {string} value DOI or DOI URL.
   * @returns {string} DOI token.
   */
  function normalizeDoi(value) {
    return String(value || "")
      .trim()
      .replace(/^https?:\/\/(dx\.)?doi\.org\//i, "");
  }

  /**
   * Converts DOI text to canonical DOI URL.
   * @param {string} doi DOI text.
   * @returns {string|null} DOI URL or null.
   */
  function toDoiUrl(doi) {
    const normalized = normalizeDoi(doi);
    if (!normalized) return null;
    return `https://doi.org/${normalized}`;
  }

  /**
   * Returns only safe HTTP(S) URLs.
   * @param {string} url Candidate URL.
   * @returns {string|null} Safe URL or null.
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
   * Extracts publication year from Crossref date-parts arrays.
   * @param {any} dateParts Crossref date-parts value.
   * @returns {number|null} Year or null.
   */
  function extractYearFromDateParts(dateParts) {
    const year = Number(
      dateParts && dateParts[0] && dateParts[0][0] ? dateParts[0][0] : NaN,
    );
    return Number.isFinite(year) ? year : null;
  }

  /**
   * Reads the first title from a Crossref work object.
   * @param {any} work Crossref work.
   * @returns {string} Title text.
   */
  function getCrossrefWorkTitle(work) {
    if (work && Array.isArray(work.title) && work.title.length > 0) {
      return String(work.title[0] || "").trim();
    }
    return "";
  }

  /**
   * Builds a flat author string from Crossref author entries.
   * @param {any} work Crossref work.
   * @returns {string} Author text for matching.
   */
  function getCrossrefAuthorText(work) {
    if (!work || !Array.isArray(work.author)) return "";

    const names = [];

    for (let i = 0; i < work.author.length; i++) {
      const author = work.author[i] || {};
      const given = String(author.given || "").trim();
      const family = String(author.family || "").trim();
      const name = String(author.name || "").trim();
      const full = `${given} ${family}`.trim() || name;
      if (full) names.push(full);
    }

    return names.join(" ");
  }

  /**
   * Gets the best available year from Crossref fields.
   * @param {any} work Crossref work.
   * @returns {number|null} Publication year or null.
   */
  function getCrossrefYear(work) {
    return (
      extractYearFromDateParts(
        work && work.issued && work.issued["date-parts"],
      ) ||
      extractYearFromDateParts(
        work &&
          work["published-print"] &&
          work["published-print"]["date-parts"],
      ) ||
      extractYearFromDateParts(
        work &&
          work["published-online"] &&
          work["published-online"]["date-parts"],
      ) ||
      extractYearFromDateParts(
        work && work.created && work.created["date-parts"],
      ) ||
      null
    );
  }

  /**
   * Checks whether a DOI appears to be from Springer namespaces.
   * @param {string} doi DOI value.
   * @returns {boolean} True for Springer-like DOIs.
   */
  function isSpringerDoi(doi) {
    return /^10\.(1007|1186)\//i.test(normalizeDoi(doi));
  }

  /**
   * Heuristic check for image-like URL extensions.
   * @param {string} url Candidate URL.
   * @returns {boolean} True when URL looks like an image asset.
   */
  function isLikelyImageUrl(url) {
    return /\.(png|jpe?g|gif|webp|svg)(\?|#|$)/i.test(String(url || ""));
  }

  /**
   * Picks a likely image URL from Crossref link entries.
   * @param {any} work Crossref work.
   * @returns {string|null} Image URL when available.
   */
  function pickCrossrefImageUrl(work) {
    const links = work && Array.isArray(work.link) ? work.link : [];

    for (let i = 0; i < links.length; i++) {
      const contentType = String(
        links[i] && links[i]["content-type"] ? links[i]["content-type"] : "",
      ).toLowerCase();
      if (contentType.startsWith("image/") && links[i].URL) {
        return String(links[i].URL);
      }
    }

    for (let i = 0; i < links.length; i++) {
      const candidate = String(links[i] && links[i].URL ? links[i].URL : "");
      if (isLikelyImageUrl(candidate)) {
        return candidate;
      }
    }

    return null;
  }

  /**
   * Extracts Springer journal ID from DOI text.
   * @param {string} doi DOI value.
   * @returns {string|null} Journal ID.
   */
  function extractSpringerJournalIdFromDoi(doi) {
    const match = normalizeDoi(doi).match(
      /^10\.(1007|1186)\/s(\d{4,6})(?:[-/]|$)/i,
    );
    return match ? match[2] : null;
  }

  /**
   * Extracts Springer journal ID from landing page URL.
   * @param {string} url Landing URL.
   * @returns {string|null} Journal ID.
   */
  function extractSpringerJournalIdFromUrl(url) {
    const match = String(url || "").match(/\/journal\/(\d{4,6})(?:[/?#]|$)/i);
    return match ? match[1] : null;
  }

  /**
   * Builds potential Springer journal cover URLs.
   * @param {string|null} journalId Springer journal ID.
   * @returns {string[]} Candidate cover URLs.
   */
  function buildSpringerJournalCoverCandidates(journalId) {
    if (!journalId) return [];
    return [
      `https://media.springernature.com/full/springer-static/cover-hires/journal/${journalId}`,
      `https://media.springernature.com/w158/springer-static/cover-hires/journal/${journalId}`,
    ];
  }

  /**
   * Tests whether an image URL can be loaded by the browser.
   * @param {string} imageSrc Candidate image URL.
   * @returns {Promise<boolean>} True when image loads successfully.
   */
  function canLoadImageUrl(imageSrc) {
    return new Promise(function (resolve) {
      const safeUrl = toSafeHttpUrl(imageSrc);
      if (!safeUrl) {
        resolve(false);
        return;
      }

      const img = new Image();
      let finished = false;

      function done(ok) {
        if (finished) return;
        finished = true;
        resolve(ok);
      }

      const timeoutId = setTimeout(function () {
        done(false);
      }, 5000);

      img.onload = function () {
        clearTimeout(timeoutId);
        done(true);
      };

      img.onerror = function () {
        clearTimeout(timeoutId);
        done(false);
      };

      img.src = safeUrl;
    });
  }

  /**
   * Resolves a working Springer journal cover URL using DOI/landing URL hints.
   * @param {string} doi DOI value.
   * @param {string} landingUrl Landing page URL.
   * @returns {Promise<string|null>} First loadable cover URL or null.
   */
  async function resolveSpringerJournalCoverUrl(doi, landingUrl) {
    const journalId =
      extractSpringerJournalIdFromDoi(doi) ||
      extractSpringerJournalIdFromUrl(landingUrl);

    if (!journalId) return null;

    const candidates = buildSpringerJournalCoverCandidates(journalId);

    for (let i = 0; i < candidates.length; i++) {
      if (await canLoadImageUrl(candidates[i])) {
        return candidates[i];
      }
    }

    return null;
  }

  /**
   * Scores Crossref works against item title/author/year hints.
   * @param {any} work Crossref work candidate.
   * @param {{title?:string,author?:string,year?:number|string}} item Catalog item.
   * @returns {number} Higher score indicates a stronger match.
   */
  function scoreCrossrefCandidate(work, item) {
    const targetTitle = normalizeForMatch(item && item.title);
    const targetAuthor = normalizeForMatch(item && item.author);
    const targetYear = isValidYear(item && item.year)
      ? Number(item.year)
      : null;

    const workTitle = normalizeForMatch(getCrossrefWorkTitle(work));
    const workAuthor = normalizeForMatch(getCrossrefAuthorText(work));
    const workYear = getCrossrefYear(work);
    const workType = String(work && work.type ? work.type : "").toLowerCase();
    const workDoi = normalizeDoi(work && work.DOI);

    let score = 0;

    if (targetTitle && workTitle === targetTitle) score += 6;
    else if (targetTitle && workTitle.includes(targetTitle)) score += 3;

    if (targetAuthor && workAuthor.includes(targetAuthor)) score += 3;
    if (targetYear && workYear && targetYear === workYear) score += 2;

    if (isSpringerDoi(workDoi)) score += 2;
    if (workType === "journal-article") score += 2;
    if (workType === "posted-content") score -= 2;
    if (/^10\.21203\//i.test(workDoi)) score -= 2;

    return score;
  }

  /**
   * Fetches and normalizes metadata for a paper item using Crossref.
   * Includes DOI/landing URL and optional image URL resolution.
   * @param {{title?:string,author?:string,year?:number|string}} item Paper item.
   * @returns {Promise<{doi:string|null,doiUrl:string|null,landingUrl:string|null,imageUrl:string|null,source:string}|null>} Metadata object or null.
   */
  async function fetchPaperMetadata(item) {
    const title = safeText(item && item.title);
    if (!title) return null;

    const author = safeText(item && item.author);
    const year = isValidYear(item && item.year) ? String(item.year) : "";

    const queryParts = [];
    if (title) queryParts.push(title);
    if (author) queryParts.push(author);
    if (year) queryParts.push(year);

    const params = new URLSearchParams({
      "query.bibliographic": queryParts.join(" "),
      rows: "8",
      select:
        "DOI,URL,title,author,issued,published-print,published-online,created,link,type",
    });

    const res = await fetch(`${CROSSREF_WORKS_URL}?${params}`);
    if (!res.ok) throw new Error(`Crossref request failed (${res.status})`);

    const data = await res.json();
    const works =
      data && data.message && Array.isArray(data.message.items)
        ? data.message.items
        : [];

    if (!works.length) return null;

    let bestWork = null;
    let bestScore = -Infinity;

    for (let i = 0; i < works.length; i++) {
      const score = scoreCrossrefCandidate(works[i], item);
      if (score > bestScore) {
        bestScore = score;
        bestWork = works[i];
      }
    }

    if (!bestWork) return null;

    const doi = normalizeDoi(bestWork.DOI);
    const doiUrl = toSafeHttpUrl(toDoiUrl(doi));
    const landingUrl = toSafeHttpUrl(bestWork.URL) || doiUrl || null;

    let imageUrl = toSafeHttpUrl(pickCrossrefImageUrl(bestWork));

    if (!imageUrl) {
      imageUrl = await resolveSpringerJournalCoverUrl(doi, landingUrl);

      if (!imageUrl) {
        for (let i = 0; i < works.length; i++) {
          if (isSpringerDoi(works[i] && works[i].DOI)) {
            imageUrl = await resolveSpringerJournalCoverUrl(
              works[i].DOI,
              works[i].URL,
            );
            if (imageUrl) break;
          }
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
   * Gets cached metadata for an item when available.
   * @param {{title?:string,type?:string,author?:string,year?:number|string}} item Catalog item.
   * @returns {Object|null} Cached metadata or null.
   */
  function getCached(item) {
    const key = getItemKey(item);
    return metadataMap.has(key) ? metadataMap.get(key) : null;
  }

  /**
   * Gets metadata for an item with in-flight request de-duplication.
   * @param {{title?:string,type?:string,author?:string,year?:number|string}} item Catalog item.
   * @returns {Promise<Object|null>} Metadata object or null.
   */
  async function get(item) {
    const key = getItemKey(item);

    if (metadataMap.has(key)) {
      return metadataMap.get(key);
    }

    if (pendingMap.has(key)) {
      return pendingMap.get(key);
    }

    const pending = fetchPaperMetadata(item)
      .then(function (metadata) {
        const value = metadata || null;
        metadataMap.set(key, value);
        return value;
      })
      .catch(function () {
        metadataMap.set(key, null);
        return null;
      })
      .finally(function () {
        pendingMap.delete(key);
      });

    pendingMap.set(key, pending);
    return pending;
  }

  /**
   * Starts background metadata preloading for paper items.
   * @param {Array<{type?:string}>} [items=[]] Candidate catalog items.
   * @param {{concurrency?:number}} [options={}] Optional preload settings.
   * @returns {void}
   */
  function preload(items = [], options = {}) {
    const requested = Number(options.concurrency);
    const concurrency = Number.isFinite(requested)
      ? Math.min(4, Math.max(1, Math.floor(requested)))
      : 1;

    const queue = [];

    if (Array.isArray(items)) {
      for (let i = 0; i < items.length; i++) {
        if (items[i] && normalizeType(items[i].type) === "paper") {
          queue.push(items[i]);
        }
      }
    }

    if (!queue.length) return;

    let nextIndex = 0;
    let active = 0;

    function runNext() {
      while (active < concurrency && nextIndex < queue.length) {
        const item = queue[nextIndex];
        nextIndex += 1;
        active += 1;

        get(item)
          .catch(function () {
            return null;
          })
          .finally(function () {
            active -= 1;
            runNext();
          });
      }
    }

    if (
      typeof window !== "undefined" &&
      typeof window.requestIdleCallback === "function"
    ) {
      window.requestIdleCallback(
        function () {
          runNext();
        },
        { timeout: 1500 },
      );
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
