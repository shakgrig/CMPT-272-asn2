// class used to store parsed rows and provide helper methods
/**
 * Represents one parsed catalog row and provides rendering/query helpers.
 */
class CatalogItem {
  static DETAIL_MODAL_ID = "catalogItemDetailModal";
  static coverPreloadMap = new Map();
  static coverResolvedMap = new Map();

  /**
   * Creates a normalized catalog item from one parsed CSV row.
   * @param {string} [title="Untitled"] Title shown in cards and modal headers.
   * @param {string} [type="unknown"] Item type used for filter chips and lookup routing.
   * @param {string} [author=""] Author/creator/artist display string.
   * @param {number|string} [year=1900] Year input; converted to `Number` for numeric operations.
   * @param {string} [genre="N/A"] Genre/category text badge.
   * @param {number|string} [rating=0.0] Rating input; normalized to a numeric value.
   * @param {string} [description=""] Description text rendered in modal details.
   */
  constructor(
    title = "Untitled",
    type = "unknown",
    author = "",
    year = 1900,
    genre = "N/A",
    rating = 0.0,
    description = "",
  ) {
    const normalizedType = String(type || "")
      .trim()
      .toLowerCase();
    const normalizedGenre = String(genre ?? "").trim();
    const hasMeaningfulGenre =
      normalizedGenre !== "" &&
      !/^(unknown|n\/a|na|null|none)$/i.test(normalizedGenre);
    const normalizedRating = String(rating ?? "").trim();
    const parsedRating = Number(normalizedRating);
    const hasExplicitRating =
      normalizedRating !== "" && Number.isFinite(parsedRating);

    this.title = title;
    this.type = type;
    this.author = author;
    this.year = Number(year);
    this.genre =
      (hasMeaningfulGenre ? normalizedGenre : "") ||
      (normalizedType === "paper" ? "Research / Academic" : genre);
    this.rating = hasExplicitRating ? parsedRating : 0;
    this.hasExplicitRating = hasExplicitRating;
    this.description = description;
  }

  /**
   * Preloads an image into browser cache.
   * @param {string} imageSrc URL/data URI to request and warm in the browser cache.
   * @returns {Promise<void>} Resolves on load or error (never rejects).
   */
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

  /**
   * Resolves and caches a cover image source for an item.
   * De-duplicates concurrent lookups and avoids persisting placeholder snapshots.
   * @param {CatalogItem} item Catalog item requiring a resolved cover source.
   * @returns {Promise<string>} Final image source (real cover when possible; placeholder otherwise).
   */
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
        if (!source || isPlaceholderImageSource(source)) {
          // Placeholder data URIs are snapshots of current CSS values.
          // Do not cache them long-term; regenerate on each use.
          return getDefaultPlaceholderImg();
        }

