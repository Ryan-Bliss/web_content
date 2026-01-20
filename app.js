// ============================================================
// CSV/Wix Data Storage
// ============================================================
let mockCollectionData = [];
let originalData = [];
let filteredData = [];
let activeFilters = {};
let activeSort = { column: null, direction: null };
let csvHeaders = []; // Store column headers

const filterableColumns = ['endDate', 'plrName', 'trnName', 'year', 'FinalPosition', 'TournPurse'];

// Dropdown state
let gOpenDropdown = null;
let gOpenButton = null;
let gRepositionHandler = null;

// ============================================================
// CONFIG: Wix endpoint (Import731)
// ============================================================
const WIX_BASE_URL = "https://allworldgolf.com";
const WIX_IMPORT731_ENDPOINT = `${WIX_BASE_URL}/_functions/import731?limit=1000`;

// ============================================================
// Helpers
// ============================================================
function normalizeWixItems(items) {
    // Ensure each item has _id, and remove Wix system fields you don't want shown
    return (items || []).map((item, idx) => {
        const row = { ...item };

        // Ensure _id exists
        if (!row._id) row._id = item._id || String(idx + 1);

        // Remove common Wix system fields (optional)
        delete row._owner;
        delete row._createdDate;
        delete row._updatedDate;

        return row;
    });
}

function setHeadersFromData(data) {
  if (!data || data.length === 0) {
    console.warn("No data available to infer headers.");
    csvHeaders = [];
    return;
  }

  const hiddenCols = new Set(['_id', '_owner', '_createdDate', '_updatedDate']);

  // Start columns (only included if they actually exist in the data)
  const priority = [
    'endDate',
    'trnName',
    'year',
    'plrName',
    'FinalPosition',
    'TournPurse',
    'FIELDSIZE'
  ];

  const keys = Object.keys(data[0]).filter(k => !hiddenCols.has(k));

  // 1) priority keys in your preferred order, but only if present
  const ordered = priority.filter(k => keys.includes(k));

  // 2) everything else alphabetical
  const rest = keys
    .filter(k => !ordered.includes(k))
    .sort((a, b) => a.localeCompare(b));

  csvHeaders = [...ordered, ...rest];
}


// Parse CSV line handling quoted values
function parseCSVLine(line) {
    const values = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
        const char = line[i];

        if (char === '"') {
            inQuotes = !inQuotes;
        } else if (char === ',' && !inQuotes) {
            values.push(current);
            current = '';
        } else {
            current += char;
        }
    }
    values.push(current);

    return values;
}

// ============================================================
// Load from Wix Collection (Import731)
// ============================================================
async function loadWixImport731Data() {
    const res = await fetch(WIX_IMPORT731_ENDPOINT, { method: 'GET' });
    if (!res.ok) {
        throw new Error(`Wix Import731 endpoint failed: HTTP ${res.status}`);
    }

    const payload = await res.json();
    const items = normalizeWixItems(payload.items || []);
    console.log("Loaded Import731 from Wix:", items.length, "rows");
    return items;
}

