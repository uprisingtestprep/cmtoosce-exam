const ACCESS_CODE = "CMTOOSCE9000";
const READING_SECONDS = 2 * 60;
const TASK_SECONDS = 10 * 60;
const TRANSITION_SECONDS = 1 * 60;
const STATIONS_PER_CIRCUIT = 7;
const TOTAL_CIRCUITS = 9;

const COMPETENCY_LABELS = {
  professional_practice: "Professional Practice",
  client_history: "Client History",
  assessment: "Assessment",
  treatment: "Treatment",
  therapeutic_exercise: "Therapeutic Exercise",
};

const TYPE_LABELS = {
  interactive_sp: "Interactive Station (Standardized Client)",
};

let STATIONS = [];
let currentStation = null;
let timerInterval = null;
let timerRemaining = READING_SECONDS;
let timerPhase = "reading"; // "reading" | "task" | "transition" | "done"
let timerEverStarted = false;

// Circuit-practice mode state
let currentMode = null; // "browse" | "circuit"
let currentCircuitNum = null;
let currentCircuitStations = [];
let currentCircuitIndex = 0;

function $(id) { return document.getElementById(id); }

// Guard against silently losing station progress: the browser Back button
// and a tab close/refresh both bypass every in-app "are you sure" dialog
// (those only fire on our own buttons), so a candidate who reaches for the
// browser's own Back button mid-timer would otherwise lose progress with
// zero warning.
window.addEventListener("beforeunload", (e) => {
  if (currentStation && timerEverStarted && timerPhase !== "done") {
    e.preventDefault();
    e.returnValue = "";
  }
});

function showScreen(id) {
  ["gate-screen", "home-screen", "circuit-select-screen", "list-screen", "station-screen", "circuit-complete-screen"].forEach(s => {
    $(s).style.display = s === id ? "" : "none";
  });
}

// ---------- Access gate ----------
function checkAccessCode() {
  const val = $("access-code-input").value.trim().toUpperCase();
  if (val === ACCESS_CODE) {
    sessionStorage.setItem("cmtoosce_access", "1");
    loadStations();
  } else {
    $("gate-error").textContent = "Incorrect access code. Please check your book or listing for the code.";
  }
}

$("gate-submit").addEventListener("click", checkAccessCode);
$("access-code-input").addEventListener("keydown", e => {
  if (e.key === "Enter") checkAccessCode();
});

// ---------- Load ----------
async function loadStations() {
  try {
    const res = await fetch("stations.json");
    const data = await res.json();
    STATIONS = Array.isArray(data) ? data : [];
    buildContentAreaFilter();
    showScreen("home-screen");
  } catch (e) {
    STATIONS = [];
    showScreen("home-screen");
  }
}

// ---------- Home screen ----------
$("mode-browse").addEventListener("click", () => {
  currentMode = "browse";
  renderList();
  showScreen("list-screen");
});

$("mode-circuit").addEventListener("click", () => {
  renderCircuitSelect();
  showScreen("circuit-select-screen");
});

$("back-to-home-from-circuit").addEventListener("click", () => {
  showScreen("home-screen");
});

$("back-to-home-from-list").addEventListener("click", () => {
  showScreen("home-screen");
});

// ---------- Circuit select ----------
function renderCircuitSelect() {
  const container = $("circuit-select-list");
  container.innerHTML = "";
  if (!STATIONS.length) {
    container.innerHTML = `<p class="muted" style="padding:1.25rem;">No stations loaded yet.</p>`;
    return;
  }
  const circuitNums = [...new Set(STATIONS.map(s => s.circuit).filter(c => c !== undefined))];
  circuitNums.sort((a, b) => a - b);
  const list = circuitNums.length ? circuitNums : Array.from({ length: TOTAL_CIRCUITS }, (_, i) => i + 1);

  list.forEach(num => {
    const stationsInCircuit = STATIONS.filter(s => s.circuit === num);
    const card = document.createElement("div");
    card.className = "circuit-card";
    card.innerHTML = `
      <div class="num">Circuit ${num}</div>
      <div class="title">${stationsInCircuit.length || STATIONS_PER_CIRCUIT} stations</div>
      <button class="btn btn-primary btn-block">Start Circuit ${num}</button>`;
    card.addEventListener("click", () => startCircuit(num));
    container.appendChild(card);
  });
}

