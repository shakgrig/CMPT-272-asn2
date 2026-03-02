"use strict";

/**
 * @typedef {Object} LoadedCatalogItem
 * @property {string} [title] Human-readable item title shown in cards and modal titles.
 * @property {string} [type] Catalog type (for example: book, movie, tv, game, music, paper, etc.).
 * @property {string} [author] Primary author/creator/artist label.
 * @property {number|string} [year] Release/publication year used for display and sorting.
 * @property {string} [genre] Genre/category label displayed as a card badge.
 * @property {number|string} [rating] Numeric rating value that is formatted to one decimal place.
 * @property {string} [description] Long-form description rendered in modal details.
 * @property {HTMLElement} [cardElement] Prebuilt card node cached after async rendering.
 * @property {(params?: {type?: string}) => boolean} [matchesFilter] Predicate used by UI filtering.
 */

window.addEventListener("load", init);

const fileInput = document.getElementById("fileUpload");
const typeSelect = document.getElementById("typeSelect");
const sortSelect = document.getElementById("sortSelect");
const resultsContainer = document.getElementById("results");
// const results = document.getElementById("results");
const tempHeader = document.querySelector(".temp-header");
const tempSubHeader = document.querySelector(".temp-sub-header");
const themeMenuButton = document.getElementById("themeMenuButton");
const themeButtonIcon = themeMenuButton?.querySelector(".theme-icon");
const themeButtonLabel = themeMenuButton?.querySelector(".theme-button-label");
const themeButtonSr = themeMenuButton?.querySelector(".theme-button-sr");
const themeOptionInputs = Array.from(
  document.querySelectorAll('input[name="theme"]'),
);
const DEFAULT_PLACEHOLDER_IMG = "assets/placeholder_viewboxed_600x900.svg";
// const STORAGE_TYPE = USE_LOCAL_STORAGE ? localStorage : sessionStorage;
let loadedCatalogItems = [];

const THEME_DISPLAY = {
  "theme-light": { icon: "\u2600", label: "Light" },
  "theme-dark": { icon: "\u263D", label: "Dark" },
  "theme-system": { icon: "\u{1F5B3}", label: "System" },
};

/**
 * Returns the default placeholder cover source.
 * Prefers the shared placeholder helper when available, otherwise falls back
 * to the static asset path configured in this file.
 * @returns {string} Placeholder image source safe for immediate `<img src>` usage.
 */
function getDefaultPlaceholderImg() {
  if (typeof getPlaceholderSrc === "function") {
    return getPlaceholderSrc();
  }

  return DEFAULT_PLACEHOLDER_IMG;
}

/**
 * Checks whether a source refers to one of the placeholder image variants.
 * @param {string} src Candidate URL/data URI to classify.
 * @returns {boolean} True when the source points to generated placeholder art.
 */
function isPlaceholderImageSource(src) {
  const value = String(src || "");
  if (!value) return false;
  if (value.startsWith("data:image/svg+xml")) return true;
  return value.includes("placeholder_viewboxed_600x900");
}

/**
 * Creates an inline SVG placeholder element when helper support is available.
 * @param {string} [className=""] CSS classes applied to the generated SVG element.
 * @param {string} [altText="Item cover"] Accessible text announced by screen readers.
 * @returns {SVGElement|null} SVG node when helper APIs are present; otherwise null.
 */
function createInlinePlaceholderElement(
  className = "",
  altText = "Item cover",
) {
  if (typeof createPlaceholderSvgElement !== "function") return null;

  const svg = createPlaceholderSvgElement(className);
  if (!svg) return null;

  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", altText);
  return svg;
}

