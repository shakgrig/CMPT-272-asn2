"use strict";

const CATALOG_PAPER_METADATA_PROVIDER = (() => {
  const CROSSREF_WORKS_URL = "https://api.crossref.org/works";
  const metadataMap = new Map();
  const pendingMap = new Map();

  function safeText(value) {
    return String(value ?? "").trim();
  }

  function normalizeType(type) {
    return String(type || "")
      .trim()
      .toLowerCase();
  }

  function isValidYear(year) {
    const n = Number(year);
    return Number.isFinite(n) && n > 1000 && n < 3000;
  }

  function getItemKey(item) {
    return [
      safeText(item?.title),
      safeText(item?.type),
      safeText(item?.author),
      String(item?.year ?? "").trim(),
    ].join("|");
  }

  function normalizeForMatch(value) {
    return String(value || "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
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

  function extractYearFromDateParts(dateParts) {
    const year = Number(dateParts?.[0]?.[0]);
    return Number.isFinite(year) ? year : null;
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

  function getCrossrefYear(work) {
    return (
      extractYearFromDateParts(work?.issued?.["date-parts"]) ||
      extractYearFromDateParts(work?.["published-print"]?.["date-parts"]) ||
      extractYearFromDateParts(work?.["published-online"]?.["date-parts"]) ||
      extractYearFromDateParts(work?.created?.["date-parts"]) ||
      null
    );
  }

  function isSpringerDoi(doi) {
    return /^10\.(1007|1186)\//i.test(normalizeDoi(doi));
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

  function getCached(item) {
    return metadataMap.get(getItemKey(item)) || null;
  }

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
