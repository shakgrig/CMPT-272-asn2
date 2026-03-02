"use strict";

window.addEventListener("load", init);

const fileInput = document.getElementById("fileUpload");
const typeSelect = document.getElementById("typeSelect");
const sortSelect = document.getElementById("sortSelect");
const resultsContainer = document.getElementById("results");
const tempHeader = document.querySelector(".temp-header");
const tempSubHeader = document.querySelector(".temp-sub-header");
const toastContainer = document.getElementById("liveToastContainer");

const themeMenuButton = document.getElementById("themeMenuButton");
const themeButtonIcon = themeMenuButton
  ? themeMenuButton.querySelector(".theme-icon")
  : null;
const themeButtonLabel = themeMenuButton
  ? themeMenuButton.querySelector(".theme-button-label")
  : null;
const themeButtonSr = themeMenuButton
  ? themeMenuButton.querySelector(".theme-button-sr")
  : null;

const DEFAULT_PLACEHOLDER_IMG = "assets/placeholder_viewboxed_600x900.svg";

let loadedCatalogItems = [];

/**
 * Gets the default cover placeholder image source.
 * Uses the shared placeholder helper when available.
 * @returns {string} Placeholder image URL or data URI.
 */
function getDefaultPlaceholderImg() {
  if (typeof getPlaceholderSrc === "function") {
    return getPlaceholderSrc();
  }

  return DEFAULT_PLACEHOLDER_IMG;
}

/**
 * Checks whether a given image source is one of this app's placeholder variants.
 * @param {string} src Image source to inspect.
 * @returns {boolean} True when the source represents a placeholder image.
 */
function isPlaceholderImageSource(src) {
  const value = String(src || "");
  if (value === "") return false;
  if (value.startsWith("data:image/svg+xml")) return true;
  return value.includes("placeholder_viewboxed_600x900");
}

/**
 * Creates an inline SVG placeholder element for image slots.
 * @param {string} [className=""] CSS classes for the generated SVG.
 * @param {string} [altText="Item cover"] Accessible label for screen readers.
 * @returns {SVGElement|null} SVG placeholder element, or null when helper is unavailable.
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

/**
 * Initializes page interactions and upload workflow.
 * Wires UI events, parses CSV input, renders cards, and triggers initial preloading.
 * @returns {void}
 */
