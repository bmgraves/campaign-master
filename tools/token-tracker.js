/* ============================================================
   Campaign Master — Token Movement Tracker tool
   ============================================================ */

const CM_TT = { tracker: null };

export function startTracker({ getTerrainAtPoint, getRegionAtPoint, getResolvedConfig }) {
  if (CM_TT.tracker) return;
  const pending = {};

  const flushMove = (tokenId) => {
    const data = pending[tokenId];
    if (!data) return;
    clearTimeout(data.flushTimer);
    delete pending[tokenId];
    const { name, segments } = data;
    if (!segments.length) return;

    const fromFirst = segments[0].from;
    const toLast    = segments[segments.length - 1].to;
    const waypoints = [{ x: fromFirst.x, y: fromFirst.y }, ...segments.map(s => ({ x: s.to.x, y: s.to.y }))];

    let totalSpaces = segments.length;
    try {
      const result = canvas.grid.measurePath(waypoints);
      totalSpaces = result.spaces ?? Math.round(result.distance / canvas.grid.distance);
    } catch(e) {}

    const toOffset    = canvas.grid.getOffset({ x: toLast.x, y: toLast.y });
    const destTerrain = getTerrainAtPoint(toLast.x, toLast.y);
    const destRegion  = getRegionAtPoint(toLast.x, toLast.y);
    const resolved    = getResolvedConfig(toOffset.i, toOffset.j);

    // Hex name from hex config, or coordinates fallback
    const hexCfgName  = resolved?.hexName ?? null;
    const hexLabel    = hexCfgName
      ? `<b>${hexCfgName}</b> <span style="color:#555;font-size:11px;">[${toOffset.i},${toOffset.j}]</span>`
      : `<code>[${toOffset.i},${toOffset.j}]</code>`;

    const regionLine  = destRegion
      ? `<div><span style="color:#777;">Region:</span> <b style="color:${destRegion.color}">${destRegion.name}</b></div>`
      : "";
    const terrainLine = destTerrain
      ? `<div><span style="color:#777;">Terrain:</span> <b style="color:${destTerrain.color}">${destTerrain.name}</b></div>`
      : "";

    const tags = resolved?.tags ?? [];
    const tagsLine = tags.length
      ? `<div><span style="color:#777;">Tags:</span> ${tags.map(t => `<span style="background:#1a2a3a;border:1px solid #3a5a7a;border-radius:10px;padding:1px 7px;font-size:11px;color:#7ab0dd;">${t}</span>`).join(" ")}</div>`
      : "";

    ChatMessage.create({
      content: `<div style="border:1px solid #4a7c4e;border-radius:6px;padding:8px 12px;
                  background:#f4f9f4;font-family:sans-serif;font-size:13px;line-height:1.9;">
        <b>🗺️ ${name} moved</b>
        <div><span style="color:#777;">Hex:</span> ${hexLabel}</div>
        ${regionLine}${terrainLine}${tagsLine}
        <div style="border-top:1px solid #ddd;margin-top:4px;padding-top:4px;">
          <span style="color:#777;">Total:</span> <b>${totalSpaces} space${totalSpaces!==1?"s":""}</b>
        </div>
      </div>`,
      speaker: { alias: "Campaign Master" },
      whisper: [game.user.id]
    });
  };

  const _tokenCenter = (doc, x, y) => ({
    x: x + (doc.width  * canvas.grid.sizeX) / 2,
    y: y + (doc.height * canvas.grid.sizeY) / 2,
  });

  const hookPre = Hooks.on("preUpdateToken", (tokenDoc, changes) => {
    if (changes.x === undefined && changes.y === undefined) return;
    const id = tokenDoc.id;
    if (!pending[id]) pending[id] = { name: tokenDoc.name, segments: [], flushTimer: null };
    pending[id]._segmentStart = _tokenCenter(tokenDoc, tokenDoc.x, tokenDoc.y);
  });

  const hook = Hooks.on("updateToken", (tokenDoc, changes) => {
    if (changes.x === undefined && changes.y === undefined) return;
    const id   = tokenDoc.id;
    const data = pending[id];
    if (!data?._segmentStart) return;
    const from = data._segmentStart;
    const to   = _tokenCenter(tokenDoc, changes.x ?? tokenDoc.x, changes.y ?? tokenDoc.y);
    if (from.x === to.x && from.y === to.y) return;
    data.segments.push({ from, to });
    data._segmentStart = null;
    clearTimeout(data.flushTimer);
    data.flushTimer = setTimeout(() => flushMove(id), 300);
  });

  const hookCanvasReady = Hooks.on("canvasReady", () => {
    for (const id of Object.keys(pending)) { clearTimeout(pending[id].flushTimer); delete pending[id]; }
  });

  CM_TT.tracker = { hook, hookPre, hookCanvasReady, pending };
}

export function stopTracker() {
  if (!CM_TT.tracker) return;
  Hooks.off("updateToken",    CM_TT.tracker.hook);
  Hooks.off("preUpdateToken", CM_TT.tracker.hookPre);
  Hooks.off("canvasReady",    CM_TT.tracker.hookCanvasReady);
  for (const data of Object.values(CM_TT.tracker.pending)) clearTimeout(data.flushTimer);
  CM_TT.tracker = null;
}
