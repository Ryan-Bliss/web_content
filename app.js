// ============================================================
// CONFIG
// ============================================================
const WIX_IMPORT_URL = "https://allworldgolf.com/_functions/import731";
const WIX_CHAT_URL = "https://allworldgolf.com/_functions/chat";

// Keep your current filterable columns for now (per your preference)
const filterableColumns = ["endDate", "plrName", "trnName", "year", "FinalPosition", "TournPurse"];

// Preferred table column order (front of table)
const preferredFrontColumns = [
  "endDate",
  "trnName",
  "year",
  "plrName",
  "FinalPosition",
  "TournPurse",
  "FIELDSIZE"
];

// Hide these if they show up
const hiddenColumns = new Set(["_id", "id"]);

// ============================================================
// GLOBAL STATE
// ============================================================

let mockCollectionData = [];
let originalData = [];
let filteredData = [];
let activeFilters = {};
let activeSort = { column: null, direction: null };
let csvHeaders = []; // column headers for table

// Dropdown state
let gOpenDropdown = null;
let gOpenButton = null;
let gRepositionHandler = null;

// ============================================================
// HELPERS
// ============================================================
function safeJsonParse(text) {
  try { return JSON.parse(text); } catch { return null; }
}

function normalizeValue(v) {
  if (v === null || v === undefined) return "";
  return String(v);
}

// Detect stats columns like "...Last4", "...Last100", etc and sort Last# ascending within same stat
function parseLastSuffix(fieldName) {
  // Example: approachesFrom100125YardsLast4 -> base=approachesFrom100125Yards, n=4
  const m = String(fieldName).match(/^(.*)Last(\d+)$/i);
  if (!m) return null;
  return { base: m[1], n: parseInt(m[2], 10) };
}

// A “smart” field comparator that:
// 1) keeps preferredFrontColumns first (in that order)
// 2) groups "...LastN" by base name and sorts N ascending within each base
// 3) otherwise sorts remaining fields alphabetically
function sortHeadersSmart(allFields) {
  // remove hidden
  const filtered = allFields.filter(f => !hiddenColumns.has(f));

  const preferred = [];
  const rest = [];

  const preferredSet = new Set(preferredFrontColumns);
  for (const col of preferredFrontColumns) {
    if (filtered.includes(col)) preferred.push(col);
  }

  for (const f of filtered) {
    if (!preferredSet.has(f)) rest.push(f);
  }

  // Split rest into LastN fields and other fields
  const lastFields = [];
  const otherFields = [];

  for (const f of rest) {
    const parsed = parseLastSuffix(f);
    if (parsed) lastFields.push({ field: f, base: parsed.base, n: parsed.n });
    else otherFields.push(f);
  }

  // Group LastN fields by base, sort each group by n asc, and sort bases alphabetically
  const groups = new Map();
  for (const x of lastFields) {
    if (!groups.has(x.base)) groups.set(x.base, []);
    groups.get(x.base).push(x);
  }

  const bases = Array.from(groups.keys()).sort((a, b) => a.localeCompare(b));
  const lastSorted = [];
  for (const base of bases) {
    const arr = groups.get(base);
    arr.sort((a, b) => a.n - b.n);
    for (const item of arr) lastSorted.push(item.field);
  }

  // Other fields alpha
  otherFields.sort((a, b) => a.localeCompare(b));

  return [...preferred, ...lastSorted, ...otherFields];
}

// ============================================================
// WIX DATA LOADING
// ============================================================
async function loadWixCollectionData(limit = 1000) {
  const url = `${WIX_IMPORT_URL}?limit=${encodeURIComponent(limit)}`;

  const res = await fetch(url, { method: "GET", mode: "cors" });

  // Some Wix setups can return empty html on misconfig. We expect JSON.
  const text = await res.text();
  const json = safeJsonParse(text);

  if (!res.ok) {
    throw new Error(`Import731 endpoint error: ${res.status} ${text?.slice(0, 200) || ""}`);
  }

  if (!json || !Array.isArray(json.items)) {
    throw new Error(
      `Import731 endpoint did not return JSON {items:[...]}. Got: ${text?.slice(0, 200) || ""}`
    );
  }

  return json.items;
}

