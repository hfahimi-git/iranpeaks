import { initMap, loadPeaks, loadPeaksByState, clearMap } from './map/map';
import { searchPeaks, searchStates } from './db/queries';

initMap('map');

const searchInput = document.getElementById('searchInput') as HTMLInputElement;
const searchBtn = document.getElementById('searchBtn') as HTMLButtonElement;
const clearBtn = document.getElementById('clearBtn') as HTMLButtonElement;
const suggestionsBox = document.getElementById('suggestions') as HTMLDivElement;

// ======================
// متغیرهای مربوط به کیبورد
// ======================
let selectedIndex = -1;
let currentSuggestions: Array<{ type: 'peak' | 'state'; value: string; label: string }> = [];

// ======================
// جستجو
// ======================
async function doSearch() {
  const query = searchInput.value.trim();
  hideSuggestions();
  selectedIndex = -1;
  await loadPeaks(query);
}

searchBtn.addEventListener('click', doSearch);

searchInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    if (selectedIndex >= 0 && currentSuggestions[selectedIndex]) {
      selectSuggestion(currentSuggestions[selectedIndex]);
    } else {
      doSearch();
    }
    return;
  }

  if (e.key === 'ArrowDown') {
    e.preventDefault();
    if (currentSuggestions.length === 0) return;
    selectedIndex = Math.min(selectedIndex + 1, currentSuggestions.length - 1);
    updateHighlight();
    return;
  }

  if (e.key === 'ArrowUp') {
    e.preventDefault();
    if (currentSuggestions.length === 0) return;
    selectedIndex = Math.max(selectedIndex - 1, -1);
    updateHighlight();
    return;
  }

  if (e.key === 'Escape') {
    hideSuggestions();
    selectedIndex = -1;
  }
});

// ======================
// دکمه پاک کردن
// ======================
function updateClearButton() {
  clearBtn.style.display = searchInput.value.trim() ? 'block' : 'none';
}

searchInput.addEventListener('input', () => {
  updateClearButton();
  handleAutocomplete();
});

clearBtn.addEventListener('click', () => {
  searchInput.value = '';
  updateClearButton();
  clearMap();
  hideSuggestions();
  selectedIndex = -1;
  searchInput.focus();
});

// ======================
// Autocomplete + استان‌ها
// ======================
let debounceTimer: number | null = null;

async function handleAutocomplete() {
  const query = searchInput.value.trim();

  if (debounceTimer) {
    clearTimeout(debounceTimer);
  }

  if (query.length < 2) {
    hideSuggestions();
    selectedIndex = -1;
    return;
  }

  debounceTimer = window.setTimeout(async () => {
    const [peaks, states] = await Promise.all([
      searchPeaks(query),
      searchStates(query)
    ]);

    currentSuggestions = [];

    // اول استان‌ها رو اضافه کن
    states.slice(0, 5).forEach((state) => {
      currentSuggestions.push({
        type: 'state',
        value: state,
        label: `استان: ${state}`
      });
    });

    // بعد قله‌ها
    peaks.slice(0, 8).forEach((peak: any) => {
      const name = peak.name || peak.ename || 'بدون نام';
      const height = peak.height ? ` — ${peak.height} متر` : '';
      const locations = peak.locations ? ` / ${peak.locations}` : '';
      currentSuggestions.push({
        type: 'peak',
        value: name,
        label: `<strong>${name}</strong><span style="color:#64748b">${height}</span><span style="color:#64748b">${locations}</span>`
      });
    });

    if (currentSuggestions.length === 0) {
      hideSuggestions();
      selectedIndex = -1;
      return;
    }

    renderSuggestions();
    selectedIndex = -1;
  }, 250);
}

function renderSuggestions() {
  suggestionsBox.innerHTML = '';

  currentSuggestions.forEach((item, index) => {
    const div = document.createElement('div');
    div.className = 'suggestion-item';
    if (item.type === 'state') {
      div.classList.add('suggestion-state');
    }
    div.innerHTML = item.label;
    div.dataset.index = String(index);

    div.addEventListener('click', () => {
      selectSuggestion(item);
    });

    suggestionsBox.appendChild(div);
  });

  suggestionsBox.style.display = 'block';
}

function updateHighlight() {
  const items = suggestionsBox.querySelectorAll('.suggestion-item');
  items.forEach((el, i) => {
    if (i === selectedIndex) {
      el.classList.add('selected');
      el.scrollIntoView({ block: 'nearest' });
    } else {
      el.classList.remove('selected');
    }
  });
}

async function selectSuggestion(item: { type: 'peak' | 'state'; value: string; label: string }) {
  searchInput.value = item.value;
  updateClearButton();
  hideSuggestions();
  selectedIndex = -1;

  if (item.type === 'state') {
    await loadPeaksByState(item.value);
  } else {
    await loadPeaks(item.value);
  }
}

function hideSuggestions() {
  suggestionsBox.style.display = 'none';
  suggestionsBox.innerHTML = '';
  currentSuggestions = [];
  selectedIndex = -1;
}

// بستن پیشنهادات با کلیک بیرون
document.addEventListener('click', (e) => {
  const target = e.target as Node;
  if (
      !searchInput.contains(target) &&
      !suggestionsBox.contains(target) &&
      !clearBtn.contains(target)
  ) {
    hideSuggestions();
  }
});

// سال جاری را به صورت داینامیک بگذار
const yearEl = document.getElementById('current-year');
if (yearEl) {
  yearEl.textContent = new Date().getFullYear().toString();
}