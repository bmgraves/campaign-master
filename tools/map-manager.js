/* ============================================================
   Campaign Master — Map Manager
   Data model, PIXI layers, paint engine, region border algorithm
   ============================================================ */

export const MODULE_ID = "campaign-master";

// ── Shared state ──────────────────────────────────────────────────────────────

export const MM = {
  terrainGfx:  null,   // PIXI.Graphics — terrain hex fills
  regionGfx:   null,   // PIXI.Graphics — region border outlines
  cursorGfx:   null,   // PIXI.Graphics — brush preview

  terrainVisible: true,
  regionVisible:  true,

  painting:    false,
  isDragging:  false,
  brushSize:   1,

  hardBorders:        false,  // skip region cells already in a different region
  hardTerrainBorders: false,  // skip terrain cells already in a different terrain type

  activeTerrainId: null,
  activeRegionId:  null,

  erasing:      false,
  eraseTerrain: true,
  eraseRegion:  true,

  _isPainting:     false,
  _pendingTerrain: null,   // accumulating in-flight terrain cells
  _pendingRegion:  null,   // accumulating in-flight region cells
  _sentTerrain:    null,   // last snapshot sent to server (baseline for rapid strokes)
  _sentRegion:     null,   // last snapshot sent to server (baseline for rapid strokes)
  _paintHandlers:  null,
};

// ── Flag helpers ──────────────────────────────────────────────────────────────

export function getSceneFlag(key, fallback = null) {
  return canvas.scene?.getFlag(MODULE_ID, key) ?? fallback;
}

export async function setSceneFlag(key, value, prevValue = undefined) {
  if (!canvas.scene) return;
  // For plain objects Foundry's mergeObject (used by scene.update) recurses,
  // so a flat-key update MERGES rather than replaces — deleted keys survive.
  // We build an explicit diff with -=key deletions to force correct removal.
  // prevValue is passed by callers who track their own "last sent" snapshot,
  // avoiding stale flag reads during rapid painting.  For non-painting saves
  // (type edits, etc.) prevValue is omitted and we fall back to the flag.
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    const existing = prevValue !== undefined
      ? prevValue
      : canvas.scene.getFlag(MODULE_ID, key);
    if (existing !== null && existing !== undefined
        && typeof existing === "object" && !Array.isArray(existing)) {
      const update = {};
      for (const [k, v] of Object.entries(value)) {
        if (existing[k] !== v) update[`flags.${MODULE_ID}.${key}.${k}`] = v;
      }
      for (const k of Object.keys(existing)) {
        if (!(k in value)) update[`flags.${MODULE_ID}.${key}.-=${k}`] = null;
      }
      if (!Object.keys(update).length) return;
      return canvas.scene.update(update);
    }
  }
  return canvas.scene.setFlag(MODULE_ID, key, value);
}

export function getTerrainTypes()  { return getSceneFlag("terrainTypes",   {}); }
export function getRegions()       { return getSceneFlag("regions",        {}); }
export function getTerrainCells()  { return getSceneFlag("terrainCells",   {}); }
export function getRegionCells()   { return getSceneFlag("regionCells",    {}); }
export function cellKey(i, j)      { return `${i},${j}`; }

// ── Migration: paintedCells → terrainCells ───────────────────────────────────

export async function migrateIfNeeded() {
  if (!canvas.scene) return;
  const old = canvas.scene.getFlag(MODULE_ID, "paintedCells");
  if (!old) return;
  const hasTerrain = canvas.scene.getFlag(MODULE_ID, "terrainCells");
  if (!hasTerrain) {
    await canvas.scene.setFlag(MODULE_ID, "terrainCells", old);
  }
  await canvas.scene.update({ [`flags.${MODULE_ID}.-=paintedCells`]: null });
  console.log("Campaign Master | Migrated paintedCells → terrainCells");
}

// ── BFS brush footprint ───────────────────────────────────────────────────────