// ============================================================
// TABLE INITIALIZATION
// ============================================================
document.addEventListener("DOMContentLoaded", async () => {
  try {
    console.log("Loading Wix collection data...");

    // Try Wix first (your real desired data)
    try {
      mockCollectionData = await loadWixCollectionData(1000);
      console.log("Wix data loaded:", mockCollectionData.length);
    } catch (e) {
      console.warn("Wix data load failed, falling back to demo rows:", e);
      mockCollectionData = [
        { _id: "1", endDate: "2025-08-24", T_ID: "R2025060", plrName: "Tommy Fleetwood", trnName: "TOUR Championship", FinalPosition: "1", TournPurse: "40000000", year: "2025", plrNum: "30911" },
        { _id: "2", endDate: "2025-08-24", T_ID: "R2025060", plrName: "Patrick Cantlay", trnName: "TOUR Championship", FinalPosition: "2", TournPurse: "40000000", year: "2025", plrNum: "35450" },
        { _id: "3", endDate: "2025-08-24", T_ID: "R2025060", plrName: "Russell Henley", trnName: "TOUR Championship", FinalPosition: "3", TournPurse: "40000000", year: "2025", plrNum: "34098" },
      ];
    }

    if (!mockCollectionData || mockCollectionData.length === 0) {
      throw new Error("No data returned for table.");
    }

    // Determine headers dynamically from the first row (plus union across rows as safety)
    const headerSet = new Set();
    for (const row of mockCollectionData) {
      Object.keys(row || {}).forEach(k => headerSet.add(k));
    }

    csvHeaders = sortHeadersSmart(Array.from(headerSet));
    console.log("Headers:", csvHeaders);

    // Clean rows: ensure every row has all headers (missing -> "")
    const normalized = mockCollectionData.map((row, idx) => {
      const out = { ...row };
      // ensure there is an _id for internal usage (but we hide it)
      if (!out._id) out._id = String(idx + 1);
      for (const h of csvHeaders) {
        if (!(h in out)) out[h] = "";
      }
      return out;
    });

    originalData = [...normalized];
    filteredData = [...normalized];

    const tableLoading = document.getElementById("tableLoading");
    const tableWrapper = document.getElementById("tableWrapper");
    ensureWrapperScroll(tableWrapper);

    generateTableHeaders();
    applyStickyHeaderStyles();
    setupTableFilters();
    setupClearAllFiltersButton();

    loadTableData().then(() => {
      if (tableLoading) tableLoading.classList.add("hidden");
      if (tableWrapper) tableWrapper.style.display = "block";
      applyStickyHeaderStyles();
    });

    setupChat();
  } catch (err) {
    console.error("Init error:", err);
    const tableBody = document.getElementById("tableBody");
    if (tableBody) {
      tableBody.innerHTML =
        `<tr><td colspan="10" style="text-align:center;padding:20px;color:#ff6b6b;">
          Error loading data. Check console.
        </td></tr>`;
    }
  }
});

// ============================================================
// Sticky header helpers
// ============================================================
function ensureWrapperScroll(wrapper) {
  if (!wrapper) return;
  const cs = window.getComputedStyle(wrapper);
  if (cs.overflowY === "visible") wrapper.style.overflowY = "auto";
  if (cs.position === "static") wrapper.style.position = "relative";
  if ((cs.maxHeight === "none" || cs.maxHeight === "") && (cs.height === "auto" || cs.height === "0px")) {
    wrapper.style.maxHeight = "calc(100vh - 450px)";
  }
}

