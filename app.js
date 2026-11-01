const statusEl = document.getElementById('status');
const resultsEl = document.getElementById('results');
const resIdInput = document.getElementById('res-id');
const fieldSelect = document.getElementById('target-field');
const loadButton = document.getElementById('load-button');

const allowedFields = ['drug_info', 'medical_history', 'biobank_collection'];
let latestRequest = 0;

// Uses the ENV object loaded from config.js
function getApiUrl() {
  if (location.hostname === 'localhost' || location.hostname === '127.0.0.1' || location.protocol === 'file:') {
    return ENV.LOCAL_URL;
  }
  return ENV.LAMBDA_URL;
}

async function fetchData(resId, field) {
  const request = ++latestRequest;
  const queryString = `?res_id=${encodeURIComponent(resId)}&field=${encodeURIComponent(field)}`;

  try {
    const apiUrl = getApiUrl();
    const endpoint = field === 'biobank_collection' ? '/api/biobank' : '/api/data';
    const response = await fetch(`${apiUrl}${endpoint}${queryString}`, { cache: 'no-store' });
    
    if (!response.ok) {
      const payload = await response.json().catch(() => null);
      const message = payload?.error || `Server returned ${response.status}`;
      throw new Error(message);
    }

    const payload = await response.json();
    if (request !== latestRequest) return;
    renderData(payload);
  } catch (error) {
    if (request !== latestRequest) return;
    statusEl.textContent = error.message || 'Unable to load data.';
    statusEl.classList.add('error');
    statusEl.classList.remove('hidden');
    resultsEl.classList.add('hidden');
    resultsEl.textContent = '';
    console.error(error);
  }
}

function renderData(payload) {
  const { data, meta } = payload;
  statusEl.textContent = '';
  statusEl.classList.remove('error');
  statusEl.classList.add('hidden');
  resultsEl.classList.remove('hidden');

  if (meta?.field === 'biobank_collection') {
    renderBiobank(data, meta);
    return;
  }

  if (!Array.isArray(data) || data.length === 0) {
    resultsEl.innerHTML = '<p>No documents were returned from the database.</p>';
    return;
  }

  const table = document.createElement('table');
  table.className = 'data-table';

  const header = document.createElement('tr');
  header.innerHTML = `<th>res_id</th><th>${meta.field}</th>`;
  table.appendChild(header);

  data.forEach((item) => {
    const row = document.createElement('tr');
    const resIdCell = document.createElement('td');
    resIdCell.textContent = item.res_id ?? '';

    const valueCell = document.createElement('td');
    const value = item[meta.field];

    function appendObjectEntries(obj) {
      const fragment = document.createDocumentFragment();
      Object.entries(obj).forEach(([key, nestedValue]) => {
        if (key === 'drug' && nestedValue === 'Yes') return;

        const rowItem = document.createElement('div');
        rowItem.className = 'value-pair';
        const label = document.createElement('span');
        label.className = 'value-label';
        label.textContent = `${key}: `;
        const content = document.createElement('span');
        content.textContent = nestedValue == null ? '' : String(nestedValue);
        rowItem.appendChild(label);
        rowItem.appendChild(content);
        fragment.appendChild(rowItem);
      });
      valueCell.appendChild(fragment);
    }

    if (typeof value === 'string' || typeof value === 'number') {
      valueCell.textContent = value;
    } else if (Array.isArray(value)) {
      const fragment = document.createDocumentFragment();
      
      value.forEach((entry, index) => {
        if (entry && typeof entry === 'object') {
          // Create a "Card" for each drug/item
          const itemBox = document.createElement('div');
          itemBox.className = 'nested-item';

          // Pre-compute values needed for conditional logic
          const isOngoing = String(entry['drug_ongoing'] ?? entry['ongoing'] ?? '').toLowerCase() === 'yes';
          const indication = entry['indication'];
          const otherIndication = entry['other_indication'];

          Object.entries(entry).forEach(([key, nestedValue]) => {
            // Skip redundant 'drug: Yes' flag and empty/null values
            if (key === 'drug' && nestedValue === 'Yes') return;
            if (nestedValue == null || nestedValue === '') return;

            // Do not display source
            if (key === 'source') return;

            // Do not display other_indication as its own row (merged into indication)
            if (key === 'other_indication') return;

            // Hide stop date when drug is ongoing
            if ((key === 'drug_stop_date' || key === 'stop_date') && isOngoing) return;

            let displayValue = String(nestedValue);

            // Start date: show date portion only (strip time)
            if (key === 'drug_start_date' || key === 'start_date') {
              displayValue = displayValue.split('T')[0].split(' ')[0];
            }

            // Stop date: show date portion only (strip time)
            if (key === 'drug_stop_date' || key === 'stop_date') {
              displayValue = displayValue.split('T')[0].split(' ')[0];
            }

            // Indication: strip leading serial numbers (e.g. "1. ", "2) ")
            // and if "None of the above", show other_indication instead
            if (key === 'indication') {
              const cleaned = displayValue.replace(/^\d+[\.\)]\s*/, '').trim();
              if (/none of the above/i.test(cleaned)) {
                displayValue = (otherIndication != null && otherIndication !== '')
                  ? String(otherIndication)
                  : cleaned;
              } else {
                displayValue = cleaned;
              }
            }

            const rowItem = document.createElement('div');
            rowItem.className = 'value-pair';

            // Format the key (e.g., 'drug_name' -> 'Drug Name')
            const formattedKey = key.split('_')
                                    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
                                    .join(' ');

            const label = document.createElement('span');
            label.className = 'value-label';
            label.textContent = `${formattedKey}: `;

            const content = document.createElement('span');
            content.textContent = displayValue;

            // Highlight the drug name to act as a card header
            if (key === 'drug_name') {
              content.className = 'primary-value';
            }

            rowItem.appendChild(label);
            rowItem.appendChild(content);
            itemBox.appendChild(rowItem);
          });
          
          fragment.appendChild(itemBox);
        } else {
          // Fallback for simple arrays of strings/numbers
          const entryLine = document.createElement('div');
          entryLine.textContent = String(entry);
          fragment.appendChild(entryLine);
        }
      });
      valueCell.appendChild(fragment);
    } else if (value && typeof value === 'object') {
      appendObjectEntries(value);
    } else {
      valueCell.textContent = '';
    }

    row.appendChild(resIdCell);
    row.appendChild(valueCell);
    table.appendChild(row);
  });

  resultsEl.innerHTML = '';
  resultsEl.appendChild(table);

  const correctionBanner = document.createElement('p');
  correctionBanner.className = 'correction-notice';
  correctionBanner.innerHTML = `Found an error in the data? <a href="https://nus.syd1.qualtrics.com/jfe/form/SV_3DXkphuzE4AUHXM" target="_blank" rel="noopener noreferrer" class="correction-link">Submit a Data Correction</a>`;
  resultsEl.appendChild(correctionBanner);
}

