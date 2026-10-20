// Elements
const resIdInput = document.getElementById('res-id');
const authorizeButton = document.getElementById('authorize-button');
const btnSpinner = document.getElementById('btn-spinner');
const btnText = authorizeButton.querySelector('.btn-text');

const feedbackContainer = document.getElementById('feedback-container');
const statusLoading = document.getElementById('status-loading');
const statusSuccess = document.getElementById('status-success');
const statusError = document.getElementById('status-error');

const displayUserId = document.getElementById('display-user-id');
const displayResId = document.getElementById('display-res-id');
const displayDeviceType = document.getElementById('display-device-type');
const displaySerialNum = document.getElementById('display-serial-num');
const errorMessage = document.getElementById('error-message');
const copyButton = document.getElementById('copy-button');
const reauthContainer = document.getElementById('reauth-container');
const reauthLink = document.getElementById('reauth-link');

// Resolve the correct API base URL using ENV loaded from config.js
function getApiUrl() {
  if (location.hostname === 'localhost' || location.hostname === '127.0.0.1' || location.protocol === 'file:') {
    return ENV.LOCAL_URL;
  }
  return ENV.LAMBDA_URL;
}

// Fetch identity record and update the UI accordingly
async function performAuthorization() {
  const resId = resIdInput.value.trim().toUpperCase();

  if (!resId) {
    showError('Please enter a RESET ID.');
    return;
  }

  // UI state: Loading starting
  setLoadingState(true);
  resetCards();

  try {
    const apiBase = getApiUrl();
    const queryUrl = `${apiBase}/api/authorize?res_id=${encodeURIComponent(resId)}`;
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

// Set up UI during and after async requests
function setLoadingState(isLoading) {
  if (isLoading) {
    resIdInput.disabled = true;
    authorizeButton.disabled = true;
    btnSpinner.classList.remove('hidden');
    btnText.textContent = 'Verifying...';
    
    // Reveal feedback area and show loading card
    feedbackContainer.classList.remove('hidden');
    // Force layout recalculation for transition trigger
    feedbackContainer.offsetHeight; 
    feedbackContainer.classList.add('visible');
    statusLoading.classList.remove('hidden');
  } else {
    resIdInput.disabled = false;
    authorizeButton.disabled = false;
    btnSpinner.classList.add('hidden');
    btnText.textContent = 'Check Authorization';
    statusLoading.classList.add('hidden');
  }
}

// Clean previous results
function resetCards() {
  statusSuccess.classList.add('hidden');
  statusError.classList.add('hidden');
  reauthContainer.classList.add('hidden');
  reauthLink.removeAttribute('href');
}

// Show success card with document details
function showSuccess(data) {
  reauthContainer.classList.add('hidden');
  reauthLink.removeAttribute('href');
  if (typeof data.res_id === 'string' && /^RES[0-9]{1,12}$/.test(data.res_id) &&
      typeof data.object_id === 'string' && /^[a-f0-9]{24}$/i.test(data.object_id)) {
    const url = new URL('https://resetnus.com/data');
    url.searchParams.set('reset_id', data.res_id);
    url.searchParams.set('object_id', data.object_id);
    reauthLink.href = url.toString();
    reauthContainer.classList.remove('hidden');
  }
  displayUserId.textContent = data.user_id || 'N/A';
  displayResId.textContent = data.res_id || 'N/A';
  displayDeviceType.textContent = data.type || 'N/A';
  displaySerialNum.textContent = data.serialNumber || 'N/A';

  statusSuccess.classList.remove('hidden');
}

// Show error card with backend/network messages
function showError(messageText) {
  resetCards();
  errorMessage.textContent = messageText;
  
  feedbackContainer.classList.remove('hidden');
  feedbackContainer.classList.add('visible');
  statusError.classList.remove('hidden');
}

// Copy User ID to Clipboard with active styling
let copyTimeout = null;
copyButton.addEventListener('click', async () => {
  const userId = displayUserId.textContent;
  if (!userId || userId === 'N/A') return;

  try {
    await navigator.clipboard.writeText(userId);
    
    // Copy Success Indication
    copyButton.classList.add('copied');
    const btnSpan = copyButton.querySelector('.copy-btn-text');
    btnSpan.textContent = 'Copied!';
    
    if (copyTimeout) clearTimeout(copyTimeout);
    copyTimeout = setTimeout(() => {
      copyButton.classList.remove('copied');
      btnSpan.textContent = 'Copy';
    }, 2000);
  } catch (err) {
    console.error('Failed to copy to clipboard', err);
  }
});

// Event Listeners
authorizeButton.addEventListener('click', performAuthorization);
resIdInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    performAuthorization();
  }
});