function applyStickyHeaderStyles() {
  const table = document.getElementById("collectionTable");
  if (!table) return;

  const thead = table.querySelector("thead");
  const ths = table.querySelectorAll("thead th");
  if (!thead || !ths.length) return;

  thead.style.position = "sticky";
  thead.style.top = "0px";
  thead.style.zIndex = "100";
  thead.style.background = "transparent";
  thead.style.backgroundColor = "transparent";

  const theadTr = thead.querySelector("tr");
  if (theadTr) {
    theadTr.style.position = "sticky";
    theadTr.style.top = "0px";
    theadTr.style.zIndex = "100";
    theadTr.style.background = "transparent";
    theadTr.style.backgroundColor = "transparent";
    theadTr.style.backdropFilter = "none";
  }

  ths.forEach(th => {
    th.style.position = "sticky";
    th.style.top = "0px";
    th.style.zIndex = "100";
    th.style.setProperty("background", "rgba(45, 45, 68, 0.85)", "important");
    th.style.setProperty("background-color", "rgba(45, 45, 68, 0.85)", "important");
    th.style.setProperty("backdrop-filter", "blur(10px)", "important");
    th.style.setProperty("transform", "translateZ(0)", "important");
    th.style.setProperty("-webkit-backface-visibility", "hidden", "important");
    th.style.setProperty("backface-visibility", "hidden", "important");
    th.style.isolation = "isolate";
  });

  requestAnimationFrame(() => {
    table.offsetHeight;
  });
}

// ============================================================
// Generate table headers
// ============================================================
function generateTableHeaders() {
  const theadRow = document.querySelector("#collectionTable thead tr");
  if (!theadRow) {
    console.error("Table header row not found");
    return;
  }

  theadRow.innerHTML = "";

  // Column types (used for sort button labels / sort logic)
  const numericColumns = new Set([
    "FinalPosition", "TournPurse", "year", "plrNum", "T_ID", "FIELDSIZE"
  ]);

  csvHeaders.forEach(header => {
    if (hiddenColumns.has(header)) return;

    const th = document.createElement("th");
    const hasFilter = filterableColumns.includes(header);

    const isDate = header === "endDate";
    const isNumeric =
      numericColumns.has(header) ||
      header.toLowerCase().includes("percentage") ||
      header.toLowerCase().includes("avg") ||
      header.toLowerCase().includes("average") ||
      header.toLowerCase().includes("sg") ||
      header.toLowerCase().includes("yards") ||
      header.toLowerCase().includes("distance") ||
      header.toLowerCase().includes("last"); // many of your stats are numeric

    const sortText = isDate ? "Sort Old-New" : (isNumeric ? "Sort Low-High" : "Sort A-Z");
    const sortTextDesc = isDate ? "Sort New-Old" : (isNumeric ? "Sort High-Low" : "Sort Z-A");

    th.innerHTML = `
      <div class="th-content">
        <span>${header}</span>
        ${hasFilter ? `
          <button class="filter-btn" data-column="${header}" title="Filter & Sort">
            <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
              <path d="M6 0L4.5 1.5H7.5L6 0ZM6 12L7.5 10.5H4.5L6 12ZM6 3L3 6H9L6 3ZM6 9L9 6H3L6 9Z"/>
            </svg>
          </button>
        ` : ""}
      </div>
      ${hasFilter ? `
        <div class="filter-dropdown" data-column="${header}">
          <div class="filter-search">
            <input type="text" placeholder="Search..." class="filter-input">
          </div>
          <div class="filter-options"></div>
          <div class="filter-actions">
            <button class="sort-btn" data-sort="asc">${sortText}</button>
            <button class="sort-btn" data-sort="desc">${sortTextDesc}</button>
            <button class="clear-filter-btn">Clear</button>
          </div>
        </div>
      ` : ""}
    `;

    theadRow.appendChild(th);
  });
}

