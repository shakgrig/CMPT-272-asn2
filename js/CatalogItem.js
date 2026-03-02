"use strict";

/**
 * Represents one parsed catalog row and provides rendering/query helpers.
 */
class CatalogItem {
  static DETAIL_MODAL_ID = "catalogItemDetailModal";

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

    modalFields.innerHTML = rows
      .map((row) => {
        const label = uiEscapeHtml(row.label);
        const value = uiEscapeHtml(row.value);

        return `
                    <dt class="modal-label col-5">${label}</dt>
                    <dd class="modal-value col-7">${value}</dd>
                `;
      })
      .join("");
  }

  /**
   * Renders syntax-highlighted raw JSON data for the selected item.
   * Raw data reflects the parsed CSV row fields for the item.
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

    const json = JSON.stringify(rawData, null, 2);
    modalRaw.innerHTML = highlightJSON(json);
  }

  /**
   * Opens the item detail modal and renders all sections.
   * @param {CatalogItem} item Item to display in the modal.
   * @param {string|null|undefined} imageSrc Initial image source for the modal media.
   * @returns {void}
   */
  static openModal(item, imageSrc) {
    const modal = CatalogItem.ensureDetailModal();

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
   * Click behavior opens the modal with placeholder media.
   * @returns {Promise<HTMLElement>} Fully wired card container element.
   */
  async createCardElement() {
    const col = document.createElement("div");
    col.className = "col-6 col-md-4 col-lg-3";

    const card = document.createElement("article");
    card.className = "card h-100 catalog-item-card catalog-item-card--compact";

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

    const trigger = document.createElement("button");
    trigger.type = "button";
    trigger.className =
      "catalog-card-trigger btn p-0 border-0 bg-transparent text-start w-100 h-100";
    trigger.setAttribute(
      "aria-label",
      `Open details for ${this.title || "Untitled"}`,
    );

    trigger.addEventListener("click", () => {
      CatalogItem.openModal(this, getDefaultPlaceholderImg());
    });

    trigger.appendChild(card);
    col.appendChild(trigger);
    return col;
  }
}
