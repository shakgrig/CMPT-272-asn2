function inferCoverSource(url) {
  const value = String(url || "");
  if (!value) return "none";
  if (value.includes("covers.openlibrary.org")) return "openlibrary";
  if (value.includes("coverartarchive.org")) return "coverartarchive";
  if (value.includes("wikimedia.org") || value.includes("wikipedia.org"))
    return "wikipedia";
  if (value.startsWith("data:image/")) return "inline-placeholder";
  if (value.includes("placeholder_viewboxed_600x900_combo.svg"))
    return "static-placeholder";
  return "other";
}

function normalizeTypeForDebug(type) {
  if (typeof normalizeType === "function") {
    return normalizeType(type);
  }

  return String(type || "")
    .trim()
    .toLowerCase();
}

function clearCoverCacheForDebug() {
  if (typeof clearLocalStorage === "function") {
    clearLocalStorage();
  }
}

async function runCatalogCoverage(items = [], options = {}) {
  const { clearCacheFirst = true, includeTypes = [] } = options || {};
  const getCoverFn = typeof getCover === "function" ? getCover : null;

  if (!Array.isArray(items)) {
    throw new Error(
      "runCatalogCoverage expects an array of parsed catalog items.",
    );
  }

  if (!getCoverFn) {
    throw new Error(
      "runCatalogCoverage requires ImageGetter.js (getCover) to be loaded.",
    );
  }

  if (clearCacheFirst) clearCoverCacheForDebug();

  let workingItems = items
    .filter((item) => item && typeof item === "object")
    .map((item) => ({
      title: String(item.title || "").trim(),
      type: String(item.type || "").trim(),
      author: String(item.author || "").trim(),
      year: String(item.year ?? "").trim(),
      genre: String(item.genre || "").trim(),
      rating: String(item.rating ?? "").trim(),
      description: String(item.description || "").trim(),
    }));

  if (Array.isArray(includeTypes) && includeTypes.length > 0) {
    const set = new Set(includeTypes.map((v) => normalizeTypeForDebug(v)));
    workingItems = workingItems.filter((item) =>
      set.has(normalizeTypeForDebug(item.type)),
    );
  }

  const report = {
    total: workingItems.length,
    byType: {},
    bySource: {},
    wikiPathCounts: {},
    rows: [],
  };

  for (const item of workingItems) {
    const type = normalizeTypeForDebug(item.type) || "unknown";
    const coverUrl = await getCoverFn(item);
    const source = inferCoverSource(coverUrl);
    const resolved = Boolean(coverUrl);

    const row = {
      title: item.title,
      type,
      year: item.year,
      source,
      usedWikipedia: source === "wikipedia",
      resolved,
      coverUrl: coverUrl || null,
      wikiPath: source === "wikipedia" ? "lead-image" : "n/a",
    };

    if (source === "wikipedia") {
      report.wikiPathCounts["lead-image"] =
        (report.wikiPathCounts["lead-image"] || 0) + 1;
    }

    const typeStats = report.byType[type] || {
      total: 0,
      resolved: 0,
      unresolved: 0,
    };
    typeStats.total += 1;
    typeStats.resolved += resolved ? 1 : 0;
    typeStats.unresolved += resolved ? 0 : 1;
    report.byType[type] = typeStats;

    report.bySource[source] = (report.bySource[source] || 0) + 1;
    report.rows.push(row);
  }

  return report;
}

function printCsvCoverage(report) {
  if (!report || typeof report !== "object") {
    console.warn("No report provided to printCsvCoverage.");
    return null;
  }

  console.log("Cover coverage report:", report);

  const typeTable = Object.entries(report.byType || {}).map(
    ([type, stats]) => ({
      type,
      total: stats.total,
      resolved: stats.resolved,
      unresolved: stats.unresolved,
    }),
  );
  if (typeTable.length) console.table(typeTable);

  const sourceTable = Object.entries(report.bySource || {}).map(
    ([source, count]) => ({ source, count }),
  );
  if (sourceTable.length) console.table(sourceTable);

  const wikiTable = Object.entries(report.wikiPathCounts || {}).map(
    ([path, count]) => ({ path, count }),
  );
  if (wikiTable.length) console.table(wikiTable);

  if (Array.isArray(report.rows) && report.rows.length) {
    console.table(
      report.rows.map((row) => ({
        title: row.title,
        type: row.type,
        source: row.source,
        usedWikipedia: row.usedWikipedia,
        wikiPath: row.wikiPath || "n/a",
        resolved: row.resolved,
      })),
    );
  }

  return report;
}

globalThis.COVER_DEBUG = {
  runCatalogCoverage,
  printCsvCoverage,
  clearLocalStorage: clearCoverCacheForDebug,
};
