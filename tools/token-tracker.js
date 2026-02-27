/* ============================================================
   Campaign Master — Token Movement Tracker tool
   ============================================================ */

const MODULE_ID = "campaign-master";
const CM_TT = { tracker: null };

export function startTracker(getTerrainAtPoint) {
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

    const fromOffset  = canvas.grid.getOffset({ x: fromFirst.x, y: fromFirst.y });
    const toOffset    = canvas.grid.getOffset({ x: toLast.x,    y: toLast.y    });
    const destTerrain = getTerrainAtPoint(toLast.x, toLast.y);
    const terrainNote = destTerrain
      ? `<br><span style="color:#555;">Terrain:</span> <b style="color:${destTerrain.color}">${destTerrain.name}</b>`
      : "";
    const segmentLines = segments.length > 1
      ? segments.map((s, idx) => {
          const a = canvas.grid.getOffset({ x: s.from.x, y: s.from.y });
          const b = canvas.grid.getOffset({ x: s.to.x,   y: s.to.y   });
          let sp = 1;
          try { const r = canvas.grid.measurePath([s.from, s.to]); sp = r.spaces ?? sp; } catch(e) {}
          return `<div style="color:#777;font-size:11px;padding-left:8px;">Segment ${idx+1}: [${a.i},${a.j}] → [${b.i},${b.j}] (${sp} space${sp!==1?"s":""})</div>`;
        }).join("") : "";

    ChatMessage.create({
      content: `<div style="border:1px solid #4a7c4e;border-radius:6px;padding:8px 12px;
                  background:#f4f9f4;font-family:sans-serif;font-size:13px;line-height:1.8;">
        <b>🗺️ ${name} moved</b><br>
        <span style="color:#555;">From:</span> <code>[${fromOffset.i},${fromOffset.j}]</code>
        <span style="color:#555;"> → To:</span> <code>[${toOffset.i},${toOffset.j}]</code><br>
        <span style="color:#555;">Total:</span> <b>${totalSpaces} space${totalSpaces!==1?"s":""}</b>
        ${terrainNote}${segmentLines}</div>`,
      speaker: { alias: "Campaign Master" },
      whisper: [game.user.id]
    });
  };

  const hookPre = Hooks.on("preUpdateToken", (tokenDoc, changes) => {
    if (changes.x === undefined && changes.y === undefined) return;
    const id = tokenDoc.id;
    if (!pending[id]) pending[id] = { name: tokenDoc.name, segments: [], flushTimer: null };
    pending[id]._segmentStart = { x: tokenDoc.x, y: tokenDoc.y };
  });

  const hook = Hooks.on("updateToken", (tokenDoc, changes) => {
    if (changes.x === undefined && changes.y === undefined) return;
    const id   = tokenDoc.id;
    const data = pending[id];
    if (!data?._segmentStart) return;
    const from = data._segmentStart;
    const to   = { x: changes.x ?? tokenDoc.x, y: changes.y ?? tokenDoc.y };
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
