"use strict";

window.addEventListener("load", init);

const fileInput = document.getElementById("fileUpload");
const typeSelect = document.getElementById("typeSelect");
const sortSelect = document.getElementById("sortSelect");
const resultsContainer = document.getElementById("results");
const tempHeader = document.querySelector(".temp-header");
const tempSubHeader = document.querySelector(".temp-sub-header");
const DEFAULT_PLACEHOLDER_IMG = "assets/placeholder_viewboxed_600x900.svg";
let loadedCatalogItems = [];

function getDefaultPlaceholderImg() {
  if (typeof getPlaceholderSrc === "function") {
    return getPlaceholderSrc();
  }

  return DEFAULT_PLACEHOLDER_IMG;
}

function isPlaceholderImageSource(src) {
  const value = String(src || "");
  if (!value) return false;
  if (value.startsWith("data:image/svg+xml")) return true;
  return value.includes("placeholder_viewboxed_600x900");
}

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

function init() {
  footer();

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

        applyFiltersAndSort();
        hideTempHeaders();

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

const toastContainer = document.getElementById("liveToastContainer");

/** @type {(message: string, type: string) => void} */
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
    <div class="d-flex">
      <div class="toast-body"></div>
      <button type="button" class="btn-close me-2 m-auto" data-bs-dismiss="toast" aria-label="Close"></button>
    </div>
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
}

function hideTempHeaders() {
  tempHeader?.remove();
  tempSubHeader?.remove();
}

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

function uiNormalizeType(type) {
  return String(type || "")
    .trim()
    .toLowerCase();
}

function uiSafeRating(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return n.toFixed(1);
}

function uiIsValidYear(year) {
  const n = Number(year);
  return Number.isFinite(n) && n > 1000 && n < 3000;
}

function uiEscapeHtml(text) {
  return String(text || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

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

function footer() {
  const lastUpdate = new Date(2026, 1, 20);

  document.getElementById("last-update").textContent =
    `Last Update: ${lastUpdate.toLocaleString("en-CA", { dateStyle: "long" })}`;
}
