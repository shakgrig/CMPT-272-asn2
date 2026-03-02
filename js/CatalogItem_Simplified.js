/*
// ------------------------------
// CatalogItem class (simplified)
// ------------------------------
class CatalogItem {
  static DETAIL_MODAL_ID = "catalogItemDetailModal";
  static coverResolvedMap = new Map();

  constructor(
    title = "Untitled",
    type = "unknown",
    author = "",
    year = 1900,
    genre = "N/A",
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

  getCacheKey() {
    return [this.title, this.type, this.author, String(this.year)].join("|");
  }

  getSubtitle() {
    const author = this.author;
    const year = this.year && !isNaN(this.year) ? String(this.year) : "";
    if (author && year) return `${author} (${year})`;
    if (author) return author;
    if (year) return year;
    return "Unknown";
  }

  matchesFilter({ type = "all" } = {}) {
    if (type === "all") return true;
    return this.type.toLowerCase() === type.toLowerCase();
  }

  // ------------------------------
  // Card generation
  // ------------------------------
  toCard() {
    return this.createCardElement(); // synchronous now
  }



  createCardElement() {
    const col = document.createElement("div");
    col.className = "col-6 col-md-4 col-lg-3";

    const card = document.createElement("article");
    card.className = "card h-100 catalog-item-card catalog-item-card--compact";

    const body = document.createElement("section");
    body.className = "card-body p-2";

    const rating = this.rating || null;
    const typeText = this.type || "item";
    const subtitle = this.getSubtitle();
    const genreText = this.genre || "Unknown";

    // Dynamic inner HTML for the card
    body.innerHTML = `
      <h6 class="card-title mb-1">${uiEscapeHtml(this.title)}</h6>
      <small class="card-subtitle mb-1">${uiEscapeHtml(subtitle)}</small>
      <footer class="d-flex flex-wrap align-items-center gap-1">
        <small class="badge bg-secondary text-uppercase">${uiEscapeHtml(typeText)}</small>
        <small class="badge bg-secondary border">Genre: ${uiEscapeHtml(genreText)}</small>
        ${rating !== null ? `<small class="rating-badge badge">${uiEscapeHtml(rating)} ★</small>` : ""}
        <small class="card-details ms-auto">Click for details</small>
      </footer>
    `;

    card.appendChild(body);

    const trigger = document.createElement("button");
    trigger.type = "button";
    trigger.className =
      "catalog-card-trigger btn p-0 border-0 bg-transparent text-start w-100 h-100";
    trigger.setAttribute("aria-label", `Open details for ${this.title}`);

    trigger.addEventListener("click", async () => {
      const modal = document.getElementById(CatalogItem.DETAIL_MODAL_ID);
      if (!modal) return;

      // Populate modal content
      const modalFields = modal.querySelector("[data-modal-fields]");
      if (modalFields) {
        modalFields.innerHTML = `
          <dt class="modal-label col-5">Title</dt><dd class="modal-value col-7">${uiEscapeHtml(this.title)}</dd>
          <dt class="modal-label col-5">Type</dt><dd class="modal-value col-7">${uiEscapeHtml(typeText)}</dd>
          <dt class="modal-label col-5">Author</dt><dd class="modal-value col-7">${uiEscapeHtml(this.author)}</dd>
          <dt class="modal-label col-5">Year</dt><dd class="modal-value col-7">${uiEscapeHtml(this.year)}</dd>
          <dt class="modal-label col-5">Genre</dt><dd class="modal-value col-7">${uiEscapeHtml(this.genre)}</dd>
          <dt class="modal-label col-5">Rating</dt><dd class="modal-value col-7">${rating !== null ? uiEscapeHtml(rating) : "N/A"}</dd>
          <dt class="modal-label col-5">Description</dt><dd class="modal-value col-7">${uiEscapeHtml(this.description)}</dd>
        `;
      }

      // Modal image
      const mediaHost = modal.querySelector("[data-modal-media]");
      if (mediaHost) {
        mediaHost.innerHTML = ""; // clear old image
        const img = document.createElement("img");
        img.className = "img-fluid rounded border w-100";
        img.alt = `${this.title} cover`;

        // Load image asynchronously
        img.src = await getCoverImage(this);

        mediaHost.appendChild(img);
      }

      // Show modal
      const modalInstance = bootstrap.Modal.getOrCreateInstance(modal);
      modalInstance.show();
    });

    trigger.appendChild(card);
    col.appendChild(trigger);

    return col;
  }
}*/
