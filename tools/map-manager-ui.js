/* ============================================================
   Campaign Master — Map Manager UI
   Floating panel: terrain types, regions, brush, paint/erase modes
   ============================================================ */

import {
  MM,
  MODULE_ID,
  getTerrainTypes, getRegions,
  getTerrainCells, getRegionCells,
  setSceneFlag,
  cellKey,
  startPainting, stopPainting,
  renderTerrainOverlay, renderRegionOverlay,
  flushPaint,
} from "./map-manager.js";

// ── Open / close ──────────────────────────────────────────────────────────────

export function toggleMapManagerUI() {
  const existing = document.getElementById("cm-map-manager");
  if (existing) { existing.remove(); stopPainting(); return; }
  buildMapManagerUI();
}

// ── Build panel ───────────────────────────────────────────────────────────────

function buildMapManagerUI() {
  document.getElementById("cm-map-manager")?.remove();

  const panel = document.createElement("div");
  panel.id = "cm-map-manager";
  panel.innerHTML = _panelHTML();
  document.body.appendChild(panel);
  panel.style.left = "100px";
  panel.style.top  = "80px";

  _makeDraggable(panel, panel.querySelector(".cm-panel-header"));
  _bindEvents(panel);
  _refreshAll(panel);
}

// ── HTML template ─────────────────────────────────────────────────────────────

function _panelHTML() {
  return `
  <div class="cm-panel-header">
    <span><i class="fa-solid fa-map"></i> Map Manager</span>
    <div class="cm-header-actions">
      <button id="cm-toggle-terrain-vis" title="Toggle terrain fills"
        class="${MM.terrainVisible ? "active" : ""}">
        <i class="fa-solid fa-mountain"></i>
      </button>
      <button id="cm-toggle-region-vis" title="Toggle region borders"
        class="${MM.regionVisible ? "active" : ""}">
        <i class="fa-solid fa-border-all"></i>
      </button>
      <button id="cm-close-mm" title="Close"><i class="fa-solid fa-xmark"></i></button>
    </div>
  </div>

  <div class="cm-section-label">Terrain Types</div>
  <div id="cm-terrain-type-list" class="cm-type-list"></div>
  <div class="cm-add-row">
    <input id="cm-new-terrain-name" type="text" placeholder="New terrain..." maxlength="32">
    <input id="cm-new-terrain-color" type="color" value="#44aa44">
    <button id="cm-add-terrain" title="Add terrain type"><i class="fa-solid fa-plus"></i></button>
  </div>

  <div class="cm-section-label">Regions</div>
  <div id="cm-region-list" class="cm-type-list"></div>
  <div class="cm-add-row">
    <input id="cm-new-region-name" type="text" placeholder="New region..." maxlength="32">
    <input id="cm-new-region-color" type="color" value="#4488cc">
    <button id="cm-add-region" title="Add region"><i class="fa-solid fa-plus"></i></button>
  </div>

  <div class="cm-section-label">Brush Size</div>
  <div class="cm-brush-row">
    <button id="cm-brush-dec" class="cm-brush-btn">−</button>
    <div class="cm-brush-display">
      <span id="cm-brush-size">${MM.brushSize}</span>
      <span class="cm-brush-label">cell${MM.brushSize !== 1 ? "s" : ""}</span>
    </div>
    <button id="cm-brush-inc" class="cm-brush-btn">+</button>
  </div>

  <div class="cm-section-label">Mode</div>
  <div class="cm-paint-controls">
    <button id="cm-paint-btn" class="cm-mode-btn">
      <i class="fa-solid fa-paintbrush"></i> Paint
    </button>
    <button id="cm-erase-btn" class="cm-mode-btn">
      <i class="fa-solid fa-eraser"></i> Erase
    </button>
  </div>

  <div id="cm-erase-options" class="cm-erase-options" style="display:none">
    <label class="cm-checkbox-row">
      <input type="checkbox" id="cm-erase-terrain" ${MM.eraseTerrain ? "checked" : ""}>
      <span>Terrain</span>
    </label>
    <label class="cm-checkbox-row">
      <input type="checkbox" id="cm-erase-region" ${MM.eraseRegion ? "checked" : ""}>
      <span>Region</span>
    </label>
  </div>

  <div class="cm-clear-row">
    <button id="cm-clear-all" class="cm-clear-btn">
      <i class="fa-solid fa-trash"></i> Clear All…
    </button>
  </div>

  <div id="cm-active-label" class="cm-active-label">Select a terrain type or region to begin</div>
  `;
}

