// Elements
const resIdInput = document.getElementById('res-id');
const findButton = document.getElementById('find-button');
const btnSpinner = document.getElementById('btn-spinner');
const btnText = findButton.querySelector('.btn-text');

const feedbackContainer = document.getElementById('feedback-container');
const statusLoading = document.getElementById('status-loading');
const statusSuccess = document.getElementById('status-success');
const statusError = document.getElementById('status-error');

const displayLatestDate = document.getElementById('display-latest-date');
const displayUserId = document.getElementById('display-user-id');
const displayS3Key = document.getElementById('display-s3-key');
const displayResId = document.getElementById('display-res-id');
const displayLastModified = document.getElementById('display-last-modified');
const errorMessage = document.getElementById('error-message');

const copyUserButton = document.getElementById('copy-user-button');
const copyKeyButton = document.getElementById('copy-key-button');

// Resolve API Base URL from config
function getApiUrl() {
  if (location.hostname === 'localhost' || location.hostname === '127.0.0.1' || location.protocol === 'file:') {
    return ENV.LOCAL_URL;
  }
  return ENV.LAMBDA_URL;
}

// Fetch latest Garmin record details
async function performLookup() {
  const resId = resIdInput.value.trim().toUpperCase();

  if (!resId) {
    showError('Please enter a RESET ID.');
    return;
  }

  setLoadingState(true);
  resetCards();

  try {
    const apiBase = getApiUrl();
    const queryUrl = `${apiBase}/api/latest-date?res_id=${encodeURIComponent(resId)}`;
    const response = await fetch(queryUrl);

    if (!response.ok) {
      const payload = await response.json().catch(() => null);
      const message = payload?.error || `Server returned ${response.status} error.`;
      throw new Error(message);
    }

    const payload = await response.json();
    showSuccess(payload);
  } catch (error) {
    showError(error.message);
  } finally {
    setLoadingState(false);
  }
}

// Manage loading states
function setLoadingState(isLoading) {
  if (isLoading) {
    resIdInput.disabled = true;
    findButton.disabled = true;
    btnSpinner.classList.remove('hidden');
    btnText.textContent = 'Searching...';

    feedbackContainer.classList.remove('hidden');
    // Force reflow
    feedbackContainer.offsetHeight;
    feedbackContainer.classList.add('visible');
    statusLoading.classList.remove('hidden');
  } else {
    resIdInput.disabled = false;
    findButton.disabled = false;
    btnSpinner.classList.add('hidden');
    btnText.textContent = 'Find Latest Entry';
    statusLoading.classList.add('hidden');
  }
}

function resetCards() {
  statusSuccess.classList.add('hidden');
  statusError.classList.add('hidden');
}

// Render data on success
function showSuccess(data) {
  displayLatestDate.textContent = formatDateString(data.latest_date);
  displayUserId.textContent = data.user_id || 'N/A';
  displayS3Key.textContent = data.latest_file_key || 'N/A';
  displayResId.textContent = data.res_id || 'N/A';
  
  if (data.last_modified) {
    const dateObj = new Date(data.last_modified);
    displayLastModified.textContent = dateObj.toLocaleString('en-US', {
      timeZoneName: 'short',
      hour12: false
    });
  } else {
    displayLastModified.textContent = 'N/A';
  }

  statusSuccess.classList.remove('hidden');
}

// Display error messages
function showError(messageText) {
  errorMessage.textContent = messageText;
  feedbackContainer.classList.remove('hidden');
  feedbackContainer.classList.add('visible');
  statusError.classList.remove('hidden');
}

// Format "2026-07-14" into "July 14, 2026"
function formatDateString(dateStr) {
  if (!dateStr) return 'N/A';
  try {
    const [year, month, day] = dateStr.split('-');
    const dateObj = new Date(year, parseInt(month, 10) - 1, day);
    return dateObj.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
  } catch (e) {
    return dateStr;
  }
}

// Clipboard copying utility
function setupClipboardCopy(button, textElement) {
  let timeout = null;
  button.addEventListener('click', async () => {
    const textVal = textElement.textContent;
    if (!textVal || textVal === 'N/A' || textVal === '-') return;

    try {
      await navigator.clipboard.writeText(textVal);
      button.classList.add('copied');
      const btnSpan = button.querySelector('.copy-btn-text');
      btnSpan.textContent = 'Copied!';

      if (timeout) clearTimeout(timeout);
      timeout = setTimeout(() => {
        button.classList.remove('copied');
        btnSpan.textContent = 'Copy';
      }, 2000);
    } catch (err) {
      console.error('Failed to copy to clipboard', err);
    }
  });
}

setupClipboardCopy(copyUserButton, displayUserId);
setupClipboardCopy(copyKeyButton, displayS3Key);

// Listeners
findButton.addEventListener('click', performLookup);
resIdInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    performLookup();
  }
});