        await CatalogItem.preloadImageToBrowserCache(source);
        CatalogItem.coverResolvedMap.set(key, source);
        return source;
      } catch {
        return getDefaultPlaceholderImg();
      } finally {
        CatalogItem.coverPreloadMap.delete(key);
      }
    })();

    CatalogItem.coverPreloadMap.set(key, pending);
    return pending;
  }

  /**
   * Starts cover preloading during idle time with bounded concurrency.
   * @param {CatalogItem[]} [items=[]] Items considered for background cover warming.
   * @param {{concurrency?: number}} [options={}] Optional worker cap (`1..6`, default `2`).
   * @returns {void}
   */
  static preloadCoverImagesInBackground(items = [], options = {}) {
    if (!Array.isArray(items) || items.length === 0) return;

    const requestedConcurrency = Number(options?.concurrency);
    const concurrency = Number.isFinite(requestedConcurrency)
      ? Math.min(6, Math.max(1, Math.floor(requestedConcurrency)))
      : 2;

    const queue = items.filter((item) => item instanceof CatalogItem);
    let nextIndex = 0;
    let active = 0;

    const markPrefetchedImageOnCard = (item, imageSrc) => {
      if (!imageSrc || isPlaceholderImageSource(imageSrc)) return;
      const cardNode = item?.cardElement?.querySelector?.(".catalog-item-card");
      if (!cardNode) return;
      cardNode.classList.add("catalog-item-card--has-modal-image");
    };

    const runNext = () => {
      while (active < concurrency && nextIndex < queue.length) {
        const item = queue[nextIndex++];
        active += 1;

        CatalogItem.getPreloadedCover(item)
          .then((imageSrc) => {
            markPrefetchedImageOnCard(item, imageSrc);
          })
          .catch(() => getDefaultPlaceholderImg())
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

  /**
   * Returns the optional paper metadata provider if present.
   * @returns {any|null} Provider object implementing `getCached/get/preload`, or null.
   */
  static getPaperMetadataProvider() {
    const provider =
      typeof CATALOG_PAPER_METADATA_PROVIDER !== "undefined"
        ? CATALOG_PAPER_METADATA_PROVIDER
        : null;
    if (!provider || typeof provider !== "object") return null;
    return provider;
  }

  /**
   * Gets already-cached paper metadata for a catalog item.
   * @param {CatalogItem} item Item key used to read cached metadata.
   * @returns {any|null} Cached metadata object when present; otherwise null.
   */
  static getCachedPaperMetadata(item) {
    const provider = CatalogItem.getPaperMetadataProvider();
    if (!provider || typeof provider.getCached !== "function") return null;
    return provider.getCached(item) || null;
  }

  /**
   * Fetches paper metadata for a catalog item.
   * @param {CatalogItem} item Paper-like item to resolve via optional provider.
   * @returns {Promise<any|null>} Metadata payload or null when unavailable.
   */
  static async getPaperMetadata(item) {
    const provider = CatalogItem.getPaperMetadataProvider();
    if (!provider || typeof provider.get !== "function") return null;
    return (await provider.get(item)) || null;
  }

  /**
   * Starts background paper metadata preloading.
   * @param {CatalogItem[]} [items=[]] Candidate items to queue for provider preloading.
   * @param {{concurrency?: number}} [options={}] Provider-specific preload tuning.
   * @returns {void}
   */
  static preloadPaperMetadataInBackground(items = [], options = {}) {
    const provider = CatalogItem.getPaperMetadataProvider();
    if (!provider || typeof provider.preload !== "function") return;
    provider.preload(items, options);
  }

  /**
   * Ensures the detail modal exists in the DOM.
   * Builds the modal lazily on first use and resets `<details>` expansion after close.
   * @returns {HTMLElement} Existing or newly created modal root element.
   */
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
                        <h5 class="modal-title" id="${CatalogItem.DETAIL_MODAL_ID}Label">Item details</h5>
                        <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
                    </div>
                    <div class="modal-body">
                        <div class="row g-3">
                            <div class="col-12 col-md-5" data-modal-media>
                            </div>
                            <div class="col-12 col-md-7">
                                <dl class="row mb-0" data-modal-fields></dl>
                            </div>
                        </div>
                        <hr>
                        <details>
                            <summary class="h6">Raw parsed data</summary>
                            <pre class="small border rounded p-2 mb-0"><code data-modal-raw></code></pre>
                        </details>
                    </div>
                    <div class="modal-footer">
                        <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Close</button>
                    </div>
                </div>
            </div>
        `;

    document.body.appendChild(modal);

    modal.addEventListener("hidden.bs.modal", () => {
      const detailsBlocks = modal.querySelectorAll("details");
      detailsBlocks.forEach((details) => {
        details.open = false;
      });
    });

    return modal;
  }

  /**
   * Renders modal media content using an image or SVG placeholder.
   * @param {HTMLElement|null} modal Active modal root containing the media host.
   * @param {CatalogItem} item Item used for alt text and fallback rendering context.
   * @param {string|null|undefined} imageSrc Preferred image source; placeholder used when absent.
   * @returns {void}
   */
  static setModalImage(modal, item, imageSrc) {
    const mediaHost = modal?.querySelector("[data-modal-media]");
    if (!mediaHost) return;

    const title = item?.title || "Untitled";
    const typeText = item?.type || "Unknown";
    const altText = `${title} ${typeText} cover`;
    const source = imageSrc || getDefaultPlaceholderImg();

    if (isPlaceholderImageSource(source)) {
      const placeholder = createInlinePlaceholderElement(
        "img-fluid rounded border w-100",
        altText,
      );

      if (placeholder) {
        mediaHost.innerHTML = "";
        mediaHost.appendChild(placeholder);
        return;
      }
    }

    const modalImage = document.createElement("img");
    modalImage.className = "img-fluid rounded border w-100";
    modalImage.src = source;
    modalImage.alt = altText;
    modalImage.onerror = () => {
      if (isPlaceholderImageSource(source)) return;
      CatalogItem.setModalImage(modal, item, getDefaultPlaceholderImg());
    };

    mediaHost.innerHTML = "";
    mediaHost.appendChild(modalImage);
  }

  /**
   * Renders key/value details for a catalog item inside the modal.
   * Includes DOI/paper link rows when paper metadata is available.
   * @param {HTMLElement|null} modal Active modal root that hosts `[data-modal-fields]`.
   * @param {CatalogItem} item Item whose fields are displayed.
   * @returns {void}
   */
  static renderModalFields(modal, item) {
    const modalFields = modal?.querySelector("[data-modal-fields]");
    if (!modalFields) return;

    const typeText = item?.type || "Unknown";
    const author = item?.author || "Unknown";
    const year = uiIsValidYear(item?.year) ? String(item.year) : "Unknown";
    const genre = item?.genre || "Unknown";
    const hasDisplayRating = Boolean(item?.hasExplicitRating);
    const rating = hasDisplayRating ? uiSafeRating(item?.rating) : null;
    const description = item?.description || "No description provided.";

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

  /**
   * Renders syntax-highlighted raw JSON data for the selected item.
   * Mirrors visible values and augments with paper metadata when relevant.
   * @param {HTMLElement|null} modal Active modal root that hosts `[data-modal-raw]`.
   * @param {CatalogItem} item Item used to construct debug JSON output.
   * @returns {void}
   */
  static renderModalRaw(modal, item) {
    const modalRaw = modal?.querySelector("[data-modal-raw]");
    if (!modalRaw) return;

    const rawData = {
      title: item?.title ?? "",
      type: item?.type ?? "",
      author: item?.author ?? "",
      year: Number.isFinite(Number(item?.year))
        ? Number(item.year)
        : item?.year,
      genre: item?.genre,
      rating:
        item?.rating === undefined || item?.rating === null
          ? null
          : Number.isFinite(Number(item?.rating))
            ? Number(item.rating)
            : item.rating,
      description: item?.description ?? "",
    };

    if (
      typeof item?.coverLookupUrl === "string" &&
      item.coverLookupUrl.trim()
    ) {
      rawData.coverLookupUrl = item.coverLookupUrl;
    }

    if (uiNormalizeType(item?.type) === "paper") {
      const metadata = CatalogItem.getCachedPaperMetadata(item);
      rawData.doi = metadata?.doi || null;
      rawData.paperUrl = metadata?.landingUrl || metadata?.doiUrl || null;
      rawData.paperMetaSource = metadata?.source || null;
    }
    const json = JSON.stringify(rawData, null, 2);
    modalRaw.innerHTML = highlightJSON(json);
  }

  /**
   * Opens the item detail modal and renders all sections.
   * @param {CatalogItem} item Item to display and track as the current modal context.
   * @param {string|null|undefined} imageSrc Initial image source used before async upgrades.
   * @returns {void}
   */
  static openModal(item, imageSrc) {
    const modal = CatalogItem.ensureDetailModal();
    modal.dataset.currentItemKey = item.getCacheKey();

    const modalTitle = modal.querySelector(
      `#${CatalogItem.DETAIL_MODAL_ID}Label`,
    );
    if (modalTitle) {
      modalTitle.textContent = item?.title || "Untitled";
    }

    CatalogItem.setModalImage(modal, item, imageSrc);
    CatalogItem.renderModalFields(modal, item);
    CatalogItem.renderModalRaw(modal, item);

    if (window.bootstrap?.Modal) {
      window.bootstrap.Modal.getOrCreateInstance(modal).show();
    }
  }

  /**
   * Updates modal image only if the modal is showing the same item.
   * Prevents race-condition overwrites when a previous async cover resolves late.
   * @param {CatalogItem} item Item that initiated the async image request.
   * @param {string|null|undefined} imageSrc Newly resolved source candidate.
   * @returns {void}
   */
  static updateModalImageIfCurrent(item, imageSrc) {
    const modal = document.getElementById(CatalogItem.DETAIL_MODAL_ID);
    if (!modal) return;
    if (modal.dataset.currentItemKey !== item.getCacheKey()) return;
    CatalogItem.setModalImage(
      modal,
      item,
      imageSrc || getDefaultPlaceholderImg(),
    );
  }

  /**
   * Re-renders modal text content only if the current modal item matches.
   * Useful after background paper metadata completes.
   * @param {CatalogItem} item Item whose metadata changed.
   * @returns {void}
   */
  static refreshPaperModalIfCurrent(item) {
    const modal = document.getElementById(CatalogItem.DETAIL_MODAL_ID);
    if (!modal) return;
    if (modal.dataset.currentItemKey !== item.getCacheKey()) return;
    CatalogItem.renderModalFields(modal, item);
    CatalogItem.renderModalRaw(modal, item);
  }

  // this was mostly just for testing and debugging
  /**
   * Returns a debug-friendly multiline representation of this item.
   * @returns {string}
   */
  toLocalString() {
    return `Title: ${this.title}\nType: ${this.type}\nAuthor: ${this.author}\nYear: ${this.year}\nGenre: ${this.genre}\nRating: ${this.rating}\nDescription: ${this.description}`;
  }

  /**
   * Returns a stable cache key for this item.
   * @returns {string}
   */
  getCacheKey() {
    return [this.title, this.type, this.author, String(this.year ?? "")].join(
      "|",
    );
  }

  /**
   * Returns subtitle text combining author and year when present.
   * @returns {string} `author (year)`, `author`, `year`, or `Unknown` fallback.
   */
  getSubtitle() {
    const author = this.author;
    const year = uiIsValidYear(this.year) ? String(this.year) : "";
    if (author && year) return `${author} (${year})`;
    if (author) return author;
    if (year) return year;
    return "Unknown";
  }

  /**
   * Returns a rating-band class used to colorize the card badge.
   * @param {number|string|null|undefined} rating Candidate numeric rating value.
   * @returns {string} CSS modifier class for the visual rating scale.
   */
  static getRatingBadgeBandClass(rating) {
    if (rating === null || rating === undefined || rating === "") {
      return "rating-badge-unrated";
    }
    const value = Number(rating);
    if (!Number.isFinite(value)) return "rating-badge-unrated";
    if (value <= 1) return "rating-badge-very-low";
    if (value < 2) return "rating-badge-low";
    if (value < 3) return "rating-badge-mid";
    if (value < 4) return "rating-badge-good";
    return "rating-badge-excellent";
  }

  /**
   * Resolves this item's cover image with fallback behavior.
   * Tries type-specific lookup, then generic type fallback, then placeholder.
   * @returns {Promise<string>} Best available image source for this item.
   */
  async resolveCoverImage() {
    if (typeof getCover === "function") {
      const cover = await getCover(this);
      if (cover) return cover;
    }

    if (typeof getFallbackCoverForType === "function") {
      const fallback = await getFallbackCoverForType(this);
      if (fallback) return fallback;
    }

    return getDefaultPlaceholderImg();
  }

  /**
   * Returns whether the item matches the provided filter criteria.
   * @param {{type?: string}} [param0={type:"all"}] Active UI filters; only type is currently supported.
   * @returns {boolean} True when this item should remain visible.
   */
  matchesFilter({ type = "all" } = {}) {
    const selectedType = uiNormalizeType(type);
    if (!selectedType || selectedType === "all") return true;
    return uiNormalizeType(this.type) === selectedType;
  }

  /**
   * Creates the rendered card element for this item.
   * @returns {Promise<HTMLElement>} Responsive grid column containing a clickable card.
   */
  async toCard() {
    return await this.createCardElement();
  }

  /**
   * Builds an interactive card element and click behavior for this item.
   * Click behavior opens modal immediately with placeholder, then upgrades media/
   * paper metadata asynchronously when available.
   * @returns {Promise<HTMLElement>} Fully wired card container element.
   */
  async createCardElement() {
    const col = document.createElement("div");
    col.className = "col-6 col-md-4 col-lg-3";

    const card = document.createElement("article");
    card.className = "card h-100 catalog-item-card catalog-item-card--compact";

    const markHasModalImage = (imageSrc) => {
      if (!imageSrc || isPlaceholderImageSource(imageSrc)) return;
      card.classList.add("catalog-item-card--has-modal-image");
    };

    const body = document.createElement("section");
    body.className = "card-body p-2";

    const hasDisplayRating = Boolean(this.hasExplicitRating);
    const rating = hasDisplayRating ? uiSafeRating(this.rating) : null;
    const ratingBandClass = CatalogItem.getRatingBadgeBandClass(rating);
    const ratingText = rating !== null ? uiEscapeHtml(rating) : "N/A";
    const ratingSuffix = rating !== null ? " &starf;" : "";
    const typeText = this.type || "item";
    const subtitle = this.getSubtitle();
    const genreText = this.genre || "Unknown";

    body.innerHTML = `
        <h6 class="card-title mb-1">${uiEscapeHtml(this.title || "Untitled")}</h6>
        <small class="card-subtitle mb-1">${uiEscapeHtml(subtitle)}</small>
        <footer class="d-flex flex-wrap align-items-center gap-1">
          <small class="badge text-uppercase">T: ${uiEscapeHtml(typeText)}</small>
          <small class="badge border">G: ${uiEscapeHtml(genreText)}</small>
          <small class="rating-badge badge ${ratingBandClass}">${ratingText}${ratingSuffix}</small>
          <small class="card-details ms-auto">Click for details</small>
        </footer>
        `;

    card.appendChild(body);

    const initialResolvedImage = CatalogItem.coverResolvedMap.get(
      this.getCacheKey(),
    );
    markHasModalImage(initialResolvedImage);

    const trigger = document.createElement("button");
    trigger.type = "button";
    trigger.className =
      "catalog-card-trigger btn p-0 border-0 bg-transparent text-start w-100 h-100";
    trigger.setAttribute(
      "aria-label",
      `Open details for ${this.title || "Untitled"}`,
    );

    trigger.addEventListener("click", async () => {
      const key = this.getCacheKey();
      const readyImage = CatalogItem.coverResolvedMap.get(key);

      if (readyImage) {
        markHasModalImage(readyImage);
        CatalogItem.openModal(this, readyImage);
      } else {
        CatalogItem.openModal(this, getDefaultPlaceholderImg());
        try {
          const imageSrc = await CatalogItem.getPreloadedCover(this);
          markHasModalImage(imageSrc);
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