// ============================================================
// Load data into table
// ============================================================
function loadTableData(data = filteredData, adjustWidths = true) {
  return new Promise((resolve) => {
    const tableBody = document.getElementById("tableBody");
    if (!tableBody) {
      console.error("Table body not found");
      resolve();
      return;
    }

    requestAnimationFrame(() => {
      tableBody.innerHTML = "";

      if (!data || data.length === 0) {
        const colspan = (csvHeaders.filter(h => !hiddenColumns.has(h)).length) || 5;
        tableBody.innerHTML = `<tr><td colspan="${colspan}" style="text-align:center;padding:20px;">No data to display</td></tr>`;
        resolve();
        return;
      }

      const headerCells = document.querySelectorAll("#collectionTable thead th");
      const headerWidths = Array.from(headerCells).map(th => th.style.width || (th.offsetWidth + "px"));

      const fragment = document.createDocumentFragment();

      data.forEach((item) => {
        const row = document.createElement("tr");

        let visibleColIndex = 0;

        csvHeaders.forEach((header) => {
          if (hiddenColumns.has(header)) return;

          const cell = document.createElement("td");
          let value = item[header];

          if (value === null || value === undefined || value === "") value = "-";
          else value = String(value);

          // Friendly formatting
          if (header === "TournPurse") {
            const purse = parseFloat(value);
            value = purse > 0 ? `$${(purse / 1000000).toFixed(1)}M` : value;
          } else if (header === "endDate" && value !== "-") {
            // display as localized date (but keep sort as true date)
            const d = new Date(value);
            if (!isNaN(d.getTime())) value = d.toLocaleDateString();
          }

          cell.textContent = value;
          cell.setAttribute("data-column", header);

          if (headerWidths[visibleColIndex]) {
            cell.style.width = headerWidths[visibleColIndex];
            cell.style.minWidth = headerWidths[visibleColIndex];
            cell.style.maxWidth = headerWidths[visibleColIndex];
          }

          visibleColIndex++;
          row.appendChild(cell);
        });

        fragment.appendChild(row);
      });

      tableBody.appendChild(fragment);

      if (adjustWidths) {
        setTimeout(() => {
          autoAdjustColumnWidths();
          applyStickyHeaderStyles();
          resolve();
        }, 0);
      } else {
        applyStickyHeaderStyles();
        resolve();
      }
    });
  });
}

function autoAdjustColumnWidths() {
  const table = document.getElementById("collectionTable");
  if (!table) return;

  const thead = table.querySelector("thead tr");
  const tbody = table.querySelector("tbody");
  if (!thead || !tbody) return;

  const headerCells = thead.querySelectorAll("th");
  const rows = tbody.querySelectorAll("tr");
  if (headerCells.length === 0 || rows.length === 0) return;

  const measure = document.createElement("div");
  measure.style.position = "absolute";
  measure.style.visibility = "hidden";
  measure.style.whiteSpace = "nowrap";
  measure.style.fontSize = window.getComputedStyle(headerCells[0]).fontSize;
  measure.style.fontFamily = window.getComputedStyle(headerCells[0]).fontFamily;
  measure.style.padding = "12px";
  document.body.appendChild(measure);

  headerCells.forEach((th, colIndex) => {
    let maxWidth = 0;

    const headerText = th.querySelector(".th-content span")?.textContent || "";
    measure.textContent = headerText;
    maxWidth = Math.max(maxWidth, measure.offsetWidth);

    const sampleSize = Math.min(10, rows.length);
    for (let i = 0; i < sampleSize; i++) {
      const cell = rows[i].querySelectorAll("td")[colIndex];
      if (cell) {
        measure.textContent = cell.textContent;
        maxWidth = Math.max(maxWidth, measure.offsetWidth);
      }
    }

    const hasFilter = th.querySelector(".filter-btn");
    const padding = hasFilter ? 50 : 25;
    const finalWidth = maxWidth + padding;

    const minWidth = 60;
    const maxWidthLimit = 200;
    const optimalWidth = Math.max(minWidth, Math.min(finalWidth, maxWidthLimit));

    th.style.width = `${optimalWidth}px`;
    th.style.minWidth = `${optimalWidth}px`;

    rows.forEach(row => {
      const cells = row.querySelectorAll("td");
      if (cells[colIndex]) {
        cells[colIndex].style.width = `${optimalWidth}px`;
        cells[colIndex].style.minWidth = `${optimalWidth}px`;
        cells[colIndex].style.maxWidth = `${optimalWidth}px`;
      }
    });
  });

  document.body.removeChild(measure);
}

