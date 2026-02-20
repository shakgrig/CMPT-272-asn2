## Assignment 2: Interactive Catalog Viewer (JavaScript \+ CSV)

### Overview

In this assignment, you will build a **client-side web application** that allows users to upload a CSV file containing a catalog of items (e.g., books, movies, papers, etc.). The application will parse the CSV file using **vanilla JavaScript** and dynamically display the catalog items in an interactive interface. Users will be able to **search**, **filter**, and **sort** the catalog items based on various attributes.

### Learning Objectives

By completing this assignment, you will be able to:

- Read and parse a CSV file using **vanilla JavaScript**
- Represent structured data using JavaScript objects and arrays
- Dynamically generate and update HTML content using the DOM
- Implement search, filtering, and sorting without external JavaScript libraries
- Build an interactive UI using **Bootstrap** and custom CSS
- Reuse layout, responsiveness, and branding techniques from **Assignment 1**

### CSV File Format

The uploaded CSV file will contain the following **header row** (exactly as written):  
`title,type,author,year,genre,rating,description`  
Each subsequent row will represent a catalog item. For example:  
`Clean Code,book,Robert C. Martin,2008,Software Engineering,4.7,A handbook of agile software craftsmanship`.

Notes:

- `type` may include values such as: `book`, `movie`, `game`, `paper`, etc.
- `year` and `rating` should be treated as numbers
- `description` may contain spaces but will not contain commas

### Functional Requirements

#### 1\. CSV Upload & Parsing

Your application must:

- Provide a file upload input using `<input type="file">`
- Read the file using the `FileReader` API
- Parse the CSV **manually** (no PapaParse or similar libraries)
- Convert each row into a JavaScript object
- Store all items in an array for reuse throughout the application
- Here's a of how to read a file in JavaScript:

  ```html
  <!-- index.html -->
  <!DOCTYPE html>
  <html>
    <head>
      <link rel="stylesheet" href="css/style.css" />
      <script src="js/script.js"></script>
    </head>

    <body onload="init()">
      <input id="fileInput" type="file" name="file" />
      <pre id="fileContent"></pre>
    </body>
  </html>
  ```

  ```js
  // script.js
  function init() {
    document
      .getElementById("fileInput")
      .addEventListener("change", handleFileSelect, false);
  }

  function handleFileSelect(event) {
    const reader = new FileReader();
    reader.onload = handleFileLoad;
    reader.readAsText(event.target.files[0]);
  }

  function handleFileLoad(event) {
    console.log(event);
    document.getElementById("fileContent").textContent = event.target.result;
  }
  ```

#### 2\. Catalog Display

Once the CSV file is parsed, your application must display all items. Each item must display at least:

- Title
- Type
- Author
- Year
- Genre
- Rating
- Hint: Use **Bootstrap cards or a Bootstrap table**
- Layout must be responsive. It's up to you how to best display the items on different screen sizes.

#### 3\. Filter Functionality

Create filter controls to allow users to narrow down results based on item attributes. Your design must:

- Provide at least **one filter control**:
  - Filter by `type` **and/or**
  - Filter by `genre`
- Filters must work together with sorting
- Filters must contain only the categories in the uploaded file.
- Results must update dynamically when filters change

#### 4\. Sorting

Provide **at least one** of the following sorting options:

- Sort by year (ascending or descending)
- Sort by rating (ascending or descending)

#### 5\. Item Details

- Clicking an item must display its **full description**
- This may be implemented using:
  - A Bootstrap modal **or**
  - A dedicated detail section on the page

#### 6\. `CatalogItem` Class

- Implement a `CatalogItem` class used to store parsed rows and provide helper methods.
- Useful methods may include (but not limited to):
  - `matchesFilter({type,genre})`: returns Boolean based on filter criteria.
  - `toCard()`: returns a DOM subtree based on the catalogue item.

### UI & Design Requirements

- **Bootstrap is required** for layout and components
- Custom CSS is allowed and encouraged
- Your site must include:
  - A consistent header (title \+ branding logo)
  - A footer with the course name and assignment number
- Page must remain usable on mobile screen sizes
- Controls (filters, sorting) should be visually distinct from results

### Technical Constraints

You are allowed to use the following technologies:

- Bootstrap (CSS and JS bundle)
- Vanilla JavaScript
- Custom CSS
- Browser APIs (FileReader, DOM)

You are **not allowed** to use:

- JavaScript libraries (e.g., PapaParse, jQuery, React, Vue)
- Server-side code
- Frameworks other than Bootstrap

Your file structure should be similar to Assignment 1, with separate folders for CSS, JS, and assets.

### Submission

Here's a sample demo of the final product:

<!-- For local video playback -->

<video id="videoPlayer" src="./public/as2.mp4" controls></video>

<!-- For GitHub video playback -->

[](https://media.github.sfu.ca/user/4425/files/991bfc7a-e0b4-4e2f-8d44-d7d1922bfc2b)

Please play around with elements and properties not mentioned in this description; once again, a part of your mark is based on effort and creativity.

### Submission

- Submit a **ZIP file** containing:
  - `index.html`
  - All README, CSS and JavaScript files
- Your application must run by opening `index.html` locally
- We will test with our own CSV files. No testing CSV files need to be submitted.

### Marking Scheme

| Item                                       | Weight |
|--------------------------------------------|:------:|
| CSV parsing & data model                   |   4    |
| Filtering functionality                    |   3    |
| Sorting                                    |   4    |
| Dynamic DOM updates                        |   3    |
| UI, Bootstrap usage, and Code Organization |   3    |
| Effort and Creativity                      |   3    |

### Academic Integrity

You may discuss ideas, but all code/design must be your own. You are allowed to use AI tools (e.g., ChatGPT, GitHub Copilot) to help with coding, debugging, or generating ideas. However, you must clearly document any AI assistance in your README, specifying what parts were influenced or generated by AI. Failure to do so may be considered a violation of academic integrity policies.

|                                                                                                             |                                     |                 |
|-------------------------------------------------------------------------------------------------------------|-------------------------------------|----------------:|
| **Asn2**                                                                                                    |                                     |                 |
| **Criteria**                                                                                                | **Ratings**                         |         **Pts** |
| CSV parsing & data model                                                                                    | **4 pts Full Marks 0 pts No Marks** |         / 4 pts |
| Filtering (made dynamically)                                                                                | **3 pts Full Marks 0 pts No Marks** |         / 3 pts |
| Sorting                                                                                                     | **4 pts Full Marks 0 pts No Marks** |         / 4 pts |
| Effort, Creativity and Usability <br/>(Error checking and learnability of the app, Style needs to be there) | **3 pts Full Marks 0 pts No Marks** |         / 3 pts |
| Dynamic Dom updates                                                                                         | **3 pts Full Marks 0 pts No Marks** |         / 3 pts |
| UI, Bootstrap usage, and Code Organization                                                                  | **3 pts Full Marks 0 pts No Marks** |         / 3 pts |
|                                                                                                             |                                     | Total Points: 0 |

<!-- Best I can do to hide on GitHub, but still apply locally -->

<details hidden><summary></summary><style>code:not(:has(span)){color:red;}</style></details>

![Static Badge](https://img.shields.io/badge/temp-for_later-purple?colorA=white)