// ============================================================
// Load CSV Data (fallback)
// ============================================================
async function loadCSVData() {
    try {
        const response = await fetch('awg_llm_test_data.csv');

        if (!response.ok) {
            throw new Error(`CSV file not found (${response.status}). Please copy awg_llm_test_data.csv to the project folder or use a local server.`);
        }

        const csvText = await response.text();
        console.log('CSV text loaded, length:', csvText.length);

        const lines = csvText.split('\n').filter(line => line.trim());
        if (lines.length === 0) {
            console.warn('CSV file is empty');
            return [];
        }

        const headers = parseCSVLine(lines[0]);
        csvHeaders = headers.map(h => h.trim());
        console.log('Parsed headers:', csvHeaders.length, 'columns');

        const data = [];
        for (let i = 1; i < lines.length; i++) {
            const values = parseCSVLine(lines[i]);
            if (values.length === headers.length) {
                const row = {};
                headers.forEach((header, index) => {
                    row[header.trim()] = values[index]?.trim() || '';
                });
                row._id = i.toString();
                data.push(row);
            }
        }

        console.log('Parsed', data.length, 'rows');
        return data;
    } catch (error) {
        console.error('Error loading CSV:', error);
        console.log('Using fallback data...');

        csvHeaders = ['endDate', 'T_ID', 'trnName', 'year', 'plrNum', 'plrName', 'FinalPosition', 'TournPurse',
            'Driving Distance - Last4', 'Driving Accuracy Percentage - Last4', 'SG: Off the Tee - Last4'];

        return [
            { _id: '1', endDate: '2025-08-24', T_ID: 'R2025060', plrName: 'Tommy Fleetwood', trnName: 'TOUR Championship', FinalPosition: '1', TournPurse: '40000000', year: '2025', plrNum: '30911' },
            { _id: '2', endDate: '2025-08-24', T_ID: 'R2025060', plrName: 'Patrick Cantlay', trnName: 'TOUR Championship', FinalPosition: '2', TournPurse: '40000000', year: '2025', plrNum: '35450' },
            { _id: '3', endDate: '2025-08-24', T_ID: 'R2025060', plrName: 'Russell Henley', trnName: 'TOUR Championship', FinalPosition: '3', TournPurse: '40000000', year: '2025', plrNum: '34098' },
        ];
    }
}

// ============================================================
// Initialize the page
// ============================================================
document.addEventListener('DOMContentLoaded', async () => {
    try {
        const tableLoading = document.getElementById('tableLoading');
        const tableWrapper = document.getElementById('tableWrapper');

        // Ensure sticky headers can work
        ensureWrapperScroll(tableWrapper);

        // 1) Prefer Wix Import731
        // 2) Fall back to CSV if Wix isn't ready / CORS blocked
        try {
            console.log('Loading Wix Import731 data...');
            mockCollectionData = await loadWixImport731Data();
            if (!mockCollectionData || mockCollectionData.length === 0) {
                throw new Error("Wix returned 0 rows.");
            }
            setHeadersFromData(mockCollectionData);
        } catch (wixErr) {
            console.warn('Wix load failed (will fall back to CSV):', wixErr);
            console.log('Loading CSV data...');
            mockCollectionData = await loadCSVData();

            if (!mockCollectionData || mockCollectionData.length === 0) {
                throw new Error('No data loaded from Wix or CSV fallback.');
            }

            // CSV loader already sets csvHeaders, but if it didn't:
            if (!csvHeaders || csvHeaders.length === 0) setHeadersFromData(mockCollectionData);
        }

        console.log('Loaded rows:', mockCollectionData.length);
        console.log('Headers:', csvHeaders);

        originalData = [...mockCollectionData];
        filteredData = [...mockCollectionData];

        generateTableHeaders();
        applyStickyHeaderStyles();
        setupTableFilters();
        setupClearAllFiltersButton();

        loadTableData().then(() => {
            if (tableLoading) tableLoading.classList.add('hidden');
            if (tableWrapper) tableWrapper.style.display = 'block';
            applyStickyHeaderStyles();
        }).catch(error => {
            console.error('Error loading table:', error);
            if (tableLoading) {
                tableLoading.innerHTML = '<p style="color: #ff6b6b;">Error loading table data. Please refresh the page.</p>';
            }
        });

        setupChat();
        setupApiKeyInput();
    } catch (error) {
        console.error('Error initializing page:', error);
        const tableBody = document.getElementById('tableBody');
        if (tableBody) {
            tableBody.innerHTML = '<tr><td colspan="10" style="text-align: center; padding: 20px; color: #ff6b6b;">Error loading data. Please check console for details.</td></tr>';
        }
    }
});