function startCircuit(num) {
  currentMode = "circuit";
  currentCircuitNum = num;
  currentCircuitStations = STATIONS
    .filter(s => s.circuit === num)
    .sort((a, b) => (a.slot || 0) - (b.slot || 0));
  currentCircuitIndex = 0;
  if (!currentCircuitStations.length) {
    alert("No stations found for this circuit yet.");
    showScreen("circuit-select-screen");
    return;
  }
  openStation(currentCircuitStations[0]);
}

function goToNextCircuitStation() {
  currentCircuitIndex++;
  if (currentCircuitIndex >= currentCircuitStations.length) {
    showCircuitComplete();
    return;
  }
  openStation(currentCircuitStations[currentCircuitIndex]);
}

function showCircuitComplete() {
  $("circuit-complete-text").textContent =
    `You have finished all ${currentCircuitStations.length} stations in Circuit ${currentCircuitNum}, ` +
    `matching the real CMTO OSCE's 7 real stations per sitting.`;
  showScreen("circuit-complete-screen");
}

$("circuit-complete-restart").addEventListener("click", () => {
  currentCircuitIndex = 0;
  openStation(currentCircuitStations[0]);
});
$("circuit-complete-choose").addEventListener("click", () => {
  renderCircuitSelect();
  showScreen("circuit-select-screen");
});
$("circuit-complete-home").addEventListener("click", () => {
  showScreen("home-screen");
});

// ---------- Browse list ----------
function buildContentAreaFilter() {
  const sel = $("filter-content-area");
  const areas = new Set();
  STATIONS.forEach(s => (s.content_areas || []).forEach(a => areas.add(a)));
  [...areas].forEach(k => {
    const opt = document.createElement("option");
    opt.value = k;
    opt.textContent = COMPETENCY_LABELS[k] || k;
    sel.appendChild(opt);
  });
}

function getCompletedSet() {
  try {
    return new Set(JSON.parse(localStorage.getItem("cmtoosce_completed") || "[]"));
  } catch (e) {
    return new Set();
  }
}

function markCompleted(id) {
  const set = getCompletedSet();
  set.add(id);
  localStorage.setItem("cmtoosce_completed", JSON.stringify([...set]));
}

function renderList() {
  const areaFilter = $("filter-content-area").value;
  const typeFilter = $("filter-type").value;
  const completed = getCompletedSet();

  const filtered = STATIONS.filter(s =>
    (!areaFilter || (s.content_areas || []).includes(areaFilter)) &&
    (!typeFilter || s.station_type === typeFilter)
  );

  $("station-count").textContent = `${filtered.length} station${filtered.length === 1 ? "" : "s"}`;

  const container = $("station-list");
  container.innerHTML = "";
  filtered.forEach(s => {
    const card = document.createElement("div");
    card.className = "station-card" + (completed.has(s.id) ? " done" : "");
    const circuitLine = (s.circuit && s.slot)
      ? `<div class="circuit-line">Circuit ${s.circuit}, Station ${s.slot} of ${STATIONS_PER_CIRCUIT}</div>`
      : "";
    const areaTags = (s.content_areas || [])
      .map(a => `<span class="tag">${escapeHtml(COMPETENCY_LABELS[a] || a)}</span>`)
      .join("");
    card.innerHTML = `
      <div class="num">Station ${s.id}${completed.has(s.id) ? ' <span class="done-check">&#10003; Practiced</span>' : ""}</div>
      ${circuitLine}
      <div class="title">${escapeHtml(s.title)}</div>
      <div class="tags">${areaTags}</div>`;
    card.addEventListener("click", () => {
      currentMode = "browse";
      openStation(s);
    });
    container.appendChild(card);
  });
}

$("filter-content-area").addEventListener("change", renderList);
$("filter-type").addEventListener("change", renderList);

$("back-to-list").addEventListener("click", () => {
  stopTimer();
  if (currentMode === "circuit") {
    renderCircuitSelect();
    showScreen("circuit-select-screen");
  } else {
    renderList();
    showScreen("list-screen");
  }
});

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str || "";
  return div.innerHTML;
}