// ============================================================
// Dropdown helpers
// ============================================================
function detachDropdownToBody(dropdown) {
  if (!dropdown) return;
  if (dropdown.parentElement !== document.body) {
    document.body.appendChild(dropdown);
  }
  dropdown.style.position = "fixed";
  dropdown.style.zIndex = "9999";
}

function reattachDropdown(dropdown) {
  if (!dropdown) return;
  const col = dropdown.dataset.column;
  const th = document
    .querySelector(`#collectionTable thead .filter-btn[data-column="${col}"]`)
    ?.closest("th");

  if (th && dropdown.parentElement === document.body) {
    th.appendChild(dropdown);
    dropdown.style.position = "";
    dropdown.style.top = "";
    dropdown.style.left = "";
    dropdown.style.zIndex = "";
    dropdown.style.maxHeight = "";
    dropdown.style.visibility = "";
    dropdown.style.display = "";
  }
}

function positionDropdown(dropdown, button) {
  const th = button.closest("th");
  if (!th) return;

  detachDropdownToBody(dropdown);

  dropdown.style.display = "block";
  dropdown.style.visibility = "hidden";

  const thRect = th.getBoundingClientRect();
  const viewportHeight = window.innerHeight;
  const viewportWidth = window.innerWidth;

  const dropdownWidth = dropdown.offsetWidth || 260;
  const dropdownHeight = dropdown.offsetHeight || 420;

  let top = thRect.bottom;
  let left = thRect.left;

  if (top + dropdownHeight > viewportHeight && thRect.top > dropdownHeight) {
    top = thRect.top - dropdownHeight;
  }

  if (left + dropdownWidth > viewportWidth) left = viewportWidth - dropdownWidth - 12;
  if (left < 12) left = 12;

  if (top < 12) top = 12;
  const spaceBelow = viewportHeight - top - 12;
  if (dropdownHeight > spaceBelow) dropdown.style.maxHeight = `${spaceBelow}px`;
  else dropdown.style.maxHeight = "";

  dropdown.style.top = `${top}px`;
  dropdown.style.left = `${left}px`;
  dropdown.style.visibility = "visible";
}