// ============================================================
// Make sticky headers work without forcing ugly styles
// ============================================================
function ensureWrapperScroll(wrapper) {
    if (!wrapper) return;

    const cs = window.getComputedStyle(wrapper);

    if (cs.overflowY === 'visible') {
        wrapper.style.overflowY = 'auto';
    }
    if (cs.position === 'static') {
        wrapper.style.position = 'relative';
    }

    if ((cs.maxHeight === 'none' || cs.maxHeight === '') && (cs.height === 'auto' || cs.height === '0px')) {
        wrapper.style.maxHeight = 'calc(100vh - 450px)';
    }
}

function applyStickyHeaderStyles() {
    const table = document.getElementById('collectionTable');
    if (!table) return;

    const thead = table.querySelector('thead');
    const ths = table.querySelectorAll('thead th');
    if (!thead || !ths.length) return;

    thead.style.position = 'sticky';
    thead.style.top = '0px';
    thead.style.zIndex = '100';
    thead.style.background = 'transparent';
    thead.style.backgroundColor = 'transparent';

    const theadTr = thead.querySelector('tr');
    if (theadTr) {
        theadTr.style.position = 'sticky';
        theadTr.style.top = '0px';
        theadTr.style.zIndex = '100';
        theadTr.style.background = 'transparent';
        theadTr.style.backgroundColor = 'transparent';
        theadTr.style.backdropFilter = 'none';
    }

    ths.forEach(th => {
        th.style.position = 'sticky';
        th.style.top = '0px';
        th.style.zIndex = '100';

        th.style.setProperty('background', 'rgba(45, 45, 68, 0.85)', 'important');
        th.style.setProperty('background-color', 'rgba(45, 45, 68, 0.85)', 'important');
        th.style.setProperty('backdrop-filter', 'blur(10px)', 'important');
        th.style.setProperty('transform', 'translateZ(0)', 'important');
        th.style.setProperty('-webkit-backface-visibility', 'hidden', 'important');
        th.style.setProperty('backface-visibility', 'hidden', 'important');

        th.style.isolation = 'isolate';
    });

    requestAnimationFrame(() => {
        table.offsetHeight;
    });
}

// ============================================================
// API key input (unchanged)
// ============================================================
function setupApiKeyInput() {
    const toggleBtn = document.getElementById('toggleApiKey');
    const apiKeyContainer = document.getElementById('apiKeyContainer');
    const saveBtn = document.getElementById('saveApiKey');
    const apiKeyInput = document.getElementById('apiKeyInput');

    if (!toggleBtn || !apiKeyContainer) return;

    const existingKey = localStorage.getItem('OPENAI_API_KEY');
    if (existingKey) {
        apiKeyInput.value = existingKey;
        toggleBtn.textContent = 'Update API Key';
    }

    toggleBtn.addEventListener('click', () => {
        apiKeyContainer.style.display = apiKeyContainer.style.display === 'none' ? 'flex' : 'none';
    });

    saveBtn.addEventListener('click', () => {
        const key = apiKeyInput.value.trim();
        if (key) {
            localStorage.setItem('OPENAI_API_KEY', key);
            toggleBtn.textContent = 'Update API Key';
            apiKeyContainer.style.display = 'none';
            alert('API key saved! You can now use ChatGPT.');
        }
    });

    apiKeyInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') saveBtn.click();
    });
}