// function getDefaultPlaceholderImg() {
//   const svg = `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="300 150 600 900" preserveAspectRatio="xMidYMid meet"><rect x="300" y="150" width="600" height="900" fill="var(--placeholder-bg)" rx="3"/><g opacity=".5"><g opacity=".5"><path fill="var(--placeholder-outer)" d="M600.709 736.5c-75.454 0-136.621-61.167-136.621-136.62 0-75.454 61.167-136.621 136.621-136.621 75.453 0 136.62 61.167 136.62 136.621 0 75.453-61.167 136.62-136.62 136.62Z"/><path stroke="var(--placeholder-stroke)" stroke-width="2.418" d="M600.709 736.5c-75.454 0-136.621-61.167-136.621-136.62 0-75.454 61.167-136.621 136.621-136.621 75.453 0 136.62 61.167 136.62 136.621 0 75.453-61.167 136.62-136.62 136.62Z"/></g><path stroke="url(#a)" stroke-width="2.418" d="M0-1.209h553.581" transform="scale(1 -1) rotate(45 1163.11 91.165)"/><path stroke="url(#b)" stroke-width="2.418" d="M404.846 598.671h391.726"/><path stroke="url(#c)" stroke-width="2.418" d="M599.5 795.742V404.017"/><path stroke="url(#d)" stroke-width="2.418" d="m795.717 796.597-391.441-391.44"/><path fill="var(--placeholder-inner)" d="M600.709 656.704c-31.384 0-56.825-25.441-56.825-56.824 0-31.384 25.441-56.825 56.825-56.825 31.383 0 56.824 25.441 56.824 56.825 0 31.383-25.441 56.824-56.824 56.824Z"/><g clip-path="url(#e)"><path fill="var(--placeholder-icon)" fill-rule="evenodd" d="M616.426 586.58h-31.434v16.176l3.553-3.554.531-.531h9.068l.074-.074 8.463-8.463h2.565l7.18 7.181V586.58Zm-15.715 14.654 3.698 3.699 1.283 1.282-2.565 2.565-1.282-1.283-5.2-5.199h-6.066l-5.514 5.514-.073.073v2.876a2.418 2.418 0 0 0 2.418 2.418h26.598a2.418 2.418 0 0 0 2.418-2.418v-8.317l-8.463-8.463-7.181 7.181-.071.072Zm-19.347 5.442v4.085a6.045 6.045 0 0 0 6.046 6.045h26.598a6.044 6.044 0 0 0 6.045-6.045v-7.108l1.356-1.355-1.282-1.283-.074-.073v-17.989h-38.689v23.43l-.146.146.146.147Z" clip-rule="evenodd"/></g><path stroke="var(--placeholder-stroke)" stroke-width="2.418" d="M600.709 656.704c-31.384 0-56.825-25.441-56.825-56.824 0-31.384 25.441-56.825 56.825-56.825 31.383 0 56.824 25.441 56.824 56.825 0 31.383-25.441 56.824-56.824 56.824Z"/></g><defs><linearGradient id="a" x1="554.061" x2="-.48" y1=".083" y2=".087" gradientUnits="userSpaceOnUse"><stop stop-color="var(--placeholder-stroke)" stop-opacity="0"/><stop offset=".208" stop-color="var(--placeholder-stroke)"/><stop offset=".792" stop-color="var(--placeholder-stroke)"/><stop offset="1" stop-color="var(--placeholder-stroke)" stop-opacity="0"/></linearGradient><linearGradient id="b" x1="796.912" x2="404.507" y1="599.963" y2="599.965" gradientUnits="userSpaceOnUse"><stop stop-color="var(--placeholder-stroke)" stop-opacity="0"/><stop offset=".208" stop-color="var(--placeholder-stroke)"/><stop offset=".792" stop-color="var(--placeholder-stroke)"/><stop offset="1" stop-color="var(--placeholder-stroke)" stop-opacity="0"/></linearGradient><linearGradient id="c" x1="600.792" x2="600.794" y1="403.677" y2="796.082" gradientUnits="userSpaceOnUse"><stop stop-color="var(--placeholder-stroke)" stop-opacity="0"/><stop offset=".208" stop-color="var(--placeholder-stroke)"/><stop offset=".792" stop-color="var(--placeholder-stroke)"/><stop offset="1" stop-color="var(--placeholder-stroke)" stop-opacity="0"/></linearGradient><linearGradient id="d" x1="404.85" x2="796.972" y1="403.903" y2="796.02" gradientUnits="userSpaceOnUse"><stop stop-color="var(--placeholder-stroke)" stop-opacity="0"/><stop offset=".208" stop-color="var(--placeholder-stroke)"/><stop offset=".792" stop-color="var(--placeholder-stroke)"/><stop offset="1" stop-color="var(--placeholder-stroke)" stop-opacity="0"/></linearGradient><clipPath id="e"><path fill="var(--placeholder-icon)" d="M581.364 580.535h38.689v38.689h-38.689z"/></clipPath></defs></svg>`;
//   const blob = new Blob([svg], { type: "image/svg+xml" });
//   return URL.createObjectURL(blob); // returns a temporary object URL for img.src
// }