// ============================================================
// Setup filters
// ============================================================
function setupTableFilters() {
  const filterButtons = document.querySelectorAll(".filter-btn");
  const filterDropdowns = document.querySelectorAll(".filter-dropdown");

  filterDropdowns.forEach(dropdown => {
    const column = dropdown.dataset.column;
    populateFilterOptions(column, dropdown);
  });

  filterButtons.forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();

      const column = btn.dataset.column;
      const dropdown = document.querySelector(`.filter-dropdown[data-column="${column}"]`);
      if (!dropdown) return;

      if (gOpenDropdown === dropdown && dropdown.classList.contains("active")) {
        closeAllDropdowns();
        return;
      }

      closeAllDropdowns();

      dropdown.classList.add("active");
      gOpenDropdown = dropdown;
      gOpenButton = btn;

      positionDropdown(dropdown, btn);

      const wrapper = document.getElementById("tableWrapper");

      gRepositionHandler = () => {
        if (!gOpenDropdown || !gOpenDropdown.classList.contains("active")) return;
        positionDropdown(gOpenDropdown, gOpenButton);
      };

      window.addEventListener("scroll", gRepositionHandler, { passive: true });
      window.addEventListener("resize", gRepositionHandler);
      if (wrapper) wrapper.addEventListener("scroll", gRepositionHandler, { passive: true });
    });
  });

  document.addEventListener("click", (e) => {
    if (!e.target.closest(".filter-dropdown") && !e.target.closest(".filter-btn")) {
      closeAllDropdowns();
    }
  });

  document.querySelectorAll(".filter-input").forEach(input => {
    input.addEventListener("input", (e) => {
      const dropdown = e.target.closest(".filter-dropdown");
      const column = dropdown.dataset.column;
      const searchTerm = e.target.value.toLowerCase();
      filterOptionsBySearch(column, dropdown, searchTerm);
    });
  });

  document.addEventListener("change", (e) => {
    if (e.target.type === "checkbox" && e.target.classList.contains("filter-checkbox")) {
      const dropdown = e.target.closest(".filter-dropdown");
      const column = dropdown.dataset.column;
      const value = e.target.value;
      const checked = e.target.checked;
      applyFilter(column, value, checked);
    }
  });

  document.querySelectorAll(".sort-btn").forEach(btn => {
    btn.addEventListener("click", (e) => {
      const dropdown = e.target.closest(".filter-dropdown");
      const column = dropdown.dataset.column;
      const direction = e.target.dataset.sort;

      applySort(column, direction);
      closeAllDropdowns();
    });
  });

  document.querySelectorAll(".clear-filter-btn").forEach(btn => {
    btn.addEventListener("click", (e) => {
      const dropdown = e.target.closest(".filter-dropdown");
      const column = dropdown.dataset.column;

      clearFilter(column);
      closeAllDropdowns();
    });
  });
}

function closeAllDropdowns() {
  document.querySelectorAll(".filter-dropdown.active").forEach(dd => {
    dd.classList.remove("active");
    reattachDropdown(dd);
  });

  if (gRepositionHandler) {
    const wrapper = document.getElementById("tableWrapper");
    window.removeEventListener("scroll", gRepositionHandler);
    window.removeEventListener("resize", gRepositionHandler);
    if (wrapper) wrapper.removeEventListener("scroll", gRepositionHandler);
  }

  gOpenDropdown = null;
  gOpenButton = null;
  gRepositionHandler = null;
}

function populateFilterOptions(column, dropdown) {
  const optionsContainer = dropdown.querySelector(".filter-options");
  const uniqueValues = getUniqueValues(column);

  optionsContainer.innerHTML = "";

  uniqueValues.forEach(value => {
    const label = document.createElement("label");
    label.className = "filter-option";
    label.innerHTML = `
      <input type="checkbox" class="filter-checkbox" value="${value}" data-column="${column}">
      <span>${value}</span>
    `;
    optionsContainer.appendChild(label);
  });
}

function getUniqueValues(column) {
  const values = originalData
    .map(item => normalizeValue(item[column]))
    .filter(v => v !== "");

  return [...new Set(values)].sort();
}

function filterOptionsBySearch(column, dropdown, searchTerm) {
  const options = dropdown.querySelectorAll(".filter-option");
  options.forEach(option => {
    const text = option.textContent.toLowerCase();
    option.style.display = text.includes(searchTerm) ? "" : "none";
  });
}

function applyFilter(column, value, checked) {
  if (!activeFilters[column]) activeFilters[column] = [];

  if (checked) {
    if (!activeFilters[column].includes(value)) activeFilters[column].push(value);
  } else {
    activeFilters[column] = activeFilters[column].filter(v => v !== value);
  }

  if (activeFilters[column].length === 0) delete activeFilters[column];

  filteredData = [...originalData];

  Object.keys(activeFilters).forEach(col => {
    const filterValues = activeFilters[col];
    if (filterValues && filterValues.length > 0) {
      filteredData = filteredData.filter(item => {
        const itemValue = normalizeValue(item[col]);
        return filterValues.includes(itemValue);
      });
    }
  });

  if (activeSort.column) applySort(activeSort.column, activeSort.direction, false);
  else loadTableData(filteredData, false);

  updateClearAllButtonVisibility();
}