export function getBrushOffsets(centerI, centerJ) {
  if (MM.brushSize <= 1) return [{ i: centerI, j: centerJ }];
  const visited = new Set();
  const result  = [];
  let frontier  = [{ i: centerI, j: centerJ }];
  visited.add(cellKey(centerI, centerJ));
  result.push({ i: centerI, j: centerJ });

  for (let ring = 1; ring < MM.brushSize; ring++) {
    const next = [];
    for (const cell of frontier) {
      for (const n of canvas.grid.getAdjacentOffsets(cell)) {
        const k = cellKey(n.i, n.j);
        if (!visited.has(k)) {
          visited.add(k);
          result.push({ i: n.i, j: n.j });
          next.push({ i: n.i, j: n.j });
        }
      }
    }
    frontier = next;
  }
  return result;
}

// ── PIXI layer init / teardown ────────────────────────────────────────────────

export function initMapGfx() {
  const layer = canvas.interface ?? canvas.stage;

  if (!MM.terrainGfx) {
    MM.terrainGfx = new PIXI.Graphics();
    layer.addChildAt(MM.terrainGfx, 0);
  }
  if (!MM.regionGfx) {
    MM.regionGfx = new PIXI.Graphics();
    layer.addChild(MM.regionGfx);
  }
  if (!MM.cursorGfx) {
    MM.cursorGfx = new PIXI.Graphics();
    layer.addChild(MM.cursorGfx);
  }
}

export function destroyMapGfx() {
  if (MM.terrainGfx)  { MM.terrainGfx.destroy();  MM.terrainGfx  = null; }
  if (MM.regionGfx)   { MM.regionGfx.destroy();   MM.regionGfx   = null; }
  if (MM.cursorGfx)   { MM.cursorGfx.destroy();   MM.cursorGfx   = null; }
}

// ── Terrain overlay ───────────────────────────────────────────────────────────
//
// cellsOverride → pending snapshot during drag (or null = use flags)

export function renderTerrainOverlay(cellsOverride = null) {
  if (!canvas.scene || !MM.terrainGfx) return;
  const cells     = cellsOverride ?? getTerrainCells();
  const types     = getTerrainTypes();
  const gridShape = canvas.grid.getShape();
  MM.terrainGfx.clear();

  for (const [key, typeId] of Object.entries(cells)) {
    const type = types[typeId];
    if (!type) continue;
    const [i, j] = key.split(",").map(Number);
    _drawFilledCell(MM.terrainGfx, i, j, parseInt(type.color.replace("#", ""), 16), gridShape, 0.4);
  }
}

function _drawFilledCell(gfx, i, j, color, shape, alpha = 0.4) {
  const center = canvas.grid.getCenterPoint({ i, j });
  gfx.beginFill(color, alpha);
  gfx.lineStyle(1, color, 0.7);
  if (shape?.length > 0) {
    gfx.moveTo(center.x + shape[0].x, center.y + shape[0].y);
    for (let k = 1; k < shape.length; k++) gfx.lineTo(center.x + shape[k].x, center.y + shape[k].y);
    gfx.closePath();
  } else {
    gfx.drawCircle(center.x, center.y, canvas.grid.size / 2);
  }
  gfx.endFill();
}

// ── Region border overlay ─────────────────────────────────────────────────────
//
//   BFS → connected components → inset boundary edges drawn inside each region.
//   Adjacent regions each draw their border slightly inside their own territory
//   so the lines don't overlap.
//
// cellsOverride → pending/optimistic snapshot, or null = use flags