// function preloadCovers(items) {
//   items.forEach((item) => {
//     getCoverImage(item).catch(() => {});
//   });
// }
//
// function saveCoverToLocalStorage(item, src) {
//   try {
//     // STORAGE_TYPE.setItem("cover_" + item.getCacheKey(), src);
//     STORAGE_TYPE.setItem("cover_" + item.getCacheKey(), src);
//   } catch {
//     // ignore quota errors
//   }
// }
//
// function getCoverFromLocalStorage(item) {
//   // return STORAGE_TYPE.getItem("cover_" + item.getCacheKey());
//   return STORAGE_TYPE.getItem("cover_" + item.getCacheKey());
// }
//
// // Simple async function to get a cover
// async function getCoverImage(item) {
//   const key = item.getCacheKey();
//   if (CatalogItem.coverResolvedMap.has(key))
//     return CatalogItem.coverResolvedMap.get(key);
//
//   let src = getCoverFromLocalStorage(item);
//   if (src) {
//     CatalogItem.coverResolvedMap.set(key, src);
//     return src;
//   }
//
//   try {
//     if (typeof getCover === "function") src = await getCover(item);
//     if (!src && typeof getFallbackCoverForType === "function")
//       src = await getFallbackCoverForType(item);
//   } catch {
//     src = null;
//   }
//
//   if (!src) src = getDefaultPlaceholderImg();
//
//   CatalogItem.coverResolvedMap.set(key, src);
//   saveCoverToLocalStorage(item, src);
//
//   return src;
// }

/**
 * Initializes page behavior and CSV upload handling.
 * Registers filter/sort listeners, validates uploaded CSV content, parses rows,
 * materializes `CatalogItem` cards asynchronously, and then triggers first render.
 * @returns {void}
 */
function init() {
  footer();
  initThemeController();
  // clearLocalStorage();

  typeSelect?.addEventListener("change", applyFiltersAndSort);
  sortSelect?.addEventListener("change", applyFiltersAndSort);

  if (!fileInput) {
    console.error("fileInput element not found!");
    return;
  }

  fileInput.addEventListener("change", function (event) {
    const file = event.target.files[0];
    if (!file) return;

    if (!file.type.includes("text") && !file.name.endsWith(".csv")) {
      appendAlert("Please upload a valid text or CSV file.", "danger");
      return;
    }

    const reader = new FileReader();
    reader.onload = async function (e) {
      try {
        const parsedRows = e.target.result
          .split(/\r?\n/)
          .filter((line) => line.trim() !== "")
          .map((line) => line.split(",").map((cell) => cell.trim()));

        const header = parsedRows[0]?.map((cell) => cell.toLowerCase());
        const hasExpectedHeader =
          Array.isArray(header) &&
          header[0] === "title" &&
          header[1] === "type" &&
          header[2] === "author" &&
          header[3] === "year" &&
          header[4] === "genre" &&
          header[5] === "rating" &&
          header[6] === "description";

        const rows = hasExpectedHeader ? parsedRows.slice(1) : parsedRows;
        const catalogItems = rows.map((row) => new CatalogItem(...row));
        loadedCatalogItems = catalogItems;
        window.LAST_CATALOG_ITEMS = catalogItems;

        populateTypeOptions(catalogItems);
        if (typeSelect) typeSelect.value = "all";
        if (sortSelect) sortSelect.selectedIndex = 0;

        for (const item of catalogItems) {
          item.cardElement = await item.toCard();
        }
        // catalogItems.forEach((item) => {
        //   results.appendChild(item.toCard());
        // });

        applyFiltersAndSort();
        hideTempHeaders(catalogItems);
        // preloadCovers(catalogItems);

        requestAnimationFrame(() => {
          CatalogItem.preloadCoverImagesInBackground(catalogItems, {
            concurrency: 1,
          });
        });

        appendAlert("Successfully loaded CSV", "success");
      } catch (error) {
        console.error("Error parsing file:", error);
        appendAlert(`Error parsing file: ${error}`, "danger");
      }
    };
    reader.readAsText(file);
  });
}

/**
 * Sets up theme menu events and initial state.
 * Wires radio inputs to update button icon/label and closes the dropdown after selection.
 * @returns {void}
 */
function initThemeController() {
  if (!themeOptionInputs.length || !themeMenuButton) return;

  themeOptionInputs.forEach((input) => {
    input.addEventListener("change", () => {
      if (!input.checked) return;
      syncThemeButtonState();
      closeThemeDropdown();
    });
  });

  syncThemeButtonState();
}