// ── Event binding ─────────────────────────────────────────────────────────────

function _bindEvents(panel) {
  // Close
  panel.querySelector("#cm-close-mm").addEventListener("click", () => {
    panel.remove(); stopPainting();
  });

  // Visibility toggles
  panel.querySelector("#cm-toggle-terrain-vis").addEventListener("click", (e) => {
    MM.terrainVisible = !MM.terrainVisible;
    game.settings.set(MODULE_ID, "terrainVisible", MM.terrainVisible);
    if (MM.terrainGfx) MM.terrainGfx.visible = MM.terrainVisible;
    e.currentTarget.classList.toggle("active", MM.terrainVisible);
  });
  panel.querySelector("#cm-toggle-region-vis").addEventListener("click", (e) => {
    MM.regionVisible = !MM.regionVisible;
    game.settings.set(MODULE_ID, "regionVisible", MM.regionVisible);
    if (MM.regionGfx) MM.regionGfx.visible = MM.regionVisible;
    e.currentTarget.classList.toggle("active", MM.regionVisible);
  });

  // Add terrain type
  panel.querySelector("#cm-add-terrain").addEventListener("click", async () => {
    const nameEl  = panel.querySelector("#cm-new-terrain-name");
    const colorEl = panel.querySelector("#cm-new-terrain-color");
    const name = nameEl.value.trim();
    if (!name) { nameEl.focus(); return; }
    const id    = foundry.utils.randomID(8);
    const types = foundry.utils.deepClone(getTerrainTypes());
    types[id]   = { id, name, color: colorEl.value, data: {} };
    await setSceneFlag("terrainTypes", types);
    nameEl.value = "";
    _refreshTerrainList(panel);
  });

  // Add region
  panel.querySelector("#cm-add-region").addEventListener("click", async () => {
    const nameEl  = panel.querySelector("#cm-new-region-name");
    const colorEl = panel.querySelector("#cm-new-region-color");
    const name = nameEl.value.trim();
    if (!name) { nameEl.focus(); return; }
    const id      = foundry.utils.randomID(8);
    const regions = foundry.utils.deepClone(getRegions());
    regions[id]   = { id, name, color: colorEl.value, data: {} };
    await setSceneFlag("regions", regions);
    nameEl.value = "";
    _refreshRegionList(panel);
  });

  // Brush size
  panel.querySelector("#cm-brush-dec").addEventListener("click", () => {
    if (MM.brushSize <= 1) return;
    MM.brushSize--;
    _updateBrushDisplay(panel);
  });
  panel.querySelector("#cm-brush-inc").addEventListener("click", () => {
    if (MM.brushSize >= 5) return;
    MM.brushSize++;
    _updateBrushDisplay(panel);
  });

  // Paint / Erase mode buttons
  panel.querySelector("#cm-paint-btn").addEventListener("click", () => {
    if (MM.painting && !MM.erasing) { stopPainting(); }
    else { MM.erasing = false; startPainting(); _ensureVisible(panel); }
    _refreshModeButtons(panel);
    _refreshActiveLabel(panel);
  });
  panel.querySelector("#cm-erase-btn").addEventListener("click", () => {
    if (MM.erasing) { stopPainting(); MM.erasing = false; }
    else { MM.erasing = true; startPainting(); _ensureVisible(panel); }
    _refreshModeButtons(panel);
    _refreshActiveLabel(panel);
  });

  // Erase checkboxes
  panel.querySelector("#cm-erase-terrain").addEventListener("change", (e) => {
    MM.eraseTerrain = e.target.checked;
  });
  panel.querySelector("#cm-erase-region").addEventListener("change", (e) => {
    MM.eraseRegion = e.target.checked;
  });

  // Terrain type list — click to select, trash to delete
  panel.querySelector("#cm-terrain-type-list").addEventListener("click", (e) => {
    const row = e.target.closest(".cm-type-row");
    if (!row) return;
    if (e.target.closest(".cm-delete-type")) {
      _deleteTerrainType(row.dataset.id, panel); return;
    }
    // Toggle selection
    MM.activeTerrainId = MM.activeTerrainId === row.dataset.id ? null : row.dataset.id;
    MM.erasing = false;
    startPainting();
    _ensureVisible(panel);
    _refreshModeButtons(panel);
    _refreshTerrainList(panel);
    _refreshActiveLabel(panel);
  });

  // Region list — click to select, trash to delete
  panel.querySelector("#cm-region-list").addEventListener("click", (e) => {
    const row = e.target.closest(".cm-type-row");
    if (!row) return;
    if (e.target.closest(".cm-delete-type")) {
      _deleteRegion(row.dataset.id, panel); return;
    }
    MM.activeRegionId = MM.activeRegionId === row.dataset.id ? null : row.dataset.id;
    MM.erasing = false;
    startPainting();
    _ensureVisible(panel);
    _refreshModeButtons(panel);
    _refreshRegionList(panel);
    _refreshActiveLabel(panel);
  });

  // Clear All
  panel.querySelector("#cm-clear-all").addEventListener("click", async () => {
    const confirmed = await Dialog.confirm({
      title: "Clear All Map Data",
      content: `<p>Clear all painted data from this scene?</p>
        <p><label><input type="checkbox" id="dlg-clear-terrain" checked> Terrain fills</label><br>
        <label><input type="checkbox" id="dlg-clear-region" checked> Region borders</label></p>`,
      yes: (html) => ({
        terrain: html.find("#dlg-clear-terrain")[0].checked,
        region:  html.find("#dlg-clear-region")[0].checked,
      }),
      no: () => null,
    });
    if (!confirmed) return;
    clearTimeout(null);
    MM._pendingTerrain = null;
    MM._pendingRegion  = null;
    MM._isPainting     = false;
    if (confirmed.terrain) { await setSceneFlag("terrainCells", {}); renderTerrainOverlay({}); }
    if (confirmed.region)  { await setSceneFlag("regionCells",  {}); renderRegionOverlay({}); }
  });
}