// ============================================================
// Generate table headers dynamically
// ============================================================
function generateTableHeaders() {
    const thead = document.querySelector('#collectionTable thead tr');
    if (!thead) {
        console.error('Table header row not found');
        return;
    }

    if (csvHeaders.length === 0) {
        console.warn('No headers found. Using default headers.');
        csvHeaders = ['plrName', 'trnName', 'FinalPosition', 'TournPurse', 'year'];
    }

    thead.innerHTML = '';

    const numericColumns = ['FinalPosition', 'TournPurse', 'year', 'plrNum', 'T_ID'];

    csvHeaders.forEach(header => {
        const th = document.createElement('th');
        const hasFilter = filterableColumns.includes(header);
        const isNumeric = numericColumns.includes(header) || header.includes('Last') || header.includes('Percentage') || header.includes('Average');
        const sortText = isNumeric ? 'Sort Low-High' : 'Sort A-Z';
        const sortTextDesc = isNumeric ? 'Sort High-Low' : 'Sort Z-A';

        th.innerHTML = `
            <div class="th-content">
                <span>${header}</span>
                ${hasFilter ? `
                    <button class="filter-btn" data-column="${header}" title="Filter & Sort">
                        <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
                            <path d="M6 0L4.5 1.5H7.5L6 0ZM6 12L7.5 10.5H4.5L6 12ZM6 3L3 6H9L6 3ZM6 9L9 6H3L6 9Z"/>
                        </svg>
                    </button>
                ` : ''}
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
            ` : ''}
        `;

        thead.appendChild(th);
    });
}

// ============================================================
// Load data into table
// ============================================================
function loadTableData(data = filteredData, adjustWidths = true) {
    return new Promise((resolve) => {
        const tableBody = document.getElementById('tableBody');
        if (!tableBody) {
            console.error('Table body not found');
            resolve();
            return;
        }

        requestAnimationFrame(() => {
            tableBody.innerHTML = '';

            if (!data || data.length === 0) {
                const colspan = csvHeaders.length || 5;
                tableBody.innerHTML = `<tr><td colspan="${colspan}" style="text-align: center; padding: 20px;">No data to display</td></tr>`;
                resolve();
                return;
            }

            const headerCells = document.querySelectorAll('#collectionTable thead th');
            const headerWidths = Array.from(headerCells).map(th => th.style.width || th.offsetWidth + 'px');

            const fragment = document.createDocumentFragment();

            data.forEach((item) => {
                const row = document.createElement('tr');

                csvHeaders.forEach((header, colIndex) => {
                    const cell = document.createElement('td');
                    let value = item[header];

                    if (value === null || value === undefined || value === '') value = '-';
                    else value = String(value);

                    if (header === 'TournPurse') {
                        const purse = parseFloat(value);
                        value = purse > 0 ? `$${(purse / 1000000).toFixed(1)}M` : '-';
                    } else if (header === 'endDate' && value !== '-') {
                        const d = new Date(value);
                        if (!isNaN(d.getTime())) value = d.toLocaleDateString();
                    }

                    cell.textContent = value;
                    cell.setAttribute('data-column', header);

                    if (headerWidths[colIndex]) {
                        cell.style.width = headerWidths[colIndex];
                        cell.style.minWidth = headerWidths[colIndex];
                        cell.style.maxWidth = headerWidths[colIndex];
                    }

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

// Auto-adjust column widths based on content
function autoAdjustColumnWidths() {
    const table = document.getElementById('collectionTable');
    if (!table) return;

    const thead = table.querySelector('thead tr');
    const tbody = table.querySelector('tbody');
    if (!thead || !tbody) return;

    const headerCells = thead.querySelectorAll('th');
    const rows = tbody.querySelectorAll('tr');
    if (headerCells.length === 0 || rows.length === 0) return;

    const measure = document.createElement('div');
    measure.style.position = 'absolute';
    measure.style.visibility = 'hidden';
    measure.style.whiteSpace = 'nowrap';
    measure.style.fontSize = window.getComputedStyle(headerCells[0]).fontSize;
    measure.style.fontFamily = window.getComputedStyle(headerCells[0]).fontFamily;
    measure.style.padding = '12px';
    document.body.appendChild(measure);

    headerCells.forEach((th, colIndex) => {
        let maxWidth = 0;

        const headerText = th.querySelector('.th-content span')?.textContent || '';
        measure.textContent = headerText;
        maxWidth = Math.max(maxWidth, measure.offsetWidth);

        const sampleSize = Math.min(10, rows.length);
        for (let i = 0; i < sampleSize; i++) {
            const cell = rows[i].querySelectorAll('td')[colIndex];
            if (cell) {
                measure.textContent = cell.textContent;
                maxWidth = Math.max(maxWidth, measure.offsetWidth);
            }
        }

        const hasFilter = th.querySelector('.filter-btn');
        const padding = hasFilter ? 50 : 25;
        const finalWidth = maxWidth + padding;

        const minWidth = 60;
        const maxWidthLimit = 200;
        const optimalWidth = Math.max(minWidth, Math.min(finalWidth, maxWidthLimit));

        th.style.width = `${optimalWidth}px`;
        th.style.minWidth = `${optimalWidth}px`;

        rows.forEach(row => {
            const cells = row.querySelectorAll('td');
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
// Floating dropdown helpers
// ============================================================
function detachDropdownToBody(dropdown) {
    if (!dropdown) return;
    if (dropdown.parentElement !== document.body) {
        document.body.appendChild(dropdown);
    }
    dropdown.style.position = 'fixed';
    dropdown.style.zIndex = '9999';
}

function reattachDropdown(dropdown) {
    if (!dropdown) return;
    const col = dropdown.dataset.column;
    const th = document.querySelector(`#collectionTable thead .filter-btn[data-column="${col}"]`)?.closest('th');
    if (th && dropdown.parentElement === document.body) {
        th.appendChild(dropdown);
        dropdown.style.position = '';
        dropdown.style.top = '';
        dropdown.style.left = '';
        dropdown.style.zIndex = '';
        dropdown.style.maxHeight = '';
        dropdown.style.visibility = '';
        dropdown.style.display = '';
    }
}

function positionDropdown(dropdown, button) {
    const th = button.closest('th');
    if (!th) return;

    detachDropdownToBody(dropdown);

    dropdown.style.display = 'block';
    dropdown.style.visibility = 'hidden';

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
    else dropdown.style.maxHeight = '';

    dropdown.style.top = `${top}px`;
    dropdown.style.left = `${left}px`;
    dropdown.style.visibility = 'visible';
}

// ============================================================
// Setup table filters
// ============================================================
function setupTableFilters() {
    const filterButtons = document.querySelectorAll('.filter-btn');
    const filterDropdowns = document.querySelectorAll('.filter-dropdown');

    filterDropdowns.forEach(dropdown => {
        const column = dropdown.dataset.column;
        populateFilterOptions(column, dropdown);
    });

    filterButtons.forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();

            const column = btn.dataset.column;
            const dropdown = document.querySelector(`.filter-dropdown[data-column="${column}"]`);
            if (!dropdown) return;

            if (gOpenDropdown === dropdown && dropdown.classList.contains('active')) {
                closeAllDropdowns();
                return;
            }

            closeAllDropdowns();

            dropdown.classList.add('active');
            gOpenDropdown = dropdown;
            gOpenButton = btn;

            positionDropdown(dropdown, btn);

            const wrapper = document.getElementById('tableWrapper');

            gRepositionHandler = () => {
                if (!gOpenDropdown || !gOpenDropdown.classList.contains('active')) return;
                positionDropdown(gOpenDropdown, gOpenButton);
            };

            window.addEventListener('scroll', gRepositionHandler, { passive: true });
            window.addEventListener('resize', gRepositionHandler);
            if (wrapper) wrapper.addEventListener('scroll', gRepositionHandler, { passive: true });
        });
    });

    document.addEventListener('click', (e) => {
        if (!e.target.closest('.filter-dropdown') && !e.target.closest('.filter-btn')) {
            closeAllDropdowns();
        }
    });

    document.querySelectorAll('.filter-input').forEach(input => {
        input.addEventListener('input', (e) => {
            const dropdown = e.target.closest('.filter-dropdown');
            const searchTerm = e.target.value.toLowerCase();
            filterOptionsBySearch(dropdown, searchTerm);
        });
    });

    document.addEventListener('change', (e) => {
        if (e.target.type === 'checkbox' && e.target.classList.contains('filter-checkbox')) {
            const dropdown = e.target.closest('.filter-dropdown');
            const column = dropdown.dataset.column;
            const value = e.target.value;
            const checked = e.target.checked;

            applyFilter(column, value, checked);
        }
    });

    document.querySelectorAll('.sort-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const dropdown = e.target.closest('.filter-dropdown');
            const column = dropdown.dataset.column;
            const direction = e.target.dataset.sort;

            applySort(column, direction);
            closeAllDropdowns();
        });
    });

    document.querySelectorAll('.clear-filter-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const dropdown = e.target.closest('.filter-dropdown');
            const column = dropdown.dataset.column;

            clearFilter(column);
            closeAllDropdowns();
        });
    });
}

