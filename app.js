const statusEl = document.getElementById('status');
const resultsEl = document.getElementById('results');
const resIdInput = document.getElementById('res-id');
const fieldSelect = document.getElementById('target-field');
const loadButton = document.getElementById('load-button');

const allowedFields = ['drug_info', 'medical_history'];

// Uses the ENV object loaded from config.js
function getApiUrl() {
  if (location.hostname === 'localhost' || location.hostname === '127.0.0.1') {
    return ENV.LOCAL_URL;
  }
  return ENV.LAMBDA_URL;
}

async function fetchData(resId, field) {
  const queryString = `?res_id=${encodeURIComponent(resId)}&field=${encodeURIComponent(field)}`;

  try {
    const apiUrl = getApiUrl();
    const response = await fetch(`${apiUrl}/api/data${queryString}`);
    
    if (!response.ok) {
      const payload = await response.json().catch(() => null);
      const message = payload?.error || `Server returned ${response.status}`;
      throw new Error(message);
    }

    const payload = await response.json();
    renderData(payload);
  } catch (error) {
    statusEl.textContent = 'Unable to load data.';
    statusEl.classList.add('error');
    statusEl.classList.remove('hidden');
    resultsEl.classList.add('hidden');
    resultsEl.innerHTML = `<pre>${error.message}</pre>`;
    console.error(error);
  }
}

function renderData(payload) {
  const { data, meta } = payload;
  statusEl.textContent = '';
  statusEl.classList.remove('error');
  statusEl.classList.add('hidden');
  resultsEl.classList.remove('hidden');

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
          Object.entries(entry).forEach(([key, nestedValue]) => {
            if (key === 'drug' && nestedValue === 'Yes') return;
            const entryLine = document.createElement('div');
            entryLine.textContent = `${key}: ${nestedValue == null ? '' : String(nestedValue)}`;
            fragment.appendChild(entryLine);
          });
        } else {
          const entryLine = document.createElement('div');
          entryLine.textContent = String(entry);
          fragment.appendChild(entryLine);
        }

        if (index < value.length - 1) {
          const separator = document.createElement('div');
          separator.className = 'value-separator';
          fragment.appendChild(separator);
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
}

loadButton.addEventListener('click', () => {
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