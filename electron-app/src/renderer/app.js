// DOM Elements
const recordBtn = document.getElementById('recordBtn');
const recordText = document.getElementById('recordText');
const settingsBtn = document.getElementById('settingsBtn');
const datePicker = document.getElementById('datePicker');
const prevDayBtn = document.getElementById('prevDayBtn');
const nextDayBtn = document.getElementById('nextDayBtn');
const todayBtn = document.getElementById('todayBtn');
const timeline = document.getElementById('timeline');

// Modals
const settingsModal = document.getElementById('settingsModal');
const closeSettingsBtn = document.getElementById('closeSettingsBtn');
const saveSettingsBtn = document.getElementById('saveSettingsBtn');
const videoModal = document.getElementById('videoModal');
const closeVideoBtn = document.getElementById('closeVideoBtn');
const videoPlayer = document.getElementById('videoPlayer');
const videoTitle = document.getElementById('videoTitle');
const videoDescription = document.getElementById('videoDescription');

// Settings inputs
const providerRadios = document.querySelectorAll('input[name="provider"]');
const geminiApiKey = document.getElementById('geminiApiKey');
const geminiSettings = document.getElementById('geminiSettings');
const ollamaSettings = document.getElementById('ollamaSettings');
const ollamaUrl = document.getElementById('ollamaUrl');
const ollamaModel = document.getElementById('ollamaModel');

// State
let isRecording = false;
let currentDate = new Date();

// Initialize
async function init() {
  // Set today's date
  setDatePickerValue(currentDate);

  // Load recording state
  await updateRecordingState();

  // Load timeline
  await loadTimeline(currentDate);

  // Load settings
  await loadSettings();

  // Set up event listeners
  setupEventListeners();
}

function setupEventListeners() {
  // Recording button
  recordBtn.addEventListener('click', toggleRecording);

  // Settings button
  settingsBtn.addEventListener('click', () => {
    settingsModal.classList.remove('hidden');
  });

  closeSettingsBtn.addEventListener('click', () => {
    settingsModal.classList.add('hidden');
  });

  saveSettingsBtn.addEventListener('click', saveSettings);

  // Video modal
  closeVideoBtn.addEventListener('click', () => {
    videoModal.classList.add('hidden');
    videoPlayer.pause();
    videoPlayer.src = '';
  });

  // Date navigation
  datePicker.addEventListener('change', (e) => {
    currentDate = new Date(e.target.value);
    loadTimeline(currentDate);
  });

  prevDayBtn.addEventListener('click', () => {
    currentDate.setDate(currentDate.getDate() - 1);
    setDatePickerValue(currentDate);
    loadTimeline(currentDate);
  });

  nextDayBtn.addEventListener('click', () => {
    currentDate.setDate(currentDate.getDate() + 1);
    setDatePickerValue(currentDate);
    loadTimeline(currentDate);
  });

  todayBtn.addEventListener('click', () => {
    currentDate = new Date();
    setDatePickerValue(currentDate);
    loadTimeline(currentDate);
  });

  // Provider radio buttons
  providerRadios.forEach(radio => {
    radio.addEventListener('change', (e) => {
      if (e.target.value === 'gemini') {
        geminiSettings.classList.remove('hidden');
        ollamaSettings.classList.add('hidden');
      } else {
        geminiSettings.classList.add('hidden');
        ollamaSettings.classList.remove('hidden');
      }
    });
  });
}

function setDatePickerValue(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  datePicker.value = `${year}-${month}-${day}`;
}

async function toggleRecording() {
  try {
    if (isRecording) {
      const result = await window.dayflow.stopRecording();
      if (result.success) {
        isRecording = false;
        updateRecordingUI();
      }
    } else {
      const result = await window.dayflow.startRecording();
      if (result.success) {
        isRecording = true;
        updateRecordingUI();
      } else {
        alert('Failed to start recording: ' + result.error);
      }
    }
  } catch (error) {
    console.error('Error toggling recording:', error);
    alert('Error: ' + error.message);
  }
}

async function updateRecordingState() {
  try {
    isRecording = await window.dayflow.getRecordingState();
    updateRecordingUI();
  } catch (error) {
    console.error('Error getting recording state:', error);
  }
}

function updateRecordingUI() {
  if (isRecording) {
    recordBtn.classList.add('recording');
    recordText.textContent = 'Stop Recording';
  } else {
    recordBtn.classList.remove('recording');
    recordText.textContent = 'Start Recording';
  }
}