function closeAllDropdowns() {
    document.querySelectorAll('.filter-dropdown.active').forEach(dd => {
        dd.classList.remove('active');
        reattachDropdown(dd);
    });

    if (gRepositionHandler) {
        const wrapper = document.getElementById('tableWrapper');
        window.removeEventListener('scroll', gRepositionHandler);
        window.removeEventListener('resize', gRepositionHandler);
        if (wrapper) wrapper.removeEventListener('scroll', gRepositionHandler);
    }

    gOpenDropdown = null;
    gOpenButton = null;
    gRepositionHandler = null;
}

function populateFilterOptions(column, dropdown) {
    const optionsContainer = dropdown.querySelector('.filter-options');
    const uniqueValues = getUniqueValues(column);

    optionsContainer.innerHTML = '';

    uniqueValues.forEach(value => {
        const label = document.createElement('label');
        label.className = 'filter-option';
        label.innerHTML = `
            <input type="checkbox" class="filter-checkbox" value="${value}" data-column="${column}">
            <span>${value}</span>
        `;
        optionsContainer.appendChild(label);
    });
}

function getUniqueValues(column) {
    const values = originalData.map(item => {
        if (column === '_id' || column === 'id') return item._id;
        const value = item[column];
        if (value === null || value === undefined || value === '') return '';
        return String(value);
    }).filter(v => v !== '');

    return [...new Set(values)].sort();
}