// Enhanced sort: handles endDate as actual date
function applySort(column, direction) {
  activeSort = { column, direction };

  filteredData.sort((a, b) => {
    // Special: endDate sorting
    if (column === "endDate") {
      const aT = Date.parse(a[column]);
      const bT = Date.parse(b[column]);
      const aOk = !isNaN(aT);
      const bOk = !isNaN(bT);

      if (aOk && bOk) return direction === "asc" ? (aT - bT) : (bT - aT);
      if (aOk && !bOk) return -1;
      if (!aOk && bOk) return 1;
      return 0;
    }

    const aNum = parseFloat(a[column]);
    const bNum = parseFloat(b[column]);

    if (!isNaN(aNum) && !isNaN(bNum)) {
      return direction === "asc" ? (aNum - bNum) : (bNum - aNum);
    } else {
      const aVal = normalizeValue(a[column]).toLowerCase();
      const bVal = normalizeValue(b[column]).toLowerCase();
      return direction === "asc" ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
    }
  });

  loadTableData(filteredData, false);
  updateSortIndicators(column, direction);
  updateClearAllButtonVisibility();
}

function updateSortIndicators(column, direction) {
  document.querySelectorAll(".filter-btn").forEach(btn => {
    btn.classList.remove("sorted-asc", "sorted-desc");
    if (btn.dataset.column === column) {
      btn.classList.add(direction === "asc" ? "sorted-asc" : "sorted-desc");
    }
  });
}

function clearFilter(column) {
  delete activeFilters[column];

  const dropdown = document.querySelector(`.filter-dropdown[data-column="${column}"]`);
  if (dropdown) {
    dropdown.querySelectorAll(".filter-checkbox").forEach(cb => (cb.checked = false));
    const searchInput = dropdown.querySelector(".filter-input");
    if (searchInput) searchInput.value = "";
  }

  if (activeSort.column === column) {
    activeSort = { column: null, direction: null };
    updateSortIndicators(null, null);
  }

  filteredData = [...originalData];

  Object.keys(activeFilters).forEach(col => {
    const filterValues = activeFilters[col];
    if (filterValues && filterValues.length > 0) {
      filteredData = filteredData.filter(item => filterValues.includes(normalizeValue(item[col])));
    }
  });

  if (activeSort.column) applySort(activeSort.column, activeSort.direction, false);
  else loadTableData(filteredData, false);

  updateClearAllButtonVisibility();
}

function setupClearAllFiltersButton() {
  const clearAllBtn = document.getElementById("clearAllFiltersBtn");
  if (!clearAllBtn) return;

  clearAllBtn.addEventListener("click", () => {
    activeFilters = {};
    activeSort = { column: null, direction: null };
    updateSortIndicators(null, null);

    document.querySelectorAll(".filter-dropdown").forEach(dropdown => {
      dropdown.querySelectorAll(".filter-checkbox").forEach(cb => (cb.checked = false));
      const searchInput = dropdown.querySelector(".filter-input");
      if (searchInput) searchInput.value = "";
    });

    filteredData = [...originalData];
    loadTableData(filteredData, false);
    closeAllDropdowns();
    updateClearAllButtonVisibility();
  });

  updateClearAllButtonVisibility();
}

function updateClearAllButtonVisibility() {
  const clearAllBtn = document.getElementById("clearAllFiltersBtn");
  if (!clearAllBtn) return;

  const hasFilters = Object.keys(activeFilters).length > 0 || activeSort.column !== null;
  clearAllBtn.style.opacity = hasFilters ? "1" : "0.5";
  clearAllBtn.style.pointerEvents = hasFilters ? "auto" : "none";
  clearAllBtn.disabled = !hasFilters;
}

