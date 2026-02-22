"use strict";

// import "./ImageGetter.js";

window.addEventListener("load", init);

const fileInput = document.getElementById("fileUpload");
const fileInfo = document.getElementById("fileInfo");

function init() {
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
            const fileContent = e.target.result
              // .split("\n")
              // .map((line) => line.split(",")); // AI helped here to make better
              .split(/\r?\n/)
              .filter((line) => line.trim() !== "")
              .map((line) => line.split(",").map((cell) => cell.trim()));
            console.log(
              "fileContent: ",
              fileContent.map((row) => new CatalogItem(...row)),
            );
            const catalogItems = fileContent.map(
              (row) => new CatalogItem(...row),
            );
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

            // fileInfo.className = "alert alert-light border mb-0";
            appendAlert("sucess?", "light");
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

// function handleFileSelect(event) {
//   const reader = new FileReader();
//   reader.onload = handleFileLoad;
//   reader.readAsText(event.target.files[0]);
// }

// function handleFileLoad(event) {
//   console.log(event);
//   document.getElementById("fileContent").textContent = event.target.result;
// }

// if (fileInput) {
//   fileInput.addEventListener("change", function (event) {
//     console.log("File input changed.");
//     const file = event.target.files[0];
//     if (file) {
//       if (!file.type.includes('text') && !file.name.endsWith('.csv')) {
//         fileInfo.innerHTML = "Please upload a valid text or CSV file.";
//         fileInfo.className = "alert alert-danger mt-3";
//         return;
//       }
//       const reader = new FileReader();
//       reader.onload = function (e) {
//         try {
//           const fileContent = e.target.result.split('\n').map(line => line.split(','));
//
//           fileInfo.innerHTML = fileContent.map(row => row.join(', ')).join('<br>');
//           fileInfo.className = "alert alert-light border mb-0";
//         } catch (error) {
//           console.error("Error parsing file:", error);
//           fileInfo.innerHTML = "Error parsing file. Please ensure it's a valid CSV.";
//           fileInfo.className = "alert alert-danger mt-3";
//         }
//       };
//       reader.readAsText(file);
//     } else {
//       console.log("No file selected.");
//       fileInfo.innerHTML = "";
//     }
//   });
// } else {
//   console.error("fileInput element not found!");
// }

const types = {
  book: "book",
  movie: "movie",
  game: "game",
  paper: "paper",
  music: "music",
};

// class used to store parsed rows and provide helper methods
class CatalogItem {
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
  // Useful methods may include (but not limited to):
  matchesFilter({ type, genre }) {} // returns Boolean based on filter criteria
  async toCard() {
    if (typeof createBookCard !== "function") {
      throw new Error("createBookCard is not available.");
    }
    return await createBookCard(this);
  } // returns a DOM subtree based on the catalogue item
}

// for No-Image-Placeholder.svg
// const Embed = `${<a title="Ranjithsiji, CC BY-SA 4.0 &lt;https://creativecommons.org/licenses/by-sa/4.0&gt;, via Wikimedia Commons" href="https://commons.wikimedia.org/wiki/File:No-Image-Placeholder.svg"><img width="256" alt="No-Image-Placeholder" src="https://upload.wikimedia.org/wikipedia/commons/thumb/6/65/No-Image-Placeholder.svg/256px-No-Image-Placeholder.svg.png?20200912122019" /></a>}`;
// const Attribution = `${<a href="https://commons.wikimedia.org/wiki/File:No-Image-Placeholder.svg">Ranjithsiji</a>}, ${<a href="https://creativecommons.org/licenses/by-sa/4.0">CC BY-SA 4.0</a>}, via Wikimedia Commons`;

const testCatalogItem = new CatalogItem(
  "hello",
  undefined,
  undefined,
  undefined,
);

console.log("console message test");
console.log(testCatalogItem);
console.log(testCatalogItem.toLocalString());

function footer() {
  const lastUpdate = new Date(2026, 1, 20);

  document.getElementById("last-update").textContent =
    `Last Update: ${lastUpdate.toLocaleString("en-CA", { dateStyle: "long" })}`;
}