function filterOptionsBySearch(dropdown, searchTerm) {
    const options = dropdown.querySelectorAll('.filter-option');
    options.forEach(option => {
        const text = option.textContent.toLowerCase();
        option.style.display = text.includes(searchTerm) ? '' : 'none';
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
                const itemValue = (item[col] === null || item[col] === undefined) ? '' : String(item[col]);
                return filterValues.includes(itemValue);
            });
        }
    });

    if (activeSort.column) applySort(activeSort.column, activeSort.direction);
    else loadTableData(filteredData, false);

    updateClearAllButtonVisibility();
}

function applySort(column, direction) {
    activeSort = { column, direction };

    filteredData.sort((a, b) => {
        const aNum = parseFloat(a[column]);
        const bNum = parseFloat(b[column]);

        let aVal, bVal;
        if (!isNaN(aNum) && !isNaN(bNum)) {
            aVal = aNum;
            bVal = bNum;
            return direction === 'asc' ? aVal - bVal : bVal - aVal;
        } else {
            aVal = String(a[column] || '').toLowerCase();
            bVal = String(b[column] || '').toLowerCase();
            return direction === 'asc' ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
        }
    });

    loadTableData(filteredData, false);
    updateSortIndicators(column, direction);
    updateClearAllButtonVisibility();
}

function updateSortIndicators(column, direction) {
    document.querySelectorAll('.filter-btn').forEach(btn => {
        btn.classList.remove('sorted-asc', 'sorted-desc');
        if (btn.dataset.column === column) {
            btn.classList.add(direction === 'asc' ? 'sorted-asc' : 'sorted-desc');
        }
    });
}

