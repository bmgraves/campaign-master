/* ============================================================
   Campaign Master — Map Manager UI
   Floating panel: terrain types, regions, brush, paint/erase modes
   ============================================================ */

import {
  MM,
  MODULE_ID,
  getTerrainTypes, getRegions,
  getTerrainCells, getRegionCells,
  getHexConfigs, getMapConfig,
  setSceneFlag,
  cellKey,
  startPainting, stopPainting,
  renderTerrainOverlay, renderRegionOverlay, renderHexConfigOverlay,
  flushPaint,
  destroyHoverTooltip,
} from "./map-manager.js";

// ── Open / close ──────────────────────────────────────────────────────────────

export function toggleMapManagerUI() {
  const existing = document.getElementById("cm-map-manager");
  if (existing) { existing.remove(); stopPainting(); destroyHoverTooltip(); return; }
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
  // Start canvas mode immediately so events are intercepted even before
  // a brush is selected, preventing the previous canvas tool from firing.
  startPainting();
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

  <div class="cm-map-config-row">
    <button id="cm-map-config" class="cm-map-config-btn">
      <i class="fa-solid fa-gear"></i> Map Config
    </button>
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
    <button id="cm-configure-btn" class="cm-mode-btn">
      <i class="fa-solid fa-gear"></i> Single
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
    <label class="cm-checkbox-row">
      <input type="checkbox" id="cm-erase-hexconfig" ${MM.eraseHexConfig ? "checked" : ""}>
      <span>Hex Config</span>
    </label>
  </div>

  <div class="cm-hard-borders-row">
    <span class="cm-hint">Hard borders:</span>
    <label class="cm-checkbox-row">
      <input type="checkbox" id="cm-hard-terrain" ${MM.hardTerrainBorders ? "checked" : ""}>
      <span>Terrain</span>
    </label>
    <label class="cm-checkbox-row">
      <input type="checkbox" id="cm-hard-borders" ${MM.hardBorders ? "checked" : ""}>
      <span>Regions</span>
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
    panel.remove(); stopPainting(); destroyHoverTooltip();
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

  // Map Config
  panel.querySelector("#cm-map-config").addEventListener("click", async () => {
    const result = await _showConfigDialog("Map Config", null, null, getMapConfig() ?? {}, []);
    if (result !== null) await setSceneFlag("mapConfig", result.data);
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
  // Canvas handlers stay active while the panel is open; these only toggle state.
  panel.querySelector("#cm-paint-btn").addEventListener("click", () => {
    MM.erasing       = false;
    MM.configureMode = false;
    _refreshModeButtons(panel);
    _refreshActiveLabel(panel);
  });
  panel.querySelector("#cm-erase-btn").addEventListener("click", () => {
    MM.erasing       = !MM.erasing;
    MM.configureMode = false;
    if (MM.erasing) _ensureVisible(panel);
    _refreshModeButtons(panel);
    _refreshActiveLabel(panel);
  });
  panel.querySelector("#cm-configure-btn").addEventListener("click", () => {
    MM.configureMode = !MM.configureMode;
    MM.erasing       = false;
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
  panel.querySelector("#cm-erase-hexconfig").addEventListener("change", (e) => {
    MM.eraseHexConfig = e.target.checked;
  });

  // Hard borders
  panel.querySelector("#cm-hard-terrain").addEventListener("change", (e) => {
    MM.hardTerrainBorders = e.target.checked;
  });
  panel.querySelector("#cm-hard-borders").addEventListener("change", (e) => {
    MM.hardBorders = e.target.checked;
  });

  // Terrain type list — click to select, edit, or trash
  panel.querySelector("#cm-terrain-type-list").addEventListener("click", (e) => {
    const row = e.target.closest(".cm-type-row");
    if (!row) return;
    if (e.target.closest(".cm-delete-type")) {
      _deleteTerrainType(row.dataset.id, panel); return;
    }
    if (e.target.closest(".cm-edit-type")) {
      _editTerrainType(row.dataset.id, panel); return;
    }
    MM.activeTerrainId = MM.activeTerrainId === row.dataset.id ? null : row.dataset.id;
    MM.erasing = false;
    if (MM.activeTerrainId) _ensureVisible(panel);
    _refreshModeButtons(panel);
    _refreshTerrainList(panel);
    _refreshActiveLabel(panel);
  });

  // Region list — click to select, edit, or trash
  panel.querySelector("#cm-region-list").addEventListener("click", (e) => {
    const row = e.target.closest(".cm-type-row");
    if (!row) return;
    if (e.target.closest(".cm-delete-type")) {
      _deleteRegion(row.dataset.id, panel); return;
    }
    if (e.target.closest(".cm-edit-type")) {
      _editRegion(row.dataset.id, panel); return;
    }
    MM.activeRegionId = MM.activeRegionId === row.dataset.id ? null : row.dataset.id;
    MM.erasing = false;
    if (MM.activeRegionId) _ensureVisible(panel);
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
        <label><input type="checkbox" id="dlg-clear-region" checked> Region borders</label><br>
        <label><input type="checkbox" id="dlg-clear-hexconfig" checked> Hex Configs</label></p>`,
      yes: (html) => ({
        terrain:   html.find("#dlg-clear-terrain")[0].checked,
        region:    html.find("#dlg-clear-region")[0].checked,
        hexConfig: html.find("#dlg-clear-hexconfig")[0].checked,
      }),
      no: () => null,
    });
    if (!confirmed) return;
    MM._pendingTerrain   = null;
    MM._pendingRegion    = null;
    MM._pendingHexConfig = null;
    if (confirmed.terrain)   MM._sentTerrain   = {};
    if (confirmed.region)    MM._sentRegion    = {};
    if (confirmed.hexConfig) MM._sentHexConfig = {};
    MM._isPainting = false;
    const clears = [];
    if (confirmed.terrain)   { clears.push(setSceneFlag("terrainCells", {})); renderTerrainOverlay({}); }
    if (confirmed.region)    { clears.push(setSceneFlag("regionCells",  {})); renderRegionOverlay({});  }
    if (confirmed.hexConfig) { clears.push(setSceneFlag("hexConfigs",   {})); renderHexConfigOverlay({}); }
    await Promise.all(clears);
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
      <button class="cm-edit-type"   title="Edit"><i class="fa-solid fa-pen"></i></button>
      <button class="cm-delete-type" title="Delete"><i class="fa-solid fa-trash"></i></button>
    </div>`;
}

function _updateBrushDisplay(panel) {
  const s = MM.brushSize;
  panel.querySelector("#cm-brush-size").textContent  = s;
  panel.querySelector(".cm-brush-row .cm-brush-label").textContent = `cell${s !== 1 ? "s" : ""}`;
  panel.querySelector("#cm-brush-dec").disabled = s <= 1;
  panel.querySelector("#cm-brush-inc").disabled = s >= 5;
}

function _refreshModeButtons(panel) {
  const inPaintMode = !MM.erasing && !MM.configureMode && (!!MM.activeTerrainId || !!MM.activeRegionId);
  panel.querySelector("#cm-paint-btn").classList.toggle("active", inPaintMode);
  panel.querySelector("#cm-erase-btn").classList.toggle("active", MM.erasing);
  panel.querySelector("#cm-configure-btn").classList.toggle("active", MM.configureMode);
  panel.querySelector("#cm-erase-options").style.display = MM.erasing ? "flex" : "none";
}

function _refreshActiveLabel(panel) {
  const types   = getTerrainTypes();
  const regions = getRegions();
  const label   = panel.querySelector("#cm-active-label");
  const t  = MM.activeTerrainId && types[MM.activeTerrainId];
  const r  = MM.activeRegionId  && regions[MM.activeRegionId];

  if (MM.configureMode) {
    label.innerHTML = `Mode: <b style="color:#aaddff">Configure Hex</b> — click a cell`;
  } else if (MM.erasing) {
    const what = [MM.eraseTerrain && "terrain", MM.eraseRegion && "region", MM.eraseHexConfig && "config"].filter(Boolean).join(" + ") || "nothing";
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
  if (!MM.terrainVisible) {
    MM.terrainVisible = true;
    game.settings.set(MODULE_ID, "terrainVisible", true);
    if (MM.terrainGfx) MM.terrainGfx.visible = true;
    panel?.querySelector("#cm-toggle-terrain-vis")?.classList.add("active");
  }
  if (!MM.regionVisible) {
    MM.regionVisible = true;
    game.settings.set(MODULE_ID, "regionVisible", true);
    if (MM.regionGfx) MM.regionGfx.visible = true;
    panel?.querySelector("#cm-toggle-region-vis")?.classList.add("active");
  }
}

// ── Edit handlers ─────────────────────────────────────────────────────────────

function _showEditDialog(title, currentName, currentColor) {
  return new Promise((resolve) => {
    new Dialog({
      title,
      content: `<div style="display:grid;grid-template-columns:auto 1fr;gap:8px 12px;align-items:center;padding:4px 0 8px">
        <label>Name</label>
        <input id="dlg-edit-name" type="text" value="${currentName.replace(/"/g, "&quot;")}" style="width:100%">
        <label>Color</label>
        <input id="dlg-edit-color" type="color" value="${currentColor}">
      </div>`,
      buttons: {
        save: {
          icon:     '<i class="fa-solid fa-check"></i>',
          label:    "Save",
          callback: (html) => resolve({
            name:  html.find("#dlg-edit-name")[0].value.trim(),
            color: html.find("#dlg-edit-color")[0].value,
          }),
        },
        cancel: {
          icon:     '<i class="fa-solid fa-times"></i>',
          label:    "Cancel",
          callback: () => resolve(null),
        },
      },
      default: "save",
      close:   () => resolve(null),
    }).render(true);
  });
}

async function _editTerrainType(id, panel) {
  const type = getTerrainTypes()[id];
  if (!type) return;
  const mapCfg  = getMapConfig() ?? {};
  const parents = [{ label: "Map", config: mapCfg }];
  const result  = await _showConfigDialog(`Edit Terrain: ${type.name}`, type.name, type.color, type.data ?? {}, parents, "Terrain");
  if (!result) return;
  const updated = foundry.utils.deepClone(getTerrainTypes());
  updated[id] = { ...updated[id], name: result.name, color: result.color, data: result.data };
  await setSceneFlag("terrainTypes", updated);
  _refreshTerrainList(panel);
  _refreshActiveLabel(panel);
  renderTerrainOverlay();
}

async function _editRegion(id, panel) {
  const region  = getRegions()[id];
  if (!region) return;
  const mapCfg  = getMapConfig() ?? {};
  const parents = [
    { label: "Map",     config: mapCfg },
    { label: "Terrain", config: null,   phantom: true },
  ];
  const result  = await _showConfigDialog(`Edit Region: ${region.name}`, region.name, region.color, region.data ?? {}, parents, "Region");
  if (!result) return;
  const updated = foundry.utils.deepClone(getRegions());
  updated[id] = { ...updated[id], name: result.name, color: result.color, data: result.data };
  await setSceneFlag("regions", updated);
  _refreshRegionList(panel);
  _refreshActiveLabel(panel);
  renderRegionOverlay();
}

// ── Config dialog ─────────────────────────────────────────────────────────────
// _showConfigDialog(title, name, color, data, parentChain, currentLabel)
//   name/color: string — shown for terrain/region edits; pass null for hex/map-only dialogs
//   data: { tags, encounters[] } — the current config for this level
//   parentChain: [{label, config}] — parent configs in order (Map first)
//   currentLabel: "Terrain"|"Region"|"Hex"|null — null = Map level (no override concept)
//
// Encounter inheritance:
//   Primary: override chain (Map always active; sub-levels require override:true)
//   Sub-Table: keyword matching, additive from all levels
//   Secondary: independent, additive from all levels

// Read row data out of a .cm-enc-row element
function _readRowData(row) {
  const type = row.querySelector(".cm-enc-type")?.value ?? "secondary";
  const uuid = row.querySelector(".cm-enc-uuid")?.value.trim() ?? "";
  if (type === "subtable") {
    return { type, uuid, keyword: row.querySelector(".cm-enc-keyword")?.value.trim() ?? "" };
  }
  const frequency = row.querySelector(".cm-enc-trigger")?.value ?? "daily";
  return {
    type,
    uuid,
    frequency,
    die:       row.querySelector(".cm-enc-die")?.value.trim()           ?? "",
    threshold: row.querySelector(".cm-enc-threshold")?.value.trim()     ?? "",
    checkHour: parseInt(row.querySelector(".cm-enc-checkhour")?.value)  || 6,
  };
}

function _showConfigDialog(title, name, color, data = {}, parentChain = [], currentLabel = null) {
  const tags       = data.tags ?? [];
  const hasName    = name !== null && name !== undefined;
  const isMapLevel = !currentLabel;
  const isHexLevel = !hasName && !!currentLabel;

  // Migration: old encounter:{} → encounters:[{type:"primary",...}]
  function _localGetEncounters(cfg) {
    if (!cfg) return [];
    if (Array.isArray(cfg.encounters)) return cfg.encounters;
    const e = cfg.encounter;
    if (e && (e.uuid || e.die || e.threshold)) return [{ type: "primary", ...e }];
    return [];
  }

  const thisEncounters = _localGetEncounters(data);

  // Does this level already have a primary with override (or map level)?
  const isOverrideInit = isMapLevel
    ? true
    : thisEncounters.some(e => e.type === "primary" && e.override === true && !!(e.uuid || e.die));

  // Inherited primary: most-specific parent with an active primary
  let inheritedPrimary = null;
  if (!isMapLevel) {
    for (const p of parentChain) {
      if (!p.config || p.phantom) continue;
      const isMap = p.label === "Map";
      for (const enc of _localGetEncounters(p.config)) {
        if (enc.type !== "primary") continue;
        const active = isMap
          ? !!(enc.uuid || enc.die)
          : enc.override === true && !!(enc.uuid || enc.die);
        if (active) inheritedPrimary = { ...enc, inheritedFrom: p.label };
      }
    }
  }

  const inheritedTags = parentChain.flatMap(p =>
    (p.config?.tags ?? []).map(t =>
      `<span class="cm-tag-chip cm-tag-inherited" title="from ${p.label}">${_esc(t)} <em>(${p.label})</em></span>`
    )
  ).join("");

  const nameRow = hasName ? `
    <div class="cm-config-row"><label>Name</label>
      <input id="dlg-cfg-name" type="text" value="${_esc(name)}">
    </div>
    <div class="cm-config-row"><label>Color</label>
      <input id="dlg-cfg-color" type="color" value="${color ?? "#44aa44"}">
    </div>` : "";

  const hexNameRow = isHexLevel ? `
    <div class="cm-config-row"><label>Hex Name</label>
      <input id="dlg-hex-name" type="text" placeholder="Optional label…" value="${_esc(data.name ?? "")}">
    </div>` : "";

  const tagsSection = `
    <div class="cm-config-section-title">Tags</div>
    ${inheritedTags ? `<div class="cm-tag-list cm-inherited-tags">${inheritedTags}</div>` : ""}
    <div class="cm-tag-list" id="dlg-tag-list">
      ${tags.map(t => `<span class="cm-tag-chip" data-tag="${_esc(t)}">${_esc(t)}<button class="cm-tag-remove" data-tag="${_esc(t)}">×</button></span>`).join("")}
    </div>
    <div class="cm-tag-row">
      <input id="dlg-tag-input" type="text" placeholder="Add tag…">
      <button id="dlg-tag-add" type="button">+</button>
    </div>`;

  const hoursPerDayRow = isMapLevel ? `
    <div class="cm-config-row"><label>Hours per Day</label>
      <input id="dlg-hours-per-day" type="number" min="1" max="48" step="1"
        value="${data.hoursPerDay ?? 24}">
    </div>` : "";

  const chainDisplay = !isMapLevel ? `
    <div id="dlg-chain-display" class="cm-chain-display"></div>
    ${parentChain.some(p => p.phantom) ? '<div class="cm-chain-note">Terrain inheritance uncertain in configuration</div>' : ""}
  ` : "";

  const inheritedPrimaryHtml = !isMapLevel
    ? `<div id="dlg-inherited-primary" class="cm-inherited-primary"></div>` : "";

  const overrideRow = !isMapLevel ? `
    <div class="cm-config-override">
      <input type="checkbox" id="dlg-enc-override" ${isOverrideInit ? "checked" : ""}>
      <label for="dlg-enc-override">Override primary encounter</label>
    </div>` : "";

  const content = `<div class="cm-config-dialog">
    ${nameRow}
    ${hexNameRow}
    ${tagsSection}
    <div class="cm-config-section-title">Encounter Tables</div>
    <div class="cm-encounter-section">
      ${hoursPerDayRow}
      ${chainDisplay}
      ${inheritedPrimaryHtml}
      ${overrideRow}
      <div id="dlg-enc-list" class="cm-enc-list"></div>
      <button id="dlg-enc-add" type="button" class="cm-enc-add-btn">
        <i class="fa-solid fa-plus"></i> Add Encounter Entry
      </button>
    </div>
  </div>`;

  return new Promise((resolve) => {
    const dlg = new Dialog({
      title,
      content,
      buttons: {
        save: {
          icon:  '<i class="fa-solid fa-check"></i>',
          label: "Save",
          callback: (html) => {
            const el = html[0] ?? html;
            const tList = [...el.querySelectorAll("#dlg-tag-list .cm-tag-chip")]
              .map(c => c.dataset.tag).filter(Boolean);
            const overrideChecked = isMapLevel
              ? true : (el.querySelector("#dlg-enc-override")?.checked ?? false);
            const encounters = [...el.querySelectorAll("#dlg-enc-list .cm-enc-row")]
              .map(row => _readRowData(row))
              .filter(enc => {
                // Drop primary rows if override is off at non-map levels
                if (!isMapLevel && !overrideChecked && enc.type === "primary") return false;
                if (enc.type === "subtable") return !!(enc.uuid && enc.keyword);
                return !!(enc.uuid || enc.die);
              })
              .map(enc => {
                if (!isMapLevel && enc.type === "primary") return { ...enc, override: true };
                return enc;
              });
            const result = { data: { tags: tList, encounters } };
            if (isMapLevel) {
              result.data.hoursPerDay = parseInt(el.querySelector("#dlg-hours-per-day")?.value) || 24;
            }
            if (hasName) {
              result.name  = el.querySelector("#dlg-cfg-name")?.value.trim() || name;
              result.color = el.querySelector("#dlg-cfg-color")?.value ?? color;
            }
            if (isHexLevel) {
              result.data.name = el.querySelector("#dlg-hex-name")?.value.trim() ?? "";
            }
            resolve(result);
          },
        },
        cancel: {
          icon:     '<i class="fa-solid fa-times"></i>',
          label:    "Cancel",
          callback: () => resolve(null),
        },
      },
      default: "save",
      close:   () => resolve(null),
      render:  (html) => {
        const el = html[0] ?? html;
        el.closest?.(".app.dialog")?.classList.add("cm-config-dialog-app");

        const chainEl    = el.querySelector("#dlg-chain-display");
        const overrideCb = el.querySelector("#dlg-enc-override");
        const listEl     = el.querySelector("#dlg-enc-list");
        const addBtn     = el.querySelector("#dlg-enc-add");
        const ipEl       = el.querySelector("#dlg-inherited-primary");

        // ── Chain display ────────────────────────────────────────────────────
        function buildChainNodes(isOverrideChecked) {
          if (isMapLevel) return [];
          const nodes = [{ label: "Map", phantom: false }];
          for (let pi = 1; pi < parentChain.length; pi++) {
            const p = parentChain[pi];
            if (p.phantom) { nodes.push({ label: p.label, phantom: true }); continue; }
            const isMap = p.label === "Map";
            const hasPrimary = _localGetEncounters(p.config).some(enc => {
              if (enc.type !== "primary") return false;
              return isMap ? !!(enc.uuid || enc.die) : enc.override === true && !!(enc.uuid || enc.die);
            });
            if (hasPrimary) nodes.push({ label: p.label, phantom: false });
          }
          if (isOverrideChecked) nodes.push({ label: currentLabel, phantom: false });
          const realNodes = nodes.filter(n => !n.phantom);
          const lastReal  = realNodes[realNodes.length - 1];
          return nodes.map(n => {
            if (n.phantom) return { label: n.label + "?", state: "phantom" };
            const isCurrent = n.label === currentLabel;
            const isLast    = n.label === lastReal?.label;
            return { label: n.label, state: isCurrent ? "current" : (isLast ? "active" : "past") };
          });
        }

        function renderChain(isOverrideChecked) {
          if (!chainEl || isMapLevel) return;
          const nodes = buildChainNodes(isOverrideChecked);
          chainEl.innerHTML = nodes.map((n, idx) =>
            `${idx > 0 ? '<span class="cm-chain-arrow">→</span>' : ''}<span class="cm-chain-node cm-chain-${n.state}">${n.label}</span>`
          ).join("");
        }

        // ── Inherited primary display ────────────────────────────────────────
        function renderInheritedPrimary() {
          if (!ipEl) return;
          if (inheritedPrimary) {
            const freq = inheritedPrimary.frequency ?? "daily";
            const det  = [inheritedPrimary.die, inheritedPrimary.threshold].filter(Boolean).join(" / ");
            ipEl.innerHTML = `<div class="cm-enc-inherited-row">
              <span class="cm-enc-inherited-label">Primary from <b>${_esc(inheritedPrimary.inheritedFrom)}</b></span>
              <span class="cm-enc-inherited-detail">${det ? `${_esc(det)} · ` : ""}${freq}</span>
            </div>`;
          } else {
            ipEl.innerHTML = `<div class="cm-enc-inherited-row cm-enc-no-inherit">No inherited primary</div>`;
          }
        }

        // ── Encounter row factory ────────────────────────────────────────────
        function makeRow(enc) {
          const type = enc.type ?? "secondary";
          const row  = document.createElement("div");
          row.className = "cm-enc-row";

          const typeOpts = `
            <option value="primary"   ${type === "primary"   ? "selected" : ""}>Primary</option>
            <option value="subtable"  ${type === "subtable"  ? "selected" : ""}>Sub-Table</option>
            <option value="secondary" ${type === "secondary" ? "selected" : ""}>Secondary</option>`;

          if (type === "subtable") {
            row.innerHTML = `
              <select class="cm-enc-type">${typeOpts}</select>
              <input  class="cm-enc-uuid"    type="text" value="${_esc(enc.uuid    ?? "")}" placeholder="Table/Macro UUID">
              <input  class="cm-enc-keyword" type="text" value="${_esc(enc.keyword ?? "")}" placeholder="Keyword">
              <button class="cm-enc-delete"  type="button" title="Remove">×</button>`;
          } else {
            const freq = enc.frequency ?? "daily";
            row.innerHTML = `
              <select class="cm-enc-type">${typeOpts}</select>
              <input  class="cm-enc-uuid"      type="text"   value="${_esc(enc.uuid      ?? "")}" placeholder="Table/Macro UUID">
              <select class="cm-enc-trigger">
                <option value="daily"    ${freq === "daily"    ? "selected" : ""}>Daily</option>
                <option value="entering" ${freq === "entering" ? "selected" : ""}>Enter Hex</option>
                <option value="leaving"  ${freq === "leaving"  ? "selected" : ""}>Leave Hex</option>
              </select>
              <input  class="cm-enc-die"       type="text"   value="${_esc(enc.die       ?? "")}" placeholder="1d6">
              <input  class="cm-enc-threshold" type="text"   value="${_esc(enc.threshold ?? "")}" placeholder="1,2">
              <input  class="cm-enc-checkhour" type="number" value="${enc.checkHour ?? 6}" min="0" max="47" title="Check hour (daily only)">
              <button class="cm-enc-delete"    type="button" title="Remove">×</button>`;

            const trigEl  = row.querySelector(".cm-enc-trigger");
            const hourEl  = row.querySelector(".cm-enc-checkhour");
            hourEl.style.display = freq === "daily" ? "" : "none";
            trigEl.addEventListener("change", () => {
              hourEl.style.display = trigEl.value === "daily" ? "" : "none";
            });
          }

          // Type change: rebuild the row preserving values
          const typeEl = row.querySelector(".cm-enc-type");
          typeEl.addEventListener("change", () => {
            const cur  = _readRowData(row);
            cur.type   = typeEl.value;
            const newR = makeRow(cur);
            row.replaceWith(newR);
          });

          row.querySelector(".cm-enc-delete").addEventListener("click", () => row.remove());
          return row;
        }

        // ── Populate initial list ────────────────────────────────────────────
        function populateList(isOverrideChecked) {
          if (!listEl) return;
          listEl.innerHTML = "";
          for (const enc of thisEncounters) {
            // Hide primary rows when override is off at non-map levels
            if (enc.type === "primary" && !isMapLevel && !isOverrideChecked) continue;
            listEl.appendChild(makeRow(enc));
          }
        }

        renderChain(isOverrideInit);
        renderInheritedPrimary();
        populateList(isOverrideInit);

        overrideCb?.addEventListener("change", (e) => {
          renderChain(e.target.checked);
          if (!e.target.checked) {
            // Remove primary rows when override is turned off
            listEl?.querySelectorAll(".cm-enc-row").forEach(row => {
              if (row.querySelector(".cm-enc-type")?.value === "primary") row.remove();
            });
          }
        });

        addBtn?.addEventListener("click", () => {
          const row = makeRow({ type: "secondary", frequency: "entering", die: "1d6", threshold: "", checkHour: 6 });
          listEl?.appendChild(row);
          row.querySelector(".cm-enc-uuid")?.focus();
        });

        // ── Tag events ───────────────────────────────────────────────────────
        el.querySelector("#dlg-tag-add")?.addEventListener("click", () => {
          const inp = el.querySelector("#dlg-tag-input");
          const tag = inp?.value.trim();
          if (!tag) return;
          const list = el.querySelector("#dlg-tag-list");
          const chip = document.createElement("span");
          chip.className   = "cm-tag-chip";
          chip.dataset.tag = tag;
          chip.innerHTML   = `${_esc(tag)}<button class="cm-tag-remove" data-tag="${_esc(tag)}">×</button>`;
          chip.querySelector(".cm-tag-remove").addEventListener("click", () => chip.remove());
          list.appendChild(chip);
          inp.value = "";
        });
        el.querySelectorAll(".cm-tag-remove").forEach(btn =>
          btn.addEventListener("click", () => btn.closest(".cm-tag-chip").remove())
        );
      },
    });
    dlg.render(true);
  });
}

function _esc(str) {
  return String(str ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}

function _getParentConfigs(i, j) {
  const key     = cellKey(i, j);
  const parents = [{ label: "Map", config: getMapConfig() ?? {} }];
  const terrainId = getTerrainCells()?.[key];
  if (terrainId) {
    const t = getTerrainTypes()[terrainId];
    if (t) parents.push({ label: "Terrain", config: t.data ?? {} });
  }
  const regionId = getRegionCells()?.[key];
  if (regionId) {
    const r = getRegions()[regionId];
    if (r) parents.push({ label: "Region", config: r.data ?? {} });
  }
  return parents;
}

// ── Hex Config hook ───────────────────────────────────────────────────────────

Hooks.on("cm:openHexConfig", async (i, j) => {
  const key     = cellKey(i, j);
  const cfg     = getHexConfigs()[key] ?? {};
  const parents = _getParentConfigs(i, j);
  const result  = await _showConfigDialog(`Hex Config [${i}, ${j}]`, null, null, cfg, parents, "Hex");
  if (result === null) return;
  const all = foundry.utils.deepClone(getHexConfigs());
  const d         = result.data;
  const hasEnc    = d?.encounters?.length > 0;
  const isEmpty   = !d || ((!d.tags || !d.tags.length) && !d.name && !hasEnc);
  if (isEmpty) delete all[key]; else all[key] = d;
  MM._sentHexConfig = foundry.utils.deepClone(all);
  await setSceneFlag("hexConfigs", all);
  renderHexConfigOverlay();
});

// ── Delete handlers ───────────────────────────────────────────────────────────

async function _deleteTerrainType(id, panel) {
  const types = foundry.utils.deepClone(getTerrainTypes());
  delete types[id];
  await setSceneFlag("terrainTypes", types);

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
