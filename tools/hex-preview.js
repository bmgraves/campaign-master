/* ============================================================
   Campaign Master — Hex Preview Tool
   Shows a floating info panel over hovered hexes with:
     - Hex name (if set)
     - Terrain type + Region
     - Tags (with source labels)
     - Active primary encounter table (with inherited-from label)
   ============================================================ */

import {
  getResolvedConfig,
  getTerrainAtOffset,
  getRegionAtOffset,
} from "./map-manager.js";

const CM_HP = {
  active:       false,
  panelEl:      null,
  moveHandler:  null,
  leaveHandler: null,
};

function _ensurePanel() {
  if (!CM_HP.panelEl || !document.body.contains(CM_HP.panelEl)) {
    CM_HP.panelEl = document.createElement("div");
    CM_HP.panelEl.id = "cm-hex-preview";
    document.body.appendChild(CM_HP.panelEl);
  }
  return CM_HP.panelEl;
}

function _hidePanel() {
  if (CM_HP.panelEl) CM_HP.panelEl.style.display = "none";
}

function _updatePanel(worldX, worldY, screenX, screenY) {
  const offset   = canvas.grid.getOffset({ x: worldX, y: worldY });
  const { i, j } = offset;
  const resolved = getResolvedConfig(i, j);
  const terrain  = getTerrainAtOffset(i, j);
  const region   = getRegionAtOffset(i, j);

  const hasName    = !!resolved.hexName;
  const hasTerrain = !!terrain;
  const hasRegion  = !!region;
  const hasTags    = (resolved.tags?.length ?? 0) > 0;
  const hasPrimary = !!resolved.primary;

  if (!hasName && !hasTerrain && !hasRegion && !hasTags && !hasPrimary) {
    _hidePanel();
    return;
  }

  let html = "";

  // ── Hex name ──
  if (hasName) {
    html += `<div class="cm-hp-name">${resolved.hexName}</div>`;
  }

  // ── Terrain / Region ──
  if (hasTerrain || hasRegion) {
    html += `<div class="cm-hp-section">`;
    if (hasTerrain) {
      html += `<div class="cm-hp-row">
        <span class="cm-hp-swatch" style="background:${terrain.color}"></span>
        <span class="cm-hp-lbl">Terrain</span>
        <span class="cm-hp-val">${terrain.name}</span>
      </div>`;
    }
    if (hasRegion) {
      html += `<div class="cm-hp-row">
        <span class="cm-hp-swatch" style="background:${region.color}"></span>
        <span class="cm-hp-lbl">Region</span>
        <span class="cm-hp-val">${region.name}</span>
      </div>`;
    }
    html += `</div>`;
  }

  // ── Tags ──
  if (hasTags) {
    const chips = resolved.tagsWithSource
      .map(ts => `<span class="cm-hp-tag" title="from ${ts.from}">${ts.tag}</span>`)
      .join("");
    html += `<div class="cm-hp-section cm-hp-tags">${chips}</div>`;
  }

  // ── Primary encounter ──
  if (hasPrimary) {
    const enc       = resolved.primary;
    const tableDoc  = enc.uuid ? fromUuidSync(enc.uuid) : null;
    const tableName = tableDoc?.name ?? enc.uuid ?? "—";
    html += `<div class="cm-hp-section">
      <div class="cm-hp-enc-label">Encounter</div>
      <div class="cm-hp-enc-name">${tableName}</div>
      <div class="cm-hp-enc-from">via ${enc.inheritedFrom}</div>
    </div>`;
  }

  const panel = _ensurePanel();
  panel.innerHTML = html;
  panel.style.display = "block";

  // Position near cursor, flipping away from screen edges
  const PAD = 18;
  requestAnimationFrame(() => {
    const pw = panel.offsetWidth;
    const ph = panel.offsetHeight;
    let px   = screenX + PAD;
    let py   = screenY + PAD;
    if (px + pw > window.innerWidth  - 8) px = screenX - pw - PAD;
    if (py + ph > window.innerHeight - 8) py = screenY - ph - PAD;
    panel.style.left = `${px}px`;
    panel.style.top  = `${py}px`;
  });
}

export function startHexPreview() {
  if (CM_HP.active) return;
  CM_HP.active = true;

  const moveHandler = (event) => {
    const pos = event.data.getLocalPosition(canvas.stage);
    _updatePanel(pos.x, pos.y, event.clientX ?? 0, event.clientY ?? 0);
  };
  const leaveHandler = () => _hidePanel();

  canvas.stage.on("mousemove", moveHandler);
  canvas.app?.view?.addEventListener("mouseleave", leaveHandler);

  CM_HP.moveHandler  = moveHandler;
  CM_HP.leaveHandler = leaveHandler;
}

export function stopHexPreview() {
  if (!CM_HP.active) return;
  CM_HP.active = false;

  if (CM_HP.moveHandler)  canvas.stage.off("mousemove", CM_HP.moveHandler);
  if (CM_HP.leaveHandler) canvas.app?.view?.removeEventListener("mouseleave", CM_HP.leaveHandler);

  _hidePanel();
  CM_HP.moveHandler  = null;
  CM_HP.leaveHandler = null;
}