/**
 * Closes the Bootstrap theme dropdown if available.
 * Safely no-ops when Bootstrap JS is not loaded.
 * @returns {void}
 */
function closeThemeDropdown() {
  if (!themeMenuButton || !window.bootstrap?.Dropdown) return;

  const dropdown =
    window.bootstrap.Dropdown.getOrCreateInstance(themeMenuButton);
  dropdown.hide();
}

/**
 * Synchronizes the theme button icon/label with the selected radio input.
 * Also updates accessible screen-reader text and tooltip title.
 * @returns {void}
 */
function syncThemeButtonState() {
  if (!themeMenuButton) return;

  const selectedInput =
    themeOptionInputs.find((input) => input.checked) ||
    document.getElementById("theme-system");
  const key = selectedInput?.id || "theme-system";
  const display = THEME_DISPLAY[key] || THEME_DISPLAY["theme-system"];

  if (themeButtonIcon) themeButtonIcon.textContent = display.icon;
  if (themeButtonLabel) themeButtonLabel.textContent = display.label;
  if (themeButtonSr) {
    themeButtonSr.textContent = `Theme menu, current: ${display.label}`;
  }

  themeMenuButton.title = `Theme: ${display.label}`;
}

const toastContainer = document.getElementById("liveToastContainer");

/**
 * Shows a Bootstrap toast alert in the live toast region.
 * @param {string} message Text content displayed inside the toast body.
 * @param {"success"|"danger"|"warning"|"info"|string} type Semantic style key. Unknown values are normalized to "info".
 * @returns {void}
 */
function appendAlert(message, type) {
  if (!toastContainer) return;

  const normalizedType =
    type === "success" || type === "danger" || type === "warning"
      ? type
      : "info";
  const isError = normalizedType === "danger";

  const toastEl = document.createElement("div");
  toastEl.className = `toast align-items-center app-toast app-toast-${normalizedType}`;
  toastEl.setAttribute("role", isError ? "alert" : "status");
  toastEl.setAttribute("aria-live", isError ? "assertive" : "polite");
  toastEl.setAttribute("aria-atomic", "true");
  toastEl.innerHTML = `
    <section class="d-flex">
      <p class="toast-body mb-0"></p>
      <button type="button" class="btn-close me-2 m-auto" data-bs-dismiss="toast" aria-label="Close"></button>
    </section>
  `;

  const body = toastEl.querySelector(".toast-body");
  if (body) body.textContent = String(message || "");

  toastContainer.appendChild(toastEl);

  toastEl.addEventListener("hidden.bs.toast", () => {
    toastEl.remove();
  });

  if (!window.bootstrap?.Toast) return;
  const instance = window.bootstrap.Toast.getOrCreateInstance(toastEl, {
    autohide: true,
    delay: 3500,
  });
  instance.show();
};

/**
 * Shows/hides empty-state header text based on rendered catalog size.
 * @param {LoadedCatalogItem[]} catalogItems Current result set after filter/sort.
 * @returns {void}
 */
function hideTempHeaders(catalogItems) {
  tempHeader.style.display = catalogItems.length ? "none" : "block";
  tempSubHeader.style.display = catalogItems.length ? "none" : "block";
}

/**
 * Populates the type filter dropdown from available item types.
 * Preserves the previous selection when it still exists in the rebuilt option list.
 * @param {LoadedCatalogItem[]} items Source items used to derive unique type values.
 * @returns {void}
 */
function populateTypeOptions(items) {
  if (!typeSelect) return;

  const previousType = uiNormalizeType(typeSelect.value || "all");
  const uniqueTypes = [
    ...new Set(items.map((item) => uiNormalizeType(item.type))),
  ]
    .filter(Boolean)
    .sort();

  typeSelect.innerHTML = "";

  const allOption = document.createElement("option");
  allOption.value = "all";
  allOption.textContent = "All";
  typeSelect.appendChild(allOption);

  for (const type of uniqueTypes) {
    const option = document.createElement("option");
    option.value = type;
    option.textContent = type;
    typeSelect.appendChild(option);
  }

  typeSelect.value = uniqueTypes.includes(previousType) ? previousType : "all";
}

/**
 * Compares two catalog items using the selected sort key.
 * Numeric keys (`year`, `rating`) are compared numerically; all others use
 * locale-aware, case-insensitive string comparison.
 * @param {LoadedCatalogItem} a Left-hand item in sort comparator.
 * @param {LoadedCatalogItem} b Right-hand item in sort comparator.
 * @param {string} sortKey Active normalized key from the sort dropdown.
 * @returns {number} Negative when `a < b`, positive when `a > b`, otherwise 0.
 */
