"use strict";

const COVER_CACHE_KEY = "bookCoverCache";

// Load persisted cache into memory
const coverCache = new Map(
  Object.entries(JSON.parse(localStorage.getItem(COVER_CACHE_KEY) || "{}")),
);

// Persist helper
function persistCoverCache() {
  localStorage.setItem(
    COVER_CACHE_KEY,
    JSON.stringify(Object.fromEntries(coverCache)),
  );
}

const CACHE_VERSION = "v2"; // change when input format changes

localStorage.setItem("cacheVersion", CACHE_VERSION);

function getCover(item) {
  switch (item.type) {
    case "book":
      return getBookCover(item);
    case "movie":
      return getMoviePoster(item);
    case "game":
      return getGameCover(item);
  }
}

/* {
  type: "book" | "movie" | "game",
  title,
  author,     // books
  year,
  genre,
  rating,
  description
}

<div class="card placeholder-glow">
  <div class="card-img-top placeholder"></div>
  <div class="card-body">
    <span class="placeholder col-6"></span>
    <span class="placeholder col-4"></span>
  </div>
</div> */

function scoreResult(doc, book) {
  let score = 0;

  if (doc.title?.toLowerCase() === book.title.toLowerCase()) score += 3;

  if (
    doc.author_name?.some((a) =>
      a.toLowerCase().includes(book.author.toLowerCase()),
    )
  )
    score += 2;

  if (doc.first_publish_year === book.year) score += 1;

  return score;
}

// async function getBookCover(book) {
//   const cacheKey = `${book.title}|${book.author}|${book.year}`;

//   if (coverCache.has(cacheKey)) {
//     return coverCache.get(cacheKey);
//   }

//   const params = new URLSearchParams({
//     title: book.title,
//     author: book.author
//   });

//   try {
//     const res = await fetch(`https://openlibrary.org/search.json?${params}`);
//     const data = await res.json();

//     if (!data.docs || data.docs.length === 0) {
//       coverCache.set(cacheKey, null);
//       return null;
//     }

//     const best = data.docs
//       .map(doc => ({ doc, score: scoreResult(doc, book) }))
//       .sort((a, b) => b.score - a.score)[0];

//     const coverId = best.doc.cover_i;
//     const coverUrl = coverId
//       ? `https://covers.openlibrary.org/b/id/${coverId}-L.jpg`
//       : null;

//     coverCache.set(cacheKey, coverUrl);
//     return coverUrl;

//   } catch (err) {
//     coverCache.set(cacheKey, null);
//     return null;
//   }
// }

async function fetchCoverFromOpenLibrary(book) {
  const params = new URLSearchParams({
    title: book.title,
    author: book.author,
  });

  const res = await fetch(`https://openlibrary.org/search.json?${params}`);
  const data = await res.json();

  if (!data.docs || data.docs.length === 0) {
    return null;
  }

  const best = data.docs
    .map((doc) => ({ doc, score: scoreResult(doc, book) }))
    .sort((a, b) => b.score - a.score)[0];

  const coverId = best.doc.cover_i;
  return coverId
    ? `https://covers.openlibrary.org/b/id/${coverId}-L.jpg`
    : null;
}

async function getBookCover(book) {
  const cacheKey = `${book.title}|${book.author}|${book.year}`;

  // 1️⃣ Persistent cache (localStorage → memory)
  if (coverCache.has(cacheKey)) {
    return coverCache.get(cacheKey);
  }

  // 2️⃣ API fallback
  try {
    const coverUrl = await fetchCoverFromOpenLibrary(book);
    coverCache.set(cacheKey, coverUrl);
    persistCoverCache();
    return coverUrl;
  } catch {
    coverCache.set(cacheKey, null);
    persistCoverCache();
    return null;
  }
}

async function createBookCard(book) {
  const col = document.createElement("div");
  col.className = "col-sm-6 col-md-4";

  const card = document.createElement("div");
  card.className = "card h-100";

  // Image
  const img = document.createElement("img");
  img.className = "card-img-top";
  img.alt = `${book.title} cover`;

  const coverUrl = await getBookCover(book);
  img.src = coverUrl || "assets/No-Image-Placeholder.svg";

  img.onerror = function () {
    img.src = "assets/No-Image-Placeholder.svg";
  };

  // Card body
  const body = document.createElement("div");
  body.className = "card-body";

  body.innerHTML = `
    <h5 class="card-title">${book.title}</h5>
    <h6 class="card-subtitle mb-2 text-muted">${book.author} (${book.year})</h6>
    <p class="card-text">${book.description}</p>
    <span class="badge bg-secondary">${book.genre}</span>
    <span class="badge bg-primary ms-1">${book.rating} ★</span>
  `;

  card.appendChild(img);
  card.appendChild(body);
  col.appendChild(card);

  return col;
}

// const booksTemp = [
//   {
//     title: "Dune",
//     author: "Frank Herbert",
//     year: 1965,
//     genre: "Science Fiction",
//     rating: 4.5,
//     description: "Epic science fiction novel set on the desert planet Arrakis.",
//   },
// ];

// (async function () {
//   const results = document.getElementById("results");

//   for (const book of booksTemp) {
//     const card = await createBookCard(book);
//     results.appendChild(card);
//   }
// })();

/**
 * to reset later:
 * localStorage.removeItem(COVER_CACHE_KEY);
 * coverCache.clear();
 */
