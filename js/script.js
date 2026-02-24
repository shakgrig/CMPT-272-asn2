"use strict";

// import "./ImageGetter.js";

window.addEventListener("load", init);

const fileInput = document.getElementById("fileUpload");
const fileInfo = document.getElementById("fileInfo");
const DEFAULT_PLACEHOLDER_IMG =
  "assets/placeholder_viewboxed_600x900_combo.svg";

function init() {
  if (typeof clearLocalStorage === "function") {
    // clearLocalStorage();
  }
  // document
  //   .getElementById("fileInput")
  //   .addEventListener("change", handleFileSelect, false);
  // document
  //   .getElementById("fileUpload")
  //   .addEventListener("change", handleFileSelect, false);
  footer();
  // makeCard();
  if (fileInput) {
    fileInput.addEventListener("change", function (event) {
      console.log("File input changed.");
      const file = event.target.files[0];
      if (file) {
        if (!file.type.includes("text") && !file.name.endsWith(".csv")) {
          fileInfo.innerHTML = "Please upload a valid text or CSV file.";
          fileInfo.className = "alert alert-danger mt-3";
          return;
        }
        const reader = new FileReader();
        reader.onload = async function (e) {
          try {
            const parsedRows = e.target.result
              // .split("\n")
              // .map((line) => line.split(",")); // AI helped here to make better
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

            const fileContent = hasExpectedHeader
              ? parsedRows.slice(1)
              : parsedRows;

            console.log(
              "fileContent: ",
              fileContent.map((row) => new CatalogItem(...row)),
            );
            const catalogItems = fileContent.map(
              (row) => new CatalogItem(...row),
            );
            globalThis.LAST_CATALOG_ITEMS = catalogItems;
            // console.log("CatalogItems: ", CatalogItems.values().forEach((v) => v.toLocaleString()));
            // CatalogItems.entries().forEach((v) => console.log("CatalogItems: ", v.toLocaleString()));
            // CatalogItems.entries().forEach((v) => console.log("CatalogItems: ", v[1].toLocalString()));
            // CatalogItems.entries().forEach((v) => v.toCard());
            const results = document.getElementById("results");
            results.innerHTML = "";

            for (const item of catalogItems) {
              const card = await item.toCard();
              results.appendChild(card);
            }

            requestAnimationFrame(() => {
              CatalogItem.preloadCoverImagesInBackground(catalogItems, {
                concurrency: 2,
              });
              CatalogItem.preloadPaperMetadataInBackground(catalogItems, {
                concurrency: 1,
              });
            });

            // fileInfo.className = "alert alert-light border mb-0";
            appendAlert("Successfully loaded CSV", "success");
          } catch (error) {
            console.error("Error parsing file:", error);
            // fileInfo.innerHTML = "Error parsing file. Please ensure it's a valid CSV.";
            // fileInfo.innerHTML = `Error parsing file: ${error}`;
            // fileInfo.className = "alert alert-danger mt-3";
            appendAlert(`Error parsing file: ${error}`, "danger");
          }
        };
        reader.readAsText(file);
      } else {
        console.log("No file selected.");
        // fileInfo.innerHTML = "";
      }
    });
  } else {
    console.error("fileInput element not found!");
  }
}

const alertPlaceholder = document.getElementById("liveAlertPlaceholder");
/** @type {(message: string, type: string) => void} */
function appendAlert(message, type) {
  const wrapper = document.createElement("div");
  wrapper.innerHTML = [
    `<div class="alert alert-${type} alert-dismissible" role="alert">`,
    `   <div>${message}</div>`,
    '   <button type="button" class="btn-close" data-bs-dismiss="alert" aria-label="Close"></button>',
    "</div>",
  ].join("");

  alertPlaceholder.append(wrapper);
}

const alertTrigger = document.getElementById("liveAlertBtn");
if (alertTrigger) {
  alertTrigger.addEventListener("click", () => {
    appendAlert("Nice, you triggered this alert message!", "success");
  });
}

const types = {
  book: "book",
  movie: "movie",
  game: "game",
  paper: "paper",
  music: "music",
};

function uiNormalizeType(type) {
  return String(type || "")
    .trim()
    .toLowerCase();
}

function uiSafeText(value, fallback = "") {
  const text = String(value ?? "").trim();
  return text || fallback;
}

function uiSafeRating(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return String(value);
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
      }
  );
}

// class used to store parsed rows and provide helper methods
class CatalogItem {
  static DETAIL_MODAL_ID = "catalogItemDetailModal";
  static coverPreloadMap = new Map();
  static coverResolvedMap = new Map();