export function renderRegionOverlay(cellsOverride = null) {
  if (!canvas.scene || !MM.regionGfx) return;
  const cells   = cellsOverride ?? getRegionCells();
  const regions = getRegions();
  MM.regionGfx.clear();

  const byRegion = {};
  for (const [key, regionId] of Object.entries(cells)) {
    if (!regions[regionId]) continue;
    if (!byRegion[regionId]) byRegion[regionId] = [];
    byRegion[regionId].push(key);
  }

  const gridShape = canvas.grid.getShape();

  for (const [regionId, keys] of Object.entries(byRegion)) {
    const region  = regions[regionId];
    const color   = parseInt(region.color.replace("#", ""), 16);
    const cellSet = new Set(keys);

    // BFS → connected components
    const visited    = new Set();
    const components = [];
    for (const startKey of keys) {
      if (visited.has(startKey)) continue;
      const component = [];
      const queue     = [startKey];
      visited.add(startKey);
      while (queue.length) {
        const k = queue.shift();
        component.push(k);
        const [ci, cj] = k.split(",").map(Number);
        for (const n of canvas.grid.getAdjacentOffsets({ i: ci, j: cj })) {
          const nk = cellKey(n.i, n.j);
          if (cellSet.has(nk) && !visited.has(nk)) {
            visited.add(nk);
            queue.push(nk);
          }
        }
      }
      components.push(component);
    }

    for (const component of components) {
      const compSet = new Set(component);
      const edges   = _getBoundaryEdges(compSet, gridShape);
      _drawInsetEdges(MM.regionGfx, edges, color);
    }
  }
}

function _getBoundaryEdges(compSet, shape) {
  const edges = [];
  const N = shape.length;

  for (const key of compSet) {
    const [i, j] = key.split(",").map(Number);
    const center    = canvas.grid.getCenterPoint({ i, j });
    const neighbors = canvas.grid.getAdjacentOffsets({ i, j });

    for (let k = 0; k < N; k++) {
      const v1  = { x: center.x + shape[k].x,       y: center.y + shape[k].y };
      const v2  = { x: center.x + shape[(k+1)%N].x, y: center.y + shape[(k+1)%N].y };
      const mid = { x: (v1.x + v2.x) / 2,           y: (v1.y + v2.y) / 2 };

      let closestKey = null, minDist = Infinity;
      for (const n of neighbors) {
        const nc = canvas.grid.getCenterPoint(n);
        const d  = Math.hypot(nc.x - mid.x, nc.y - mid.y);
        if (d < minDist) { minDist = d; closestKey = cellKey(n.i, n.j); }
      }

      if (!closestKey || !compSet.has(closestKey)) {
        const dx = center.x - mid.x, dy = center.y - mid.y;
        const len = Math.hypot(dx, dy) || 1;
        edges.push({ v1, v2, inward: { x: dx / len, y: dy / len } });
      }
    }
  }
  return edges;
}

const REGION_LINE_WIDTH = 3;

function _drawInsetEdges(gfx, edges, color) {
  const inset = REGION_LINE_WIDTH / 2;
  gfx.lineStyle(REGION_LINE_WIDTH, color, 0.9);
  for (const { v1, v2, inward } of edges) {
    gfx.moveTo(v1.x + inward.x * inset, v1.y + inward.y * inset);
    gfx.lineTo(v2.x + inward.x * inset, v2.y + inward.y * inset);
  }
}

// ── Cursor preview ────────────────────────────────────────────────────────────

export function renderCursorPreview(worldX, worldY) {
  if (!MM.cursorGfx) return;
  MM.cursorGfx.clear();

  const offset  = canvas.grid.getOffset({ x: worldX, y: worldY });
  const offsets = getBrushOffsets(offset.i, offset.j);
  const shape   = canvas.grid.getShape();

  const terrainType = !MM.erasing && MM.activeTerrainId
    ? getTerrainTypes()[MM.activeTerrainId] : null;
  const region = !MM.erasing && MM.activeRegionId
    ? getRegions()[MM.activeRegionId] : null;

  for (const { i, j } of offsets) {
    const center = canvas.grid.getCenterPoint({ i, j });

    if (MM.erasing && MM.eraseTerrain) {
      _drawCursorCell(MM.cursorGfx, center, shape, 0xe07070, 0xff4444, 0.2, 1);
    } else if (terrainType) {
      const c = parseInt(terrainType.color.replace("#", ""), 16);
      _drawCursorCell(MM.cursorGfx, center, shape, c, c, 0.35, 1);
    }

    if (MM.erasing && MM.eraseRegion) {
      _drawCursorCell(MM.cursorGfx, center, shape, 0x000000, 0xff4444, 0, 2);
    } else if (region) {
      const c = parseInt(region.color.replace("#", ""), 16);
      _drawCursorCell(MM.cursorGfx, center, shape, c, c, 0.1, 2);
    }
  }
}