function clearFilter(column) {
    delete activeFilters[column];

    const dropdown = document.querySelector(`.filter-dropdown[data-column="${column}"]`);
    if (dropdown) {
        dropdown.querySelectorAll('.filter-checkbox').forEach(cb => cb.checked = false);
        const searchInput = dropdown.querySelector('.filter-input');
        if (searchInput) searchInput.value = '';
    }

    if (activeSort.column === column) {
        activeSort = { column: null, direction: null };
        updateSortIndicators(null, null);
    }

    filteredData = [...originalData];

    Object.keys(activeFilters).forEach(col => {
        const filterValues = activeFilters[col];
        if (filterValues && filterValues.length > 0) {
            filteredData = filteredData.filter(item => {
                const itemValue = (item[col] === null || item[col] === undefined) ? '' : String(item[col]);
                return filterValues.includes(itemValue);
            });
        }
    });

    if (activeSort.column) applySort(activeSort.column, activeSort.direction);
    else loadTableData(filteredData, false);

    updateClearAllButtonVisibility();
}

function updateClearAllButtonVisibility() {
    const clearAllBtn = document.getElementById('clearAllFiltersBtn');
    if (!clearAllBtn) return;

    const hasFilters = Object.keys(activeFilters).length > 0 || activeSort.column !== null;
    clearAllBtn.style.opacity = hasFilters ? '1' : '0.5';
    clearAllBtn.style.pointerEvents = hasFilters ? 'auto' : 'none';
    clearAllBtn.disabled = !hasFilters;
}

function setupClearAllFiltersButton() {
    const clearAllBtn = document.getElementById('clearAllFiltersBtn');
    if (!clearAllBtn) return;

    clearAllBtn.addEventListener('click', () => {
        // Clear all active filters
        activeFilters = {};

        // Clear all checkboxes and search inputs
        document.querySelectorAll('.filter-dropdown').forEach(dropdown => {
            dropdown.querySelectorAll('.filter-checkbox').forEach(cb => cb.checked = false);
            const searchInput = dropdown.querySelector('.filter-input');
            if (searchInput) searchInput.value = '';
        });

        // Clear sort
        activeSort = { column: null, direction: null };
        updateSortIndicators(null, null);

        // Reset data
        filteredData = [...originalData];
        loadTableData(filteredData, false);

        closeAllDropdowns();
        updateClearAllButtonVisibility();
    });

    updateClearAllButtonVisibility();
}

// ============================================================
// Chat UI
// ============================================================
function setupChat() {
    const chatInput = document.getElementById('chatInput');
    const sendButton = document.getElementById('sendButton');
    const chatMessages = document.getElementById('chatMessages');
    if (!chatInput || !sendButton || !chatMessages) return;

    sendButton.addEventListener('click', sendMessage);

    chatInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    });

    async function sendMessage() {
        const userMessage = chatInput.value.trim();
        if (!userMessage) return;

        chatInput.disabled = true;
        sendButton.disabled = true;

        addMessage(userMessage, 'user');
        chatInput.value = '';

        const loadingMessage = addMessage('', 'bot', true);

        try {
            const response = await callChatGPTAPI(userMessage);
            loadingMessage.remove();
            addMessage(response, 'bot');
        } catch (error) {
            loadingMessage.remove();
            addMessage(`Sorry, I encountered an error: ${error.message || error}`, 'bot');
        } finally {
            chatInput.disabled = false;
            sendButton.disabled = false;
            chatInput.focus();
        }
    }

    function addMessage(text, sender, isLoading = false) {
        const messageDiv = document.createElement('div');
        messageDiv.className = `message ${sender}-message`;

        const contentDiv = document.createElement('div');
        contentDiv.className = 'message-content';

        if (isLoading) {
            contentDiv.innerHTML = '<span class="loading"></span>';
        } else {
            contentDiv.textContent = text;
        }

        messageDiv.appendChild(contentDiv);
        chatMessages.appendChild(messageDiv);
        chatMessages.scrollTop = chatMessages.scrollHeight;

        return messageDiv;
    }
}

// ============================================================
// YOUR EXISTING OpenAI / file_search code goes here
// ============================================================
async function callChatGPTAPI(userMessage) {
    // You’ll replace this later with a Wix backend endpoint (recommended).
    return `callChatGPTAPI not pasted. User asked: ${userMessage}`;
}