  /** @type {(title?: string, type?: string, author?: string, year?: number, genre?: string, rating?: number, description?: string) => CatalogItem} */
  constructor(
    title = "",
    type = "",
    author = "",
    year = 1900,
    genre = "",
    rating = 0.0,
    description = "",
  ) {
    this.title = title;
    this.type = type;
    this.author = author;
    this.year = Number(year);
    this.genre = genre;
    this.rating = Number(rating);
    this.description = description;
  }
  toLocalString() {
    return `Title: ${this.title}\nType: ${this.type}\nAuthor: ${this.author}\nYear: ${this.year}\nGenre: ${this.genre}\nRating: ${this.rating}\nDescription: ${this.description}`;
  }

  getCacheKey() {
    return [
      uiSafeText(this.title, ""),
      uiSafeText(this.type, ""),
      uiSafeText(this.author, ""),
      String(this.year ?? ""),
    ].join("|");
  }

  getSubtitle() {
    const author = uiSafeText(this.author, "");
    const year = uiIsValidYear(this.year) ? String(this.year) : "";
    if (author && year) return `${author} (${year})`;
    if (author) return author;
    if (year) return year;
    return "Unknown";
  }

  async resolveCoverImage() {
    try {
      if (typeof getCover === "function") {
        const cover = await getCover(this);
        if (cover) return cover;
      }
    } catch {
      // Ignore and continue to fallback.
    }

    try {
      if (typeof getFallbackCoverForType === "function") {
        const fallback = await getFallbackCoverForType(this);
        if (fallback) return fallback;
      }
    } catch {
      // Ignore and continue to default fallback.
    }

    return DEFAULT_PLACEHOLDER_IMG;
  }

