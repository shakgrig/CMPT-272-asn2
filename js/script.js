"use strict";

// import "./ImageGetter.js";

window.addEventListener("load", init);

var fileContent = document.getElementById("fileContent");
var fileInfo = document.getElementById("fileInfo");

function init() {
  document
    .getElementById("fileInput")
    .addEventListener("change", handleFileSelect, false);
  document
    .getElementById("fileUpload")
    .addEventListener("change", handleFileSelect, false);
  footer();
  // makeCard();
}

function handleFileSelect(event) {
  const reader = new FileReader();
  reader.onload = handleFileLoad;
  reader.readAsText(event.target.files[0]);
}

function handleFileLoad(event) {
  console.log(event);
  document.getElementById("fileContent").textContent = event.target.result;
  document.getElementById("fileInfo").textContent = event.target.result;
}

const types = {book: "book" , movie: "movie" , game: "game", paper: "paper", music: "music"};

class CatalogItem {
  constructor(
    title = "",
    type = "",
    type2 = {},
    author = "",
    year = "",
    genre = "",
    rating = "",
    description = "",
  ) {
    this.title = title;
    this.type = type;
    this.type2 = types;
    this.author = author;
    this.year = year;
    this.genre = genre;
    this.rating = rating;
    this.description = description;
  }
}

const testCatalogItem = new CatalogItem("hello");

function footer() {
  // const x = document.createElement("SMALL");
  // x.id="copyright";
  // x.textContent = "\u00A9 Copyright 2026 Peter Iliopulos, 301660766. All rights reserved.";
  // document.body.appendChild(x);

  const LAST_UPDATED = "Feb 20, 2026";

  document.getElementById("last-update").textContent =
    `Last updated: ${LAST_UPDATED}`;
}
