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
  const parents = [{ label: "Map", config: mapCfg }];
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
//   data: { tags, encounter } — the current config for this level
//   parentChain: [{label, config}] — parent configs in order (Map first)
//   currentLabel: "Terrain"|"Region"|"Hex"|null — null = Map level (no override concept)
//
// Encounter inheritance chain:
//   Map (data-presence) → Terrain/Region/Hex (require override:true)
//   Chain display: [Map] → [nodes with override] → [current if override checked]
//   Active node (inherited source) = last node before current (or current if override=true)

function _showConfigDialog(title, name, color, data = {}, parentChain = [], currentLabel = null) {
  const tags       = data.tags ?? [];
  const thisEnc    = data.encounter ?? {};
  const hasName    = name !== null && name !== undefined;
  const isMapLevel = !currentLabel;
  const isHexLevel = !hasName && !!currentLabel;

  // Override is "on" if this level explicitly overrides, or it's the map level
  const isOverrideInit = isMapLevel ? true : (thisEnc.override === true);

  // Compute inherited encounter: most-specific parent with data
  // Map = data-presence; sub-levels = override===true + data
  let inheritedEnc = null;
  for (const p of parentChain) {
    const pEnc = p.config?.encounter;
    if (!pEnc) continue;
    const isMap   = p.label === "Map";
    const hasData = isMap
      ? !!(pEnc.uuid || pEnc.die || pEnc.threshold)
      : pEnc.override === true && !!(pEnc.uuid || pEnc.die || pEnc.threshold);
    if (hasData) inheritedEnc = pEnc;
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

  const overrideRow = !isMapLevel ? `
    <div class="cm-config-override">
      <input type="checkbox" id="dlg-enc-override" ${isOverrideInit ? "checked" : ""}>
      <label for="dlg-enc-override">Override encounter</label>
    </div>` : "";

  // Encounter fields — values and disabled state set dynamically in render callback
  const encFields = `
    <div id="dlg-enc-fields">
      <div class="cm-config-row"><label>Table/Macro UUID</label>
        <input id="dlg-enc-uuid" type="text" placeholder="Drag to link or paste UUID" value="">
      </div>
      <div class="cm-config-row"><label>Frequency</label>
        <select id="dlg-enc-freq">
          <option value="daily">Daily</option>
          <option value="entering">Entering Hex</option>
          <option value="leaving">Leaving Hex</option>
        </select>
      </div>
      <div class="cm-config-row"><label>Encounter Die</label>
        <input id="dlg-enc-die" type="text" placeholder="1d6" value="">
      </div>
      <div class="cm-config-row"><label>Encounter Threshold</label>
        <input id="dlg-enc-threshold" type="text" placeholder="1,2 or 1-3" value="">
      </div>
    </div>`;

  const content = `<div class="cm-config-dialog">
    ${nameRow}
    ${hexNameRow}
    ${tagsSection}
    <div class="cm-config-section-title">Encounter Manager</div>
    <div class="cm-encounter-section">
      <div id="dlg-chain-display" class="cm-chain-display"></div>
      ${overrideRow}
      ${encFields}
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
            const el             = html[0] ?? html;
            const tList          = [...el.querySelectorAll("#dlg-tag-list .cm-tag-chip")].map(c => c.dataset.tag).filter(Boolean);
            const overrideChecked = isMapLevel ? true : (el.querySelector("#dlg-enc-override")?.checked ?? false);
            let encounter;
            if (isMapLevel || overrideChecked) {
              encounter = {
                ...(!isMapLevel && { override: true }),
                uuid:      el.querySelector("#dlg-enc-uuid")?.value.trim()       ?? "",
                frequency: el.querySelector("#dlg-enc-freq")?.value              ?? "daily",
                die:       el.querySelector("#dlg-enc-die")?.value.trim()        ?? "",
                threshold: el.querySelector("#dlg-enc-threshold")?.value.trim()  ?? "",
              };
            } else {
              encounter = {};
            }
            const result = { data: { tags: tList, encounter } };
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

        // Build chain node list for display
        // Nodes: Map (always) + intermediate parents with override=true + current if overrideChecked
        // State: "current" if it's the level being edited; "active" if last & not current; "past" otherwise
        function buildChainNodes(isOverrideChecked) {
          if (isMapLevel) return [];
          const nodes = [{ label: "Map" }];
          for (let pi = 1; pi < parentChain.length; pi++) {
            const p    = parentChain[pi];
            const pEnc = p.config?.encounter;
            if (pEnc?.override === true && !!(pEnc.uuid || pEnc.die || pEnc.threshold)) {
              nodes.push({ label: p.label });
            }
          }
          if (isOverrideChecked) nodes.push({ label: currentLabel });
          return nodes.map((n, idx) => {
            const isLast    = idx === nodes.length - 1;
            const isCurrent = n.label === currentLabel;
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

        function setEncFields(isOverrideChecked) {
          const enc      = isOverrideChecked ? thisEnc : (inheritedEnc ?? {});
          const disabled = !isOverrideChecked && !isMapLevel;
          const uuidEl   = el.querySelector("#dlg-enc-uuid");
          const freqEl   = el.querySelector("#dlg-enc-freq");
          const dieEl    = el.querySelector("#dlg-enc-die");
          const thrEl    = el.querySelector("#dlg-enc-threshold");
          if (uuidEl) { uuidEl.value    = enc.uuid      ?? "";       uuidEl.disabled = disabled; }
          if (dieEl)  { dieEl.value     = enc.die       ?? "";       dieEl.disabled  = disabled; }
          if (thrEl)  { thrEl.value     = enc.threshold ?? "";       thrEl.disabled  = disabled; }
          if (freqEl) { freqEl.value    = enc.frequency ?? "daily";  freqEl.disabled = disabled; }
        }

        renderChain(isOverrideInit);
        setEncFields(isOverrideInit);

        overrideCb?.addEventListener("change", (e) => {
          renderChain(e.target.checked);
          setEncFields(e.target.checked);
        });

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
  const hasEnc    = d?.encounter?.override === true && !!(d.encounter?.uuid || d.encounter?.die || d.encounter?.threshold);
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