function compareCatalogItems(a, b, sortKey) {
  if (sortKey === "year" || sortKey === "rating") {
    const aNum = Number(a?.[sortKey]);
    const bNum = Number(b?.[sortKey]);
    const aValue = Number.isFinite(aNum) ? aNum : Number.NEGATIVE_INFINITY;
    const bValue = Number.isFinite(bNum) ? bNum : Number.NEGATIVE_INFINITY;
    return aValue - bValue;
  }

  const aValue = String(a?.[sortKey] ?? "");
  const bValue = String(b?.[sortKey] ?? "");
  return aValue.localeCompare(bValue, undefined, { sensitivity: "base" });
}

/**
 * Applies active type filter and sort options, then re-renders results.
 * Uses `matchesFilter` for type checks and a title-based tie-breaker for stable output.
 * @returns {void}
 */
function applyFiltersAndSort() {
  if (!resultsContainer) return;

  const selectedType = uiNormalizeType(typeSelect?.value || "all");
  const selectedSort = uiNormalizeType(sortSelect?.value || "none");

  const visibleItems = loadedCatalogItems.filter((item) =>
    item.matchesFilter({ type: selectedType }),
  );

  if (selectedSort !== "none") {
    visibleItems.sort((a, b) => {
      const result = compareCatalogItems(a, b, selectedSort);
      if (result !== 0) return result;
      return String(a.title).localeCompare(String(b.title), undefined, {
        sensitivity: "base",
      });
    });
  }

  resultsContainer.innerHTML = "";
  for (const item of visibleItems) {
    if (item.cardElement) {
      resultsContainer.appendChild(item.cardElement);
    }
  }
}

/**
 * Normalizes a UI type value for stable matching.
 * @param {string} type Raw string from dropdowns or item fields.
 * @returns {string} Lowercased, trimmed token suitable for equality checks.
 */
function uiNormalizeType(type) {
  return String(type || "")
    .trim()
    .toLowerCase();
}

/**
 * Parses and formats ratings to one decimal place.
 * @param {number|string|null|undefined} value Candidate rating value from parsed CSV.
 * @returns {string|null} Formatted numeric string (for example `"4.5"`) or null when invalid.
 */
function uiSafeRating(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return n.toFixed(1);
}

/**
 * Validates year values for display.
 * @param {number|string|null|undefined} year Candidate year value.
 * @returns {boolean} True when value is finite and within a human-expected range.
 */
function uiIsValidYear(year) {
  const n = Number(year);
  return Number.isFinite(n) && n > 1000 && n < 3000;
}

/**
 * Escapes HTML special characters for safe text insertion.
 * @param {string} text Untrusted text that will be inserted into `innerHTML`.
 * @returns {string} Escaped text safe for HTML interpolation.
 */
function uiEscapeHtml(text) {
  return String(text || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/**
 * Returns a sanitized absolute HTTP/HTTPS URL.
 * @param {string} url Candidate URL from item metadata.
 * @returns {string|null} Absolute URL string when protocol is safe; otherwise null.
 */
function uiToSafeHttpUrl(url) {
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
 * Converts a JSON string into syntax-highlighted HTML spans.
 * Produces escaped HTML and wraps keys/strings/booleans/numbers with classed spans
 * used by the modal raw-data viewer.
 * @param {string} json Raw JSON string to highlight.
 * @returns {string} HTML fragment with semantic span wrappers.
 */
function highlightJSON(json) {
  const escaped = json
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  return escaped.replace(
    /("(?:\\.|[^"\\])*")(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d+)?/g,
    (match, string, isKey, literal) => {
      if (string) {
        return isKey
          ? `<span class="json-key">${string}</span>${isKey}`
          : `<span class="json-string">${string}</span>`;
      }
      if (literal) {
        return `<span class="json-boolean">${literal}</span>`;
      }
      return `<span class="json-number">${match}</span>`;
    },
  );
}

/**
 * Updates the footer's last-update text.
 * Uses a fixed assignment date (not runtime "now") for deterministic display.
 * @returns {void}
 */
function footer() {
  const lastUpdate = new Date(2026, 1, 20);

  document.getElementById("last-update").textContent =
    `Last Update: ${lastUpdate.toLocaleString("en-CA", { dateStyle: "long" })}`;
}