// ── Refresh helpers ───────────────────────────────────────────────────────────

function _refreshAll(panel) {
  _refreshTerrainList(panel);
  _refreshRegionList(panel);
  _updateBrushDisplay(panel);
  _refreshModeButtons(panel);
  _refreshActiveLabel(panel);
}

function _refreshTerrainList(panel) {
  const types = getTerrainTypes();
  panel.querySelector("#cm-terrain-type-list").innerHTML =
    Object.values(types).map(t => _typeRowHTML(t, MM.activeTerrainId)).join("") ||
    '<div class="cm-empty">No terrain types yet.</div>';
}

function _refreshRegionList(panel) {
  const regions = getRegions();
  panel.querySelector("#cm-region-list").innerHTML =
    Object.values(regions).map(r => _typeRowHTML(r, MM.activeRegionId)).join("") ||
    '<div class="cm-empty">No regions yet.</div>';
}

function _typeRowHTML(item, activeId) {
  const sel = item.id === activeId ? " selected" : "";
  return `
    <div class="cm-type-row${sel}" data-id="${item.id}">
      <span class="cm-type-swatch" style="background:${item.color}"></span>
      <span class="cm-type-name">${item.name}</span>
      <button class="cm-delete-type" title="Delete"><i class="fa-solid fa-trash"></i></button>
    </div>`;
}

function _updateBrushDisplay(panel) {
  const s = MM.brushSize;
  panel.querySelector("#cm-brush-size").textContent  = s;
  panel.querySelector(".cm-brush-label").textContent = `cell${s !== 1 ? "s" : ""}`;
  panel.querySelector("#cm-brush-dec").disabled = s <= 1;
  panel.querySelector("#cm-brush-inc").disabled = s >= 5;
}

function _refreshModeButtons(panel) {
  panel.querySelector("#cm-paint-btn").classList.toggle("active", MM.painting && !MM.erasing);
  panel.querySelector("#cm-erase-btn").classList.toggle("active", MM.erasing);
  const eraseOpts = panel.querySelector("#cm-erase-options");
  eraseOpts.style.display = MM.erasing ? "flex" : "none";
}

