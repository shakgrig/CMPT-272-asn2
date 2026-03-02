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
 * Builds the raw SVG markup used as the generic catalog placeholder image.
 * @returns {string} Serialized SVG markup string.
 */
function buildPlaceholderSvgMarkup() {
  return `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="300 150 600 900" preserveAspectRatio="xMidYMid meet"><rect x="300" y="150" width="600" height="900" fill="var(--placeholder-bg)" rx="3"/><g opacity=".5"><g opacity=".5"><path fill="var(--placeholder-outer)" d="M600.709 736.5c-75.454 0-136.621-61.167-136.621-136.62 0-75.454 61.167-136.621 136.621-136.621 75.453 0 136.62 61.167 136.62 136.621 0 75.453-61.167 136.62-136.62 136.62Z"/><path stroke="var(--placeholder-stroke)" stroke-width="2.418" d="M600.709 736.5c-75.454 0-136.621-61.167-136.621-136.62 0-75.454 61.167-136.621 136.621-136.621 75.453 0 136.62 61.167 136.62 136.621 0 75.453-61.167 136.62-136.62 136.62Z"/></g><path stroke="url(#a)" stroke-width="2.418" d="M0-1.209h553.581" transform="scale(1 -1) rotate(45 1163.11 91.165)"/><path stroke="url(#b)" stroke-width="2.418" d="M404.846 598.671h391.726"/><path stroke="url(#c)" stroke-width="2.418" d="M599.5 795.742V404.017"/><path stroke="url(#d)" stroke-width="2.418" d="m795.717 796.597-391.441-391.44"/><path fill="var(--placeholder-inner)" d="M600.709 656.704c-31.384 0-56.825-25.441-56.825-56.824 0-31.384 25.441-56.825 56.825-56.825 31.383 0 56.824 25.441 56.824 56.825 0 31.383-25.441 56.824-56.824 56.824Z"/><g clip-path="url(#e)"><path fill="var(--placeholder-icon)" fill-rule="evenodd" d="M616.426 586.58h-31.434v16.176l3.553-3.554.531-.531h9.068l.074-.074 8.463-8.463h2.565l7.18 7.181V586.58Zm-15.715 14.654 3.698 3.699 1.283 1.282-2.565 2.565-1.282-1.283-5.2-5.199h-6.066l-5.514 5.514-.073.073v2.876a2.418 2.418 0 0 0 2.418 2.418h26.598a2.418 2.418 0 0 0 2.418-2.418v-8.317l-8.463-8.463-7.181 7.181-.071.072Zm-19.347 5.442v4.085a6.045 6.045 0 0 0 6.046 6.045h26.598a6.044 6.044 0 0 0 6.045-6.045v-7.108l1.356-1.355-1.282-1.283-.074-.073v-17.989h-38.689v23.43l-.146.146.146.147Z" clip-rule="evenodd"/></g><path stroke="var(--placeholder-stroke)" stroke-width="2.418" d="M600.709 656.704c-31.384 0-56.825-25.441-56.825-56.824 0-31.384 25.441-56.825 56.825-56.825 31.383 0 56.824 25.441 56.824 56.825 0 31.383-25.441 56.824-56.824 56.824Z"/></g><defs><linearGradient id="a" x1="554.061" x2="-.48" y1=".083" y2=".087" gradientUnits="userSpaceOnUse"><stop stop-color="var(--placeholder-stroke)" stop-opacity="0"/><stop offset=".208" stop-color="var(--placeholder-stroke)"/><stop offset=".792" stop-color="var(--placeholder-stroke)"/><stop offset="1" stop-color="var(--placeholder-stroke)" stop-opacity="0"/></linearGradient><linearGradient id="b" x1="796.912" x2="404.507" y1="599.963" y2="599.965" gradientUnits="userSpaceOnUse"><stop stop-color="var(--placeholder-stroke)" stop-opacity="0"/><stop offset=".208" stop-color="var(--placeholder-stroke)"/><stop offset=".792" stop-color="var(--placeholder-stroke)"/><stop offset="1" stop-color="var(--placeholder-stroke)" stop-opacity="0"/></linearGradient><linearGradient id="c" x1="600.792" x2="600.794" y1="403.677" y2="796.082" gradientUnits="userSpaceOnUse"><stop stop-color="var(--placeholder-stroke)" stop-opacity="0"/><stop offset=".208" stop-color="var(--placeholder-stroke)"/><stop offset=".792" stop-color="var(--placeholder-stroke)"/><stop offset="1" stop-color="var(--placeholder-stroke)" stop-opacity="0"/></linearGradient><linearGradient id="d" x1="404.85" x2="796.972" y1="403.903" y2="796.02" gradientUnits="userSpaceOnUse"><stop stop-color="var(--placeholder-stroke)" stop-opacity="0"/><stop offset=".208" stop-color="var(--placeholder-stroke)"/><stop offset=".792" stop-color="var(--placeholder-stroke)"/><stop offset="1" stop-color="var(--placeholder-stroke)" stop-opacity="0"/></linearGradient><clipPath id="e"><path fill="var(--placeholder-icon)" d="M581.364 580.535h38.689v38.689h-38.689z"/></clipPath></defs></svg>`;
}

/**
 * Creates an SVGElement from the placeholder markup.
 * @param {string} [className=""] Optional CSS class list applied to the root SVG.
 * @returns {SVGElement|null} Parsed SVG root or null when parsing unexpectedly fails.
 */
function createPlaceholderSvgElement(className = "") {
  const template = document.createElement("template");
  template.innerHTML = buildPlaceholderSvgMarkup().trim();
  const svg = template.content.firstElementChild;
  if (!svg) return null;
  if (className) svg.setAttribute("class", className);
  return svg;
}

/**
 * Returns the default placeholder asset path.
 * @returns {string} Relative URL to the shared placeholder SVG file.
 */
function getPlaceholderSrc() {
  return "assets/placeholder_viewboxed_600x900.svg";
}

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
 * Wires UI events, parses CSV input, and renders cards.
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

    reader.onerror = function () {
      appendAlert("Could not read the selected CSV file.", "danger");
    };

    reader.onload = async function (e) {
      try {
        const csvText = String(e.target.result || "").normalize("NFC");
        const parsedRows = parseCsvText(csvText);

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

        appendAlert("Successfully loaded CSV", "success");
      } catch (error) {
        console.error("Error parsing file:", error);
        appendAlert(`Error parsing file: ${error}`, "danger");
      }
    };

    reader.readAsText(file, "UTF-8");
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

  let icon = "\u{1F5B3}";
  let label = "System";

  if (selected && selected.id === "theme-light") {
    icon = "\u2600";
    label = "Light";
  } else if (selected && selected.id === "theme-dark") {
    icon = "\u263D";
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

    if (item.matchesFilter({ type: selectedType })) {
      visibleItems.push(item);
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
 * Escapes HTML-sensitive characters for safe injection into innerHTML.
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