// ---------- Station detail ----------
function openStation(s) {
  currentStation = s;
  $("station-title-header").textContent = `Station ${s.id}: ${s.title}`;
  $("station-type-badge").textContent = TYPE_LABELS[s.station_type] || s.station_type || TYPE_LABELS.interactive_sp;
  $("station-setting").textContent = s.setting;
  $("station-instructions").textContent = s.candidate_instructions;
  $("station-materials").textContent = s.materials_provided;
  const hasRefs = s.references_provided && s.references_provided.trim().length > 0;
  $("station-references-panel").style.display = hasRefs ? "" : "none";
  $("station-references").textContent = hasRefs ? s.references_provided : "";

  if (s.circuit && s.slot) {
    $("station-circuit-badge").style.display = "";
    $("station-circuit-badge").textContent = `Circuit ${s.circuit}, Station ${s.slot} of ${STATIONS_PER_CIRCUIT}`;
  } else {
    $("station-circuit-badge").style.display = "none";
  }

  const areas = s.content_areas || (s.competency ? [s.competency] : []);
  $("station-content-areas").innerHTML = areas
    .map(a => `<span class="tag">${escapeHtml(COMPETENCY_LABELS[a] || a)}</span>`)
    .join("");

  if (currentMode === "circuit") {
    $("circuit-progress-badge").style.display = "";
    $("circuit-progress-badge").textContent =
      `Circuit ${currentCircuitNum}: Station ${currentCircuitIndex + 1} of ${currentCircuitStations.length}`;
    $("back-to-list").textContent = "← Circuits";
  } else {
    $("circuit-progress-badge").style.display = "none";
    $("back-to-list").textContent = "← Back";
  }

  $("answer-section").style.display = "none";
  $("reveal-panel").style.display = "";
  $("reveal-btn").disabled = false;
  $("circuit-next-row").style.display = currentMode === "circuit" ? "" : "none";

  resetTimer();
  showScreen("station-screen");
  window.scrollTo(0, 0);
}

$("circuit-next-btn").addEventListener("click", () => {
  stopTimer();
  goToNextCircuitStation();
});

$("reveal-btn").addEventListener("click", () => {
  const s = currentStation;
  if (!s) return;

  if (!timerEverStarted || timerPhase !== "done") {
    const proceed = confirm(
      "You have not finished a full 2-minute reading period, 10-minute station, and 1-minute " +
      "transition timer yet. On the real exam you get no feedback until the station ends. " +
      "Reveal the answer now anyway?"
    );
    if (!proceed) return;
  }

  if (s.sp_role_script) {
    $("sp-script-block").style.display = "";
    $("sp-script-text").textContent = s.sp_role_script;
  } else {
    $("sp-script-block").style.display = "none";
  }

  if (s.task_details) {
    $("task-details-block").style.display = "";
    $("task-details-text").textContent = s.task_details;
  } else {
    $("task-details-block").style.display = "none";
  }

  const byCategory = {};
  (s.checklist || []).forEach((item, idx) => {
    byCategory[item.category] = byCategory[item.category] || [];
    byCategory[item.category].push({ ...item, idx });
  });

  const container = $("checklist-container");
  container.innerHTML = "";
  Object.keys(byCategory).forEach(cat => {
    const block = document.createElement("div");
    block.className = "checklist-category";
    const h3 = document.createElement("h3");
    h3.textContent = cat;
    block.appendChild(h3);
    byCategory[cat].forEach(item => {
      const row = document.createElement("div");
      row.className = "checklist-item";
      row.innerHTML = `<input type="checkbox" data-idx="${item.idx}"><label>${escapeHtml(item.item)}</label>`;
      block.appendChild(row);
    });
    container.appendChild(block);
  });

  container.querySelectorAll("input[type=checkbox]").forEach(cb => {
    cb.addEventListener("change", updateTally);
  });
  updateTally();

  $("model-answer-text").textContent = s.model_answer;
  $("answer-section").style.display = "";
  $("reveal-panel").style.display = "none";

  markCompleted(s.id);
});