function _drawCursorCell(gfx, center, shape, fillColor, lineColor, fillAlpha, lineWidth) {
  gfx.beginFill(fillColor, fillAlpha);
  gfx.lineStyle(lineWidth, lineColor, 0.9);
  if (shape?.length > 0) {
    gfx.moveTo(center.x + shape[0].x, center.y + shape[0].y);
    for (let k = 1; k < shape.length; k++) gfx.lineTo(center.x + shape[k].x, center.y + shape[k].y);
    gfx.closePath();
  } else {
    gfx.drawCircle(center.x, center.y, canvas.grid.size / 2);
  }
  gfx.endFill();
}

export function clearCursorPreview() {
  MM.cursorGfx?.clear();
}

// ── Paint engine ──────────────────────────────────────────────────────────────

let _paintDebounce = null;

export function startPainting() {
  if (MM.painting) return;
  MM.painting = true;

  const onDown = (event) => {
    if (event.data.button !== 0) return;
    const pos = event.data.getLocalPosition(canvas.stage);
    MM.isDragging = true;
    _initPendingCells();
    _applyBrush(pos);
  };

  const onMove = (event) => {
    const pos = event.data.getLocalPosition(canvas.stage);
    renderCursorPreview(pos.x, pos.y);
    if (!MM.isDragging) return;
    _applyBrush(pos);
  };

  const onUp = async () => {
    if (!MM.isDragging) return;
    MM.isDragging = false;
    await flushPaint();
    clearCursorPreview();
  };

  canvas.stage.on("mousedown", onDown);
  canvas.stage.on("mousemove", onMove);
  canvas.stage.on("mouseup",   onUp);
  MM._paintHandlers = { onDown, onMove, onUp };
}

export function stopPainting() {
  if (!MM.painting) return;
  MM.painting   = false;
  MM.isDragging = false;
  clearCursorPreview();

  const h = MM._paintHandlers;
  if (h) {
    canvas.stage.off("mousedown", h.onDown);
    canvas.stage.off("mousemove", h.onMove);
    canvas.stage.off("mouseup",   h.onUp);
    MM._paintHandlers = null;
  }

  if (MM._pendingTerrain !== null || MM._pendingRegion !== null) {
    clearTimeout(_paintDebounce);
    const terrain = MM._pendingTerrain;
    const region  = MM._pendingRegion;
    MM._pendingTerrain = null;
    MM._pendingRegion  = null;
    const prevTerrain = MM._sentTerrain;
    const prevRegion  = MM._sentRegion;
    // Keep _isPainting = true until the fire-and-forget saves resolve so the
    // updateScene hook doesn't re-render from stale flags mid-save.
    const saves = [];
    if (terrain !== null)
      saves.push(setSceneFlag("terrainCells", terrain, prevTerrain ?? getTerrainCells()));
    if (region !== null)
      saves.push(setSceneFlag("regionCells",  region,  prevRegion  ?? getRegionCells()));
    Promise.all(saves).finally(() => { MM._isPainting = false; });
  } else {
    MM._isPainting = false;
  }
  MM._sentTerrain = null;
  MM._sentRegion  = null;
}

function _initPendingCells() {
  // Use _sentTerrain/_sentRegion as the baseline when a save is still in-flight.
  // Falling back to scene flags would read stale data and cause the new stroke
  // to overwrite recently-painted cells with a partial set on flush.
  if (MM._pendingTerrain === null)
    MM._pendingTerrain = foundry.utils.deepClone(MM._sentTerrain ?? getTerrainCells());
  if (MM._pendingRegion === null)
    MM._pendingRegion  = foundry.utils.deepClone(MM._sentRegion  ?? getRegionCells());
}