  static preloadImageToBrowserCache(imageSrc) {
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

  static async getPreloadedCover(item) {
    const key = item.getCacheKey();
    if (CatalogItem.coverResolvedMap.has(key)) {
      return CatalogItem.coverResolvedMap.get(key);
    }

    if (CatalogItem.coverPreloadMap.has(key)) {
      return CatalogItem.coverPreloadMap.get(key);
    }

    const pending = (async () => {
      try {
        const source = await item.resolveCoverImage();
        await CatalogItem.preloadImageToBrowserCache(source);
        const resolved = source || DEFAULT_PLACEHOLDER_IMG;
        CatalogItem.coverResolvedMap.set(key, resolved);
        return resolved;
      } catch {
        const resolved = DEFAULT_PLACEHOLDER_IMG;
        CatalogItem.coverResolvedMap.set(key, resolved);
        return resolved;
      }
    })();

    CatalogItem.coverPreloadMap.set(key, pending);
    return pending;
  }

  static preloadCoverImagesInBackground(items = [], options = {}) {
    if (!Array.isArray(items) || items.length === 0) return;

    const requestedConcurrency = Number(options?.concurrency);
    const concurrency = Number.isFinite(requestedConcurrency)
      ? Math.min(6, Math.max(1, Math.floor(requestedConcurrency)))
      : 2;

    const queue = items.filter((item) => item instanceof CatalogItem);
    let nextIndex = 0;
    let active = 0;

    const runNext = () => {
      while (active < concurrency && nextIndex < queue.length) {
        const item = queue[nextIndex++];
        active += 1;

        CatalogItem.getPreloadedCover(item)
          .catch(() => DEFAULT_PLACEHOLDER_IMG)
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
      window.requestIdleCallback(() => runNext(), { timeout: 1200 });
    } else {
      setTimeout(runNext, 0);
    }
  }

  static getPaperMetadataProvider() {
    const provider = globalThis.CATALOG_PAPER_METADATA_PROVIDER;
    if (!provider || typeof provider !== "object") return null;
    return provider;
  }

  static getCachedPaperMetadata(item) {
    const provider = CatalogItem.getPaperMetadataProvider();
    if (!provider || typeof provider.getCached !== "function") return null;

    try {
      return provider.getCached(item) || null;
    } catch {
      return null;
    }
  }

  static async getPaperMetadata(item) {
    const provider = CatalogItem.getPaperMetadataProvider();
    if (!provider || typeof provider.get !== "function") return null;

    try {
      return (await provider.get(item)) || null;
    } catch {
      return null;
    }
  }

  static preloadPaperMetadataInBackground(items = [], options = {}) {
    const provider = CatalogItem.getPaperMetadataProvider();
    if (!provider || typeof provider.preload !== "function") return;

    try {
      provider.preload(items, options);
    } catch {
      // Optional module failures should never break core UI flow.
    }
  }

  static ensureDetailModal() {
    let modal = document.getElementById(CatalogItem.DETAIL_MODAL_ID);
    if (modal) return modal;

    modal = document.createElement("div");
    modal.className = "modal fade";
    modal.id = CatalogItem.DETAIL_MODAL_ID;
    modal.tabIndex = -1;
    modal.setAttribute(
      "aria-labelledby",
      `${CatalogItem.DETAIL_MODAL_ID}Label`,
    );
    modal.setAttribute("aria-hidden", "true");

    modal.innerHTML = `
      <div class="modal-dialog modal-lg modal-dialog-centered modal-dialog-scrollable">
        <div class="modal-content">
          <div class="modal-header">
            <h1 class="modal-title fs-5" id="${CatalogItem.DETAIL_MODAL_ID}Label">Item details</h1>
            <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
          </div>
          <div class="modal-body">
            <div class="row g-3">
              <div class="col-12 col-md-5">
                <img class="img-fluid rounded border w-100" data-modal-image src="${DEFAULT_PLACEHOLDER_IMG}" alt="Item cover">
              </div>
              <div class="col-12 col-md-7">
                <dl class="row mb-0" data-modal-fields></dl>
              </div>
            </div>
            <hr>
            <p class="h6">Raw parsed data</p>
<!--            <pre class="small border rounded p-2 mb-0" data-modal-raw></pre>-->
<!--            <pre class="small border rounded p-2 mb-0"><code  data-modal-raw></code></pre>-->
            <pre class="small border rounded p-2 mb-0"><code  data-modal-raw></code></pre>
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

  static setModalImage(modal, item, imageSrc) {
    const modalImage = modal?.querySelector("[data-modal-image]");
    if (!modalImage) return;

    const title = uiSafeText(item?.title, "Untitled");
    const typeText = uiSafeText(item?.type, "Unknown");
    modalImage.src = imageSrc || DEFAULT_PLACEHOLDER_IMG;
    modalImage.alt = `${title} ${typeText} cover`;
    modalImage.onerror = () => {
      modalImage.src = DEFAULT_PLACEHOLDER_IMG;
    };
  }

  static renderModalFields(modal, item) {
    const modalFields = modal?.querySelector("[data-modal-fields]");
    if (!modalFields) return;

    const typeText = uiSafeText(item?.type, "Unknown");
    const author = uiSafeText(item?.author, "Unknown");
    const year = uiIsValidYear(item?.year) ? String(item.year) : "Unknown";
    const genre = uiSafeText(item?.genre, "Unknown");
    const rating = uiSafeRating(item?.rating);
    const description = uiSafeText(
      item?.description,
      "No description provided.",
    );

    const rows = [
      { label: "Type", value: typeText },
      { label: "Author / Creator", value: author },
      { label: "Year", value: year },
      { label: "Genre", value: genre },
      { label: "Rating", value: rating !== null ? `${rating} ★` : "N/A" },
      { label: "Description", value: description },
    ];

    if (uiNormalizeType(item?.type) === "paper") {
      const metadata = CatalogItem.getCachedPaperMetadata(item);
      const hasProvider = Boolean(CatalogItem.getPaperMetadataProvider());
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
        rows.push({
          label: "DOI",
          value: hasProvider
            ? "Searching Crossref…"
            : "Unavailable (optional DOI module disabled)",
        });
      }
    }

    modalFields.innerHTML = rows
      .map((row) => {
        const label = uiEscapeHtml(row.label);
        const value = uiEscapeHtml(row.value);
        const href = uiToSafeHttpUrl(row.href);
        const renderedValue = href
          ? `<a href="${uiEscapeHtml(href)}" target="_blank" rel="noopener noreferrer">${value}</a>`
          : value;

        return `
          <dt class="modal-label col-5">${label}</dt>
          <dd class="modal-value col-7">${renderedValue}</dd>
        `;
      })
      .join("");
  }

  static renderModalRaw(modal, item) {
    const modalRaw = modal?.querySelector("[data-modal-raw]");
    if (!modalRaw) return;

    const rawData = {
      title: uiSafeText(item?.title, ""),
      type: uiSafeText(item?.type, ""),
      author: uiSafeText(item?.author, ""),
      year: Number.isFinite(Number(item?.year))
        ? Number(item.year)
        : item?.year,
      genre: uiSafeText(item?.genre, ""),
      rating:
        item?.rating === undefined || item?.rating === null
          ? null
          : Number.isFinite(Number(item?.rating))
            ? Number(item.rating)
            : item.rating,
      description: uiSafeText(item?.description, ""),
    };

    if (uiNormalizeType(item?.type) === "paper") {
      const metadata = CatalogItem.getCachedPaperMetadata(item);
      rawData.doi = metadata?.doi || null;
      rawData.doiUrl = metadata?.doiUrl || null;
      rawData.paperUrl = metadata?.landingUrl || null;
      rawData.paperMetaSource = metadata?.source || null;
    }
    const json = JSON.stringify(rawData, null, 2);

    // modalRaw.textContent = JSON.stringify(rawData, null, 2);
    // modalRaw.textContent = highlightJSON(json);
    modalRaw.innerHTML = highlightJSON(json);
  }

  static openModal(item, imageSrc) {
    const modal = CatalogItem.ensureDetailModal();
    modal.dataset.currentItemKey = item.getCacheKey();

    const modalTitle = modal.querySelector(
      `#${CatalogItem.DETAIL_MODAL_ID}Label`,
    );
    if (modalTitle) {
      modalTitle.textContent = uiSafeText(item?.title, "Untitled");
    }

    CatalogItem.setModalImage(modal, item, imageSrc);
    CatalogItem.renderModalFields(modal, item);
    CatalogItem.renderModalRaw(modal, item);

    if (window.bootstrap?.Modal) {
      window.bootstrap.Modal.getOrCreateInstance(modal).show();
    }
  }

  static updateModalImageIfCurrent(item, imageSrc) {
    const modal = document.getElementById(CatalogItem.DETAIL_MODAL_ID);
    if (!modal) return;
    if (modal.dataset.currentItemKey !== item.getCacheKey()) return;
    CatalogItem.setModalImage(
      modal,
      item,
      imageSrc || DEFAULT_PLACEHOLDER_IMG,
    );
  }

  static refreshPaperModalIfCurrent(item) {
    const modal = document.getElementById(CatalogItem.DETAIL_MODAL_ID);
    if (!modal) return;
    if (modal.dataset.currentItemKey !== item.getCacheKey()) return;
    CatalogItem.renderModalFields(modal, item);
    CatalogItem.renderModalRaw(modal, item);
  }

  // Useful methods may include (but not limited to):
  matchesFilter({ type, genre }) {} // returns Boolean based on filter criteria

  async toCard() {
    return await this.createCardElement();
  } // returns a DOM subtree based on the catalogue item

  async createCardElement() {
    const col = document.createElement("div");
    col.className = "col-6 col-md-4 col-lg-3";

    const card = document.createElement("div");
    card.className = "card h-100 catalog-item-card catalog-item-card--compact";

    const body = document.createElement("div");
    body.className = "card-body p-2";

    const rating = uiSafeRating(this.rating);
    const typeText = uiSafeText(this.type, "item");
    const subtitle = this.getSubtitle();

    body.innerHTML = `
      <h6 class="card-title mb-1">${uiEscapeHtml(uiSafeText(this.title, "Untitled"))}</h6>
      <p class="card-subtitle small mb-2">${uiEscapeHtml(subtitle)}</p>
      <div class="d-flex flex-wrap align-items-center gap-1">
        <span class="badge bg-secondary text-uppercase">${uiEscapeHtml(typeText)}</span>
        ${rating !== null ? `<span class="rating-badge badge">${uiEscapeHtml(rating)} ★</span>` : ""}
        <span class="details small ms-auto">Click for details</span>
      </div>
    `;

    card.appendChild(body);

    const trigger = document.createElement("button");
    trigger.type = "button";
    trigger.className =
      "catalog-card-trigger btn p-0 border-0 bg-transparent text-start w-100 h-100";
    trigger.setAttribute(
      "aria-label",
      `Open details for ${uiSafeText(this.title, "Untitled")}`,
    );

    trigger.addEventListener("click", async () => {
      const key = this.getCacheKey();
      const readyImage = CatalogItem.coverResolvedMap.get(key);

      if (readyImage) {
        CatalogItem.openModal(this, readyImage);
      } else {
        CatalogItem.openModal(this, DEFAULT_PLACEHOLDER_IMG);
        try {
          const imageSrc = await CatalogItem.getPreloadedCover(this);
          CatalogItem.updateModalImageIfCurrent(this, imageSrc);
        } catch {
          // Keep placeholder.
        }
      }

      if (uiNormalizeType(this.type) === "paper") {
        CatalogItem.getPaperMetadata(this)
          .then(() => {
            CatalogItem.refreshPaperModalIfCurrent(this);
          })
          .catch(() => {
            CatalogItem.refreshPaperModalIfCurrent(this);
          });
      }
    });

    trigger.appendChild(card);
    col.appendChild(trigger);
    return col;
  }
}

// const testCatalogItem = new CatalogItem(
//   "hello",
//   undefined,
//   undefined,
//   undefined,
// );
// console.log("console message test");
// console.log(testCatalogItem);
// console.log(testCatalogItem.toLocalString());

function footer() {
  const lastUpdate = new Date(2026, 1, 20);

  document.getElementById("last-update").textContent =
    `Last Update: ${lastUpdate.toLocaleString("en-CA", { dateStyle: "long" })}`;
}
