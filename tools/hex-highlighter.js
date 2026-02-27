/* ============================================================
   Campaign Master — Hex Highlighter tool
   ============================================================ */

const CM_HL = { highlighter: null };

export function startHighlighter() {
  if (CM_HL.highlighter) return;
  const gfx = new PIXI.Graphics();
  canvas.stage.addChild(gfx);

  const moveHandler = (event) => {
    const pos    = event.data.getLocalPosition(canvas.stage);
    const offset = canvas.grid.getOffset({ x: pos.x, y: pos.y });
    const center = canvas.grid.getCenterPoint(offset);
    const shape  = canvas.grid.getShape();
    gfx.clear();
    gfx.beginFill(0x00ff00, 0.25);
    gfx.lineStyle(1, 0x00ff00, 0.4);
    if (shape?.length > 0) {
      gfx.moveTo(center.x + shape[0].x, center.y + shape[0].y);
      for (let i = 1; i < shape.length; i++) gfx.lineTo(center.x + shape[i].x, center.y + shape[i].y);
      gfx.closePath();
    } else {
      gfx.drawCircle(center.x, center.y, canvas.grid.size / 2);
    }
    gfx.endFill();
  };

  canvas.stage.on("mousemove", moveHandler);
  CM_HL.highlighter = { gfx, moveHandler };
}

export function stopHighlighter() {
  if (!CM_HL.highlighter) return;
  canvas.stage.off("mousemove", CM_HL.highlighter.moveHandler);
  CM_HL.highlighter.gfx.destroy();
  CM_HL.highlighter = null;
}