function _applyBrush(pos) {
  const center  = canvas.grid.getOffset({ x: pos.x, y: pos.y });
  const offsets = getBrushOffsets(center.i, center.j);
  _initPendingCells();

  let changed = false;

  for (const { i, j } of offsets) {
    const key = cellKey(i, j);

    if (MM.erasing) {
      if (MM.eraseTerrain && key in MM._pendingTerrain) { delete MM._pendingTerrain[key]; changed = true; }
      if (MM.eraseRegion  && key in MM._pendingRegion)  { delete MM._pendingRegion[key];  changed = true; }
    } else {
      if (MM.activeTerrainId) {
        const blocked = MM.hardTerrainBorders
          && MM._pendingTerrain[key] !== undefined
          && MM._pendingTerrain[key] !== MM.activeTerrainId;
        if (!blocked && MM._pendingTerrain[key] !== MM.activeTerrainId) {
          MM._pendingTerrain[key] = MM.activeTerrainId;
          changed = true;
        }
      }
      if (MM.activeRegionId) {
        const blocked = MM.hardBorders
          && MM._pendingRegion[key] !== undefined
          && MM._pendingRegion[key] !== MM.activeRegionId;
        if (!blocked && MM._pendingRegion[key] !== MM.activeRegionId) {
          MM._pendingRegion[key] = MM.activeRegionId;
          changed = true;
        }
      }
    }
  }

  if (!changed) return;

  MM._isPainting = true;
  renderTerrainOverlay(MM._pendingTerrain);
  renderRegionOverlay(MM._pendingRegion);

  clearTimeout(_paintDebounce);
  _paintDebounce = setTimeout(flushPaint, 200);
}

export async function flushPaint() {
  clearTimeout(_paintDebounce);
  if (MM._pendingTerrain === null && MM._pendingRegion === null) {
    MM._isPainting = false;
    return;
  }

  const terrain = MM._pendingTerrain;
  const region  = MM._pendingRegion;
  MM._pendingTerrain = null;
  MM._pendingRegion  = null;

  // Capture previous sent state as the diff baseline BEFORE updating _sent.
  // This gives setSceneFlag an accurate "what the server currently has" so its
  // -=key deletions are computed correctly, without reading stale flag data.
  const prevTerrain = MM._sentTerrain;
  const prevRegion  = MM._sentRegion;
  if (terrain !== null) MM._sentTerrain = terrain;
  if (region  !== null) MM._sentRegion  = region;

  if (terrain !== null) renderTerrainOverlay(terrain);
  if (region  !== null) renderRegionOverlay(region);

  await Promise.all([
    terrain !== null
      ? setSceneFlag("terrainCells", terrain, prevTerrain ?? getTerrainCells())
      : Promise.resolve(),
    region !== null
      ? setSceneFlag("regionCells",  region,  prevRegion  ?? getRegionCells())
      : Promise.resolve(),
  ]);
  MM._isPainting = false;
}

// ── Full re-render ────────────────────────────────────────────────────────────

export function renderAllOverlays() {
  renderTerrainOverlay();
  renderRegionOverlay();
}

// ── Public API helpers ────────────────────────────────────────────────────────

export function getTerrainAtOffset(i, j) {
  const typeId = getTerrainCells()[cellKey(i, j)];
  return typeId ? (getTerrainTypes()[typeId] ?? null) : null;
}

export function getTerrainAtPoint(x, y) {
  const offset = canvas.grid.getOffset({ x, y });
  const typeId = getTerrainCells()[cellKey(offset.i, offset.j)];
  return typeId ? (getTerrainTypes()[typeId] ?? null) : null;
}

export function getRegionAtOffset(i, j) {
  const regionId = getRegionCells()[cellKey(i, j)];
  return regionId ? (getRegions()[regionId] ?? null) : null;
}

export function getRegionAtPoint(x, y) {
  const offset   = canvas.grid.getOffset({ x, y });
  const regionId = getRegionCells()[cellKey(offset.i, offset.j)];
  return regionId ? (getRegions()[regionId] ?? null) : null;
}