async function loadTimeline(date) {
  try {
    const result = await window.dayflow.getTimeline(date.getTime());

    if (!result.success) {
      console.error('Failed to load timeline:', result.error);
      return;
    }

    const cards = result.cards;

    if (cards.length === 0) {
      timeline.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">📊</div>
          <h2>No activities yet</h2>
          <p>Start recording to see your activity timeline</p>
        </div>
      `;
      return;
    }

    // Render timeline cards
    timeline.innerHTML = cards.map(card => renderTimelineCard(card)).join('');

    // Add click handlers
    document.querySelectorAll('.timeline-card').forEach(card => {
      card.addEventListener('click', () => {
        const cardId = parseInt(card.dataset.cardId);
        const cardData = cards.find(c => c.id === cardId);
        if (cardData) {
          showVideoModal(cardData);
        }
      });
    });
  } catch (error) {
    console.error('Error loading timeline:', error);
  }
}

function renderTimelineCard(card) {
  const startTime = new Date(card.start_time);
  const endTime = new Date(card.end_time);
  const duration = Math.round((endTime - startTime) / 1000 / 60); // minutes

  const timeStr = formatTime(startTime) + ' - ' + formatTime(endTime);
  const categoryClass = 'category-' + card.category.toLowerCase();
  const distractionClass = card.is_distraction ? 'distraction' : '';

  return `
    <div class="timeline-card ${distractionClass}" data-card-id="${card.id}">
      <div class="card-header">
        <div>
          <div class="card-title">${escapeHtml(card.title)}</div>
          <div class="card-category ${categoryClass}">${card.category}</div>
        </div>
        <div class="card-time">${timeStr} (${duration}m)</div>
      </div>
      ${card.description ? `<div class="card-description">${escapeHtml(card.description)}</div>` : ''}
      <div class="card-footer">
        ${card.is_distraction ? '<span class="badge badge-warning">⚠️ Distraction</span>' : ''}
        ${card.video_path ? '<span class="badge">🎥 Timelapse available</span>' : ''}
      </div>
    </div>
  `;
}

function showVideoModal(card) {
  if (!card.video_path) {
    alert('Video not available for this activity');
    return;
  }

  videoTitle.textContent = card.title;
  videoDescription.textContent = card.description || '';
  videoPlayer.src = card.video_path;
  videoModal.classList.remove('hidden');
}

async function loadSettings() {
  try {
    const result = await window.dayflow.getSettings();

    if (!result.success) {
      console.error('Failed to load settings:', result.error);
      return;
    }

    const settings = result.settings;

    // Set provider
    const provider = settings.llm_provider || 'gemini';
    document.querySelector(`input[name="provider"][value="${provider}"]`).checked = true;

    if (provider === 'gemini') {
      geminiSettings.classList.remove('hidden');
      ollamaSettings.classList.add('hidden');
    } else {
      geminiSettings.classList.add('hidden');
      ollamaSettings.classList.remove('hidden');
    }

    // Set API key
    if (settings.gemini_api_key) {
      geminiApiKey.value = settings.gemini_api_key;
    }

    // Set Ollama settings
    if (settings.ollama_url) {
      ollamaUrl.value = settings.ollama_url;
    }
    if (settings.ollama_model) {
      ollamaModel.value = settings.ollama_model;
    }
  } catch (error) {
    console.error('Error loading settings:', error);
  }
}

async function saveSettings() {
  try {
    const provider = document.querySelector('input[name="provider"]:checked').value;

    const settings = {
      llm_provider: provider
    };

    if (provider === 'gemini') {
      settings.gemini_api_key = geminiApiKey.value;
    } else {
      settings.ollama_url = ollamaUrl.value;
      settings.ollama_model = ollamaModel.value;
    }

    const result = await window.dayflow.saveSettings(settings);

    if (result.success) {
      alert('Settings saved successfully!');
      settingsModal.classList.add('hidden');
    } else {
      alert('Failed to save settings: ' + result.error);
    }
  } catch (error) {
    console.error('Error saving settings:', error);
    alert('Error: ' + error.message);
  }
}

function formatTime(date) {
  const hours = date.getHours();
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const ampm = hours >= 12 ? 'PM' : 'AM';
  const displayHours = hours % 12 || 12;
  return `${displayHours}:${minutes} ${ampm}`;
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Start the app
init();