function updateTally() {
  const boxes = document.querySelectorAll("#checklist-container input[type=checkbox]");
  const checked = [...boxes].filter(b => b.checked).length;
  $("score-tally").textContent = `Self-score: ${checked} of ${boxes.length} checklist items met`;
}

// ---------- Timer ----------
function formatTime(sec) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function resetTimer() {
  stopTimer();
  timerPhase = "reading";
  timerEverStarted = false;
  timerRemaining = READING_SECONDS;
  $("timer-display").textContent = formatTime(timerRemaining);
  $("timer-display").className = "";
  $("timer-label").textContent = "Reading Period";
  $("timer-start").textContent = "Start Reading Timer";
  $("timer-start").disabled = false;
}

function stopTimer() {
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
}

function tick() {
  timerRemaining--;
  if (timerRemaining <= 0) {
    if (timerPhase === "reading") {
      startTaskPhase();
    } else if (timerPhase === "task") {
      startTransitionPhase();
    } else {
      timerPhase = "done";
      stopTimer();
      $("timer-display").textContent = "0:00";
      $("timer-display").className = "done";
      $("timer-label").textContent = "Station Time Complete";
      $("timer-start").textContent = "Start Reading Timer";
      $("timer-start").disabled = false;
      if (currentMode === "circuit" && currentCircuitIndex < currentCircuitStations.length - 1) {
        setTimeout(() => {
          if (currentMode === "circuit" && timerPhase === "done") {
            goToNextCircuitStation();
          }
        }, 2000);
      }
      return;
    }
  }
  $("timer-display").textContent = formatTime(timerRemaining);
  if (timerPhase === "task" && timerRemaining <= 60) {
    $("timer-display").className = "warning";
  }
  if (timerPhase === "transition") {
    $("timer-display").className = "transition";
  }
}

function startTaskPhase() {
  timerPhase = "task";
  timerRemaining = TASK_SECONDS;
  $("timer-label").textContent = "Station Task";
  $("timer-display").className = "";
  $("timer-start").textContent = "Start Task Timer";
}

function startTransitionPhase() {
  timerPhase = "transition";
  timerRemaining = TRANSITION_SECONDS;
  $("timer-label").textContent = "Transition to Next Station";
  $("timer-display").className = "transition";
  $("timer-start").textContent = "Start Reading Timer";
}

$("timer-start").addEventListener("click", () => {
  if (timerInterval) return;
  timerEverStarted = true;
  $("timer-start").disabled = true;
  timerInterval = setInterval(tick, 1000);
});

$("timer-reset").addEventListener("click", resetTimer);

$("timer-skip").addEventListener("click", () => {
  timerEverStarted = true;
  stopTimer();
  startTaskPhase();
  $("timer-display").textContent = formatTime(timerRemaining);
  $("timer-start").disabled = false;
});

// ---------- Print partner script ----------
$("print-partner-btn").addEventListener("click", () => {
  const s = currentStation;
  if (!s) return;
  const checklistHtml = (s.checklist || [])
    .map(item => `<div>&#9633; [${escapeHtml(item.category)}] ${escapeHtml(item.item)}</div>`)
    .join("");
  $("print-area").innerHTML = `
    <h1>Station ${s.id}: ${escapeHtml(s.title)}</h1>
    <p><strong>Setting:</strong> ${escapeHtml(s.setting)}</p>
    <p><strong>Station Type:</strong> ${TYPE_LABELS[s.station_type] || s.station_type || TYPE_LABELS.interactive_sp}</p>
    <hr>
    ${s.sp_role_script ? `<h2>Standardized Client Script (for your study partner)</h2><p>${escapeHtml(s.sp_role_script)}</p>` : ""}
    ${s.task_details ? `<h2>Written Task Details</h2><p>${escapeHtml(s.task_details)}</p>` : ""}
    <h2>Scoring Checklist</h2>
    ${checklistHtml}
    <h2>Model Answer</h2>
    <p>${escapeHtml(s.model_answer)}</p>
  `;
  window.print();
});

// ---------- Init ----------
if (sessionStorage.getItem("cmtoosce_access") === "1") {
  loadStations();
}