function _refreshActiveLabel(panel) {
  const types   = getTerrainTypes();
  const regions = getRegions();
  const label   = panel.querySelector("#cm-active-label");
  const t  = MM.activeTerrainId && types[MM.activeTerrainId];
  const r  = MM.activeRegionId  && regions[MM.activeRegionId];

  if (MM.erasing) {
    const what = [MM.eraseTerrain && "terrain", MM.eraseRegion && "region"].filter(Boolean).join(" + ") || "nothing";
    label.innerHTML = `Mode: <b style="color:#e07070">Erasing ${what}</b>`;
  } else if (t || r) {
    const parts = [];
    if (t) parts.push(`<b style="color:${t.color}">${t.name}</b>`);
    if (r) parts.push(`<span style="color:${r.color};border-bottom:2px solid ${r.color}">${r.name}</span>`);
    label.innerHTML = `Painting: ${parts.join(" &nbsp;|&nbsp; ")}`;
  } else {
    label.innerHTML = `Select a terrain type or region to begin`;
  }
}

function _ensureVisible(panel) {
  let changed = false;
  if (!MM.terrainVisible) {
    MM.terrainVisible = true;
    game.settings.set(MODULE_ID, "terrainVisible", true);
    if (MM.terrainGfx) MM.terrainGfx.visible = true;
    panel?.querySelector("#cm-toggle-terrain-vis")?.classList.add("active");
    changed = true;
  }
  if (!MM.regionVisible) {
    MM.regionVisible = true;
    game.settings.set(MODULE_ID, "regionVisible", true);
    if (MM.regionGfx) MM.regionGfx.visible = true;
    panel?.querySelector("#cm-toggle-region-vis")?.classList.add("active");
    changed = true;
  }
  return changed;
}

// ── Delete handlers ───────────────────────────────────────────────────────────

async function _deleteTerrainType(id, panel) {
  const types = foundry.utils.deepClone(getTerrainTypes());
  delete types[id];
  await setSceneFlag("terrainTypes", types);

  // Remove cells painted with this type
  const cells = foundry.utils.deepClone(getTerrainCells());
  for (const [key, typeId] of Object.entries(cells)) {
    if (typeId === id) delete cells[key];
  }
  await setSceneFlag("terrainCells", cells);

  if (MM.activeTerrainId === id) MM.activeTerrainId = null;
  _refreshTerrainList(panel);
  _refreshActiveLabel(panel);
  renderTerrainOverlay();
}

async function _deleteRegion(id, panel) {
  const regions = foundry.utils.deepClone(getRegions());
  delete regions[id];
  await setSceneFlag("regions", regions);

  // Remove cells assigned to this region
  const cells = foundry.utils.deepClone(getRegionCells());
  for (const [key, regionId] of Object.entries(cells)) {
    if (regionId === id) delete cells[key];
  }
  await setSceneFlag("regionCells", cells);

  if (MM.activeRegionId === id) MM.activeRegionId = null;
  _refreshRegionList(panel);
  _refreshActiveLabel(panel);
  renderRegionOverlay();
}

// ── Drag to move panel ────────────────────────────────────────────────────────

function _makeDraggable(panel, handle) {
  let startX, startY, startLeft, startTop;
  handle.addEventListener("mousedown", (e) => {
    if (e.target.closest("button")) return;
    e.preventDefault();
    startX    = e.clientX; startY    = e.clientY;
    startLeft = parseInt(panel.style.left) || 100;
    startTop  = parseInt(panel.style.top)  || 80;
    const onMove = (e) => {
      panel.style.left = `${startLeft + e.clientX - startX}px`;
      panel.style.top  = `${startTop  + e.clientY - startY}px`;
    };
    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup",   onUp);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup",   onUp);
  });
}

// ── External refresh (called from updateScene hook) ───────────────────────────

export function refreshPanelLists() {
  const panel = document.getElementById("cm-map-manager");
  if (!panel) return;
  _refreshTerrainList(panel);
  _refreshRegionList(panel);
  _refreshActiveLabel(panel);
}