// ============================================================
// CHAT (Markdown rendering + table wrapper)
// ============================================================

// Convert markdown -> HTML, sanitize output
function renderBotMessage(markdownText) {
  const raw = (markdownText ?? "").toString();

  const hasMarked = typeof marked !== "undefined";
  const hasPurify = typeof DOMPurify !== "undefined";

  if (!hasMarked) {
    const safe = raw.replace(/</g, "&lt;").replace(/>/g, "&gt;");
    return safe.replace(/\n/g, "<br>");
  }

  marked.setOptions({
    gfm: true,
    breaks: true
  });

  const html = marked.parse(raw);
  return hasPurify ? DOMPurify.sanitize(html) : html;
}
function setupChat() {
  const chatInput = document.getElementById("chatInput");
  const sendButton = document.getElementById("sendButton");
  const chatMessages = document.getElementById("chatMessages");
  if (!chatInput || !sendButton || !chatMessages) return;

  sendButton.addEventListener("click", sendMessage);

  chatInput.addEventListener("keypress", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });

  async function sendMessage() {
    const userMessage = chatInput.value.trim();
    if (!userMessage) return;

    chatInput.disabled = true;
    sendButton.disabled = true;

    addMessage(userMessage, "user");
    chatInput.value = "";

    const loadingEl = addMessage("", "bot", true);

    try {
      const dataToSend = filteredData.slice(0, 1000);
      const responseText = await callChatGPTAPI(userMessage, dataToSend);

      loadingEl.remove();
      addMessage(responseText, "bot");
    } catch (error) {
      loadingEl.remove();
      addMessage(`Sorry, I encountered an error: ${error.message || error}`, "bot");
      console.error("Chat error:", error);
    } finally {
      chatInput.disabled = false;
      sendButton.disabled = false;
      chatInput.focus();
    }
  }

  function addMessage(text, sender, isLoading = false) {
    const messageDiv = document.createElement("div");
    messageDiv.className = `message ${sender}-message`;

    const contentDiv = document.createElement("div");
    contentDiv.className = "message-content";

    if (isLoading) {
      contentDiv.innerHTML = '<span class="loading"></span>';
    } else if (sender === "bot") {
      contentDiv.innerHTML = renderBotMessage(text);

      // Wrap tables so they scroll inside the bubble
      contentDiv.querySelectorAll("table").forEach((tbl) => {
        if (tbl.parentElement && tbl.parentElement.classList.contains("table-scroll")) return;
        const wrapper = document.createElement("div");
        wrapper.className = "table-scroll";
        tbl.parentNode.insertBefore(wrapper, tbl);
        wrapper.appendChild(tbl);
      });
    } else {
      contentDiv.textContent = text || "";
    }

    messageDiv.appendChild(contentDiv);
    chatMessages.appendChild(messageDiv);
    chatMessages.scrollTop = chatMessages.scrollHeight;

    return messageDiv; // return ELEMENT so .remove() works
  }
} // ✅ IMPORTANT: this closing brace was missing in your file

// Call your Wix backend chat function
async function callChatGPTAPI(userMessage, tableData) {
  const res = await fetch(WIX_CHAT_URL, {
    method: "POST",
    mode: "cors",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message: userMessage,
      data: tableData
    })
  });

  const text = await res.text();
  const json = safeJsonParse(text);

  if (!res.ok) {
    throw new Error(`Chat endpoint error: ${res.status} ${text?.slice(0, 200) || ""}`);
  }
  if (!json) {
    throw new Error(`Chat endpoint returned non-JSON: ${text?.slice(0, 200) || ""}`);
  }

  // Your backend currently returns: { success: true, response: "..." }
  // Older versions returned: { answer: "..." }
  const answer = json.response ?? json.answer ?? "";
  if (!answer) throw new Error("Unexpected response from chat endpoint");

  return answer;
}