function renderBiobank(data, meta) {
  resultsEl.replaceChildren();
  const add = (tag, text, parent) => {
    const node = document.createElement(tag);
    node.textContent = text;
    parent.appendChild(node);
    return node;
  };
  add('h2', `Biobank collection · ${meta.res_id}`, resultsEl);
  if (!Array.isArray(data) || !data.length) {
    add('p', 'No biobank collection records found for this participant.', resultsEl);
    return;
  }
  add('p', `${data.length} tube observations. Each row is a recorded observation; repeated submissions are retained.`, resultsEl);
  const columns = [
    ['collection_date', 'Collection date'], ['sample_type', 'Sample type'],
    ['box_id', 'Box ID'], ['box_position', 'Position'],
    ['sample_location', 'Location'], ['repeated_position_across_submissions', 'Repeated position across submissions'],
  ];
  for (const visit of [...new Set(data.map(row => row.visit_code))]) {
    const rows = data.filter(row => row.visit_code === visit);
    const section = document.createElement('section');
    section.className = 'biobank-visit';
    resultsEl.appendChild(section);
    add('h3', `Visit ${visit} · ${rows.length} observations`, section);
    const wrapper = document.createElement('div');
    wrapper.className = 'biobank-table-wrap';
    wrapper.tabIndex = 0;
    wrapper.setAttribute('role', 'region');
    wrapper.setAttribute('aria-label', `Visit ${visit} biobank observations`);
    section.appendChild(wrapper);
    const table = document.createElement('table');
    table.className = 'data-table biobank-table';
    wrapper.appendChild(table);
    const head = document.createElement('thead');
    table.appendChild(head);
    const header = document.createElement('tr');
    head.appendChild(header);
    columns.forEach(([, label]) => add('th', label, header).setAttribute('scope', 'col'));
    const body = document.createElement('tbody');
    table.appendChild(body);
    rows.forEach(record => {
      const row = document.createElement('tr');
      body.appendChild(row);
      columns.forEach(([key]) => {
        const value = record[key];
        add('td', value == null || value === '' ? 'Not recorded' : typeof value === 'boolean' ? (value ? 'Yes' : 'No') : String(value), row);
      });
    });
  }
}

loadButton.addEventListener('click', () => {
  // Invalidate earlier requests even if this input is rejected below.
  latestRequest++;
  const resId = resIdInput.value.trim().toUpperCase();
  const field = fieldSelect.value;

  if (!resId) {
    statusEl.textContent = 'Please enter a res_id.';
    statusEl.classList.add('error');
    statusEl.classList.remove('hidden');
    resultsEl.innerHTML = '';
    resultsEl.classList.add('hidden');
    return;
  }

  if (!allowedFields.includes(field)) {
    statusEl.textContent = 'Invalid field selection.';
    statusEl.classList.add('error');
    statusEl.classList.remove('hidden');
    resultsEl.innerHTML = '';
    resultsEl.classList.add('hidden');
    return;
  }

  statusEl.textContent = 'Loading data…';
  statusEl.classList.remove('error');
  statusEl.classList.remove('hidden');
  resultsEl.classList.add('hidden');
  fetchData(resId, field);
});