function init() {
  footer();
  initThemeController();

  if (typeSelect) typeSelect.addEventListener("change", applyFiltersAndSort);
  if (sortSelect) sortSelect.addEventListener("change", applyFiltersAndSort);

  if (!fileInput) {
    console.error("fileInput element not found!");
    return;
  }

  fileInput.addEventListener("change", function (event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();

    reader.onload = async function (e) {
      try {
        const parsedRows = parseCsvText(String(e.target.result || ""));

        // Assume the CSV has the expected header in row 0.
        const rows = parsedRows.slice(1);

        const catalogItems = [];
        for (let i = 0; i < rows.length; i++) {
          catalogItems.push(new CatalogItem(...rows[i]));
        }

        loadedCatalogItems = catalogItems;
        window.LAST_CATALOG_ITEMS = catalogItems;

        populateTypeOptions(catalogItems);
        if (typeSelect) typeSelect.value = "all";
        if (sortSelect) sortSelect.selectedIndex = 0;

        for (let i = 0; i < catalogItems.length; i++) {
          catalogItems[i].cardElement = await catalogItems[i].toCard();
        }

        applyFiltersAndSort();
        hideTempHeaders(catalogItems.length);

        requestAnimationFrame(function () {
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
 * Parses CSV text into a 2D array of trimmed cells.
 * Empty lines are ignored.
 * @param {string} csvText Raw CSV content.
 * @returns {string[][]} Parsed rows.
 */
function parseCsvText(csvText) {
  const lines = csvText.split(/\r?\n/);
  const rows = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line === "") continue;

    const cells = line.split(",");
    for (let j = 0; j < cells.length; j++) {
      cells[j] = cells[j].trim();
    }

    rows.push(cells);
  }

  return rows;
}

/**
 * Sets up the theme dropdown control and change listeners.
 * @returns {void}
 */
function initThemeController() {
  if (!themeMenuButton) return;

  const themeInputs = document.querySelectorAll('input[name="theme"]');

  for (let i = 0; i < themeInputs.length; i++) {
    themeInputs[i].addEventListener("change", function () {
      syncThemeButtonState();
      closeThemeDropdown();
    });
  }

  syncThemeButtonState();
}

/**
 * Closes the Bootstrap theme dropdown when it is open.
 * @returns {void}
 */
function closeThemeDropdown() {
  if (!themeMenuButton) return;
  if (!window.bootstrap || !window.bootstrap.Dropdown) return;

  const dropdown =
    window.bootstrap.Dropdown.getOrCreateInstance(themeMenuButton);
  dropdown.hide();
}

/**
 * Syncs theme button icon/label text with the selected radio option.
 * @returns {void}
 */
function syncThemeButtonState() {
  if (!themeMenuButton) return;

  const selected =
    document.querySelector('input[name="theme"]:checked') ||
    document.getElementById("theme-system");

  let icon = "🖳";
  let label = "System";

  if (selected && selected.id === "theme-light") {
    icon = "☀";
    label = "Light";
  } else if (selected && selected.id === "theme-dark") {
    icon = "☽";
    label = "Dark";
  }

  if (themeButtonIcon) themeButtonIcon.textContent = icon;
  if (themeButtonLabel) themeButtonLabel.textContent = label;
  if (themeButtonSr)
    themeButtonSr.textContent = `Theme menu, current: ${label}`;

  themeMenuButton.title = `Theme: ${label}`;
}

/**
 * Shows a Bootstrap toast message in the live toast container.
 * @param {string} message Message body shown to the user.
 * @param {"success"|"danger"|"warning"|"info"|string} type Visual toast type.
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

  toastEl.addEventListener("hidden.bs.toast", function () {
    toastEl.remove();
  });

  if (!window.bootstrap?.Toast) return;
  const instance = window.bootstrap.Toast.getOrCreateInstance(toastEl, {
    autohide: true,
    delay: 3500,
  });

  instance.show();
}

/**
 * Toggles the empty-state header/subheader visibility.
 * @param {number} itemCount Number of currently visible items.
 * @returns {void}
 */
function hideTempHeaders(itemCount) {
  const display = itemCount > 0 ? "none" : "block";
  if (tempHeader) tempHeader.style.display = display;
  if (tempSubHeader) tempSubHeader.style.display = display;
}

/**
 * Builds and renders type filter options from loaded catalog items.
 * @param {Array<{type:string}>} items Parsed catalog items.
 * @returns {void}
 */
function populateTypeOptions(items) {
  if (!typeSelect) return;

  const typeMap = {};

  for (let i = 0; i < items.length; i++) {
    const value = uiNormalizeType(items[i].type);
    if (value) typeMap[value] = true;
  }

  const uniqueTypes = Object.keys(typeMap).sort();

  typeSelect.innerHTML = "";

  const allOption = document.createElement("option");
  allOption.value = "all";
  allOption.textContent = "All";
  typeSelect.appendChild(allOption);

  for (let i = 0; i < uniqueTypes.length; i++) {
    const option = document.createElement("option");
    option.value = uniqueTypes[i];
    option.textContent = uniqueTypes[i];
    typeSelect.appendChild(option);
  }
}

/**
 * Compares two items for sorting based on a selected key.
 * Numeric sort is used for year/rating, lexical sort for other keys.
 * @param {Object} a Left item.
 * @param {Object} b Right item.
 * @param {string} sortKey Active sort field.
 * @returns {number} Negative/zero/positive comparator value.
 */
function compareCatalogItems(a, b, sortKey) {
  if (sortKey === "year" || sortKey === "rating") {
    return Number(a[sortKey]) - Number(b[sortKey]);
  }

  const aValue = String(a[sortKey] || "");
  const bValue = String(b[sortKey] || "");
  return aValue.localeCompare(bValue, undefined, { sensitivity: "base" });
}

/**
 * Applies the current type filter and sort setting, then updates the card grid.
 * @returns {void}
 */
function applyFiltersAndSort() {
  if (!resultsContainer) return;

  const selectedType = uiNormalizeType(typeSelect ? typeSelect.value : "all");
  const selectedSort = uiNormalizeType(sortSelect ? sortSelect.value : "none");

  const visibleItems = [];

  for (let i = 0; i < loadedCatalogItems.length; i++) {
    const item = loadedCatalogItems[i];

    if (selectedType === "all") {
      visibleItems.push(item);
    } else {
      const itemType = uiNormalizeType(item.type);
      if (itemType === selectedType) {
        visibleItems.push(item);
      }
    }
  }

  if (selectedSort !== "none") {
    visibleItems.sort(function (a, b) {
      const result = compareCatalogItems(a, b, selectedSort);
      if (result !== 0) return result;

      const aTitle = String(a.title || "");
      const bTitle = String(b.title || "");
      return aTitle.localeCompare(bTitle, undefined, { sensitivity: "base" });
    });
  }

  resultsContainer.innerHTML = "";

  for (let i = 0; i < visibleItems.length; i++) {
    if (visibleItems[i].cardElement) {
      resultsContainer.appendChild(visibleItems[i].cardElement);
    }
  }

  hideTempHeaders(visibleItems.length);
}

/**
 * Normalizes a type value for matching and map keys.
 * @param {string} type Raw type value.
 * @returns {string} Lowercase trimmed type.
 */
function uiNormalizeType(type) {
  return String(type || "")
    .trim()
    .toLowerCase();
}

/**
 * Formats a rating value to one decimal place.
 * @param {number|string} value Rating input.
 * @returns {string} Formatted rating text (for example, "4.5").
 */
function uiSafeRating(value) {
  return Number(value).toFixed(1);
}

/**
 * Checks whether a year value can be parsed as a finite number.
 * @param {number|string} year Year candidate.
 * @returns {boolean} True when the year is numeric.
 */
function uiIsValidYear(year) {
  return Number.isFinite(Number(year));
}

/**
 * Escapes HTML-sensitive characters for safe interpolation into innerHTML.
 * @param {string} text Raw text.
 * @returns {string} Escaped HTML string.
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
 * Validates and normalizes an HTTP/HTTPS URL.
 * @param {string} url Candidate URL.
 * @returns {string|null} Safe absolute URL, or null if invalid/unsupported.
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
 * Adds lightweight syntax highlighting spans to JSON text.
 * @param {string} json JSON string to highlight.
 * @returns {string} HTML markup with span classes for keys/values.
 */
function highlightJSON(json) {
  const escaped = json
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  return escaped.replace(
    /("(?:\\.|[^"\\])*")(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d+)?/g,
    function (match, string, isKey, literal) {
      if (string) {
        if (isKey) {
          return `<span class="json-key">${string}</span>${isKey}`;
        }
        return `<span class="json-string">${string}</span>`;
      }

      if (literal) {
        return `<span class="json-boolean">${literal}</span>`;
      }

      return `<span class="json-number">${match}</span>`;
    },
  );
}

/**
 * Writes the assignment footer "last updated" text.
 * @returns {void}
 */
function footer() {
  const lastUpdate = new Date(2026, 1, 20);
  const el = document.getElementById("last-update");
  if (!el) return;

  el.textContent = `Last Update: ${lastUpdate.toLocaleString("en-CA", { dateStyle: "long" })}`;
}
