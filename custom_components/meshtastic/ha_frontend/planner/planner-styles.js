// Style panelu Mesh Link Planer. Wszystko pod prefiksem .mlp-, kolory z zmiennych motywu HA
// (jasny/ciemny motyw działa bez dodatkowego kodu). Wstrzykiwane jako <style> do tego samego korzenia co mapa.
export const PLANNER_CSS = `
.mtsw-map { position: relative; }
.mlp-hidden { display: none !important; }
.mlp-open { position: relative; }
.mlp-open[aria-pressed="true"] { background: var(--primary-color, #03a9f4) !important; color: var(--text-primary-color, #fff) !important; border-color: transparent !important; }
.mlp-badge { display: inline-block; min-width: 16px; height: 16px; line-height: 16px; padding: 0 4px; margin-left: 6px; border-radius: 8px; background: var(--error-color, #db4437); color: #fff; font-size: 11px; font-weight: 700; text-align: center; box-sizing: border-box; }

.mlp-panel { position: absolute; right: 0; bottom: 0; width: min(460px, 100%); z-index: 1100; display: flex; flex-direction: column;
  background: var(--card-background-color, #fff); color: var(--primary-text-color, #212121); border-left: 1px solid var(--divider-color, #ddd);
  box-shadow: -4px 0 16px rgba(0,0,0,0.25); font-size: 14px; box-sizing: border-box; }
.mlp-panel *, .mlp-panel *::before, .mlp-panel *::after { box-sizing: border-box; }
.mlp-panel.mlp-away { display: none; }
.mlp-head { display: flex; align-items: flex-end; gap: 6px; padding: 10px 8px 8px 16px; border-bottom: 1px solid var(--divider-color, #ddd); }
.mlp-head-title { flex: 1; display: flex; align-items: baseline; gap: 6px; flex-wrap: wrap; }
.mlp-head h2 { margin: 0; font-size: 20px; font-weight: 500; }
.mlp-head-by { font-size: 12px; color: var(--secondary-text-color, #727272); }
.mlp-x { border: none; background: none; color: var(--primary-text-color, #212121); font-size: 22px; line-height: 1; cursor: pointer; padding: 6px 10px; border-radius: 50%; }
.mlp-x:hover { background: var(--secondary-background-color, #eee); }
.mlp-body { flex: 1; overflow-y: auto; padding: 12px 16px 24px; display: flex; flex-direction: column; gap: 12px; overscroll-behavior: contain; }
.mlp-sec { display: flex; flex-direction: column; gap: 12px; }
.mlp-toast { margin: 8px 16px 0; }

.mlp-card { border: 1px solid var(--divider-color, #ddd); border-radius: 12px; background: var(--secondary-background-color, #f5f5f5); padding: 12px; }
.mlp-card-head { display: flex; align-items: center; gap: 6px; margin-bottom: 10px; }
.mlp-card-head h3 { flex: 1; margin: 0; font-size: 16px; font-weight: 500; }
.mlp-card-body { display: flex; flex-direction: column; gap: 10px; }
.mlp-sub { display: flex; align-items: center; justify-content: space-between; color: var(--primary-color, #03a9f4); font-weight: 500; font-size: 14px; }
.mlp-row { display: flex; gap: 12px; justify-content: space-between; align-items: baseline; }
.mlp-row-label { color: var(--secondary-text-color, #727272); flex: 1; }
.mlp-row-value { text-align: right; }
.mlp-bold { font-weight: 600; }
.mlp-small { font-size: 12px; color: var(--secondary-text-color, #727272); line-height: 1.4; }
.mlp-warn-text { color: var(--warning-color, #ffa600); }
.mlp-err-text { color: var(--error-color, #db4437); }
.mlp-hr { border: none; border-top: 1px solid var(--divider-color, #ddd); margin: 2px 0; width: 100%; }

.mlp-notice { display: flex; gap: 8px; align-items: flex-start; padding: 8px 10px; border-radius: 8px; font-size: 12px; line-height: 1.4;
  background: color-mix(in srgb, var(--primary-color, #03a9f4) 16%, var(--card-background-color, #fff)); }
.mlp-notice-error { background: color-mix(in srgb, var(--error-color, #db4437) 18%, var(--card-background-color, #fff)); }
.mlp-notice-icon { flex: none; width: 18px; height: 18px; border-radius: 50%; background: var(--primary-color, #03a9f4); color: #fff; font-size: 12px; font-weight: 700; text-align: center; line-height: 18px; }
.mlp-notice-error .mlp-notice-icon { background: var(--error-color, #db4437); }

.mlp-field { display: flex; flex-direction: column; gap: 3px; }
.mlp-field-label { font-size: 12px; color: var(--secondary-text-color, #727272); }
.mlp-input-row { display: flex; align-items: center; gap: 6px; }
.mlp-input, .mlp-select { width: 100%; min-height: 36px; padding: 6px 10px; border-radius: 8px; border: 1px solid var(--divider-color, #bbb);
  background: var(--card-background-color, #fff); color: var(--primary-text-color, #212121); font: inherit; }
.mlp-input:focus, .mlp-select:focus { outline: 2px solid var(--primary-color, #03a9f4); outline-offset: -1px; }
.mlp-input:disabled { opacity: 0.55; }
.mlp-input.mlp-invalid { border-color: var(--error-color, #db4437); }
.mlp-suffix { color: var(--secondary-text-color, #727272); white-space: nowrap; font-size: 13px; }
.mlp-support { font-size: 11px; color: var(--secondary-text-color, #727272); min-height: 0; }
.mlp-support:empty { display: none; }
.mlp-support-error { color: var(--error-color, #db4437); }
.mlp-two { display: flex; gap: 8px; align-items: flex-start; }
.mlp-two > * { flex: 1; min-width: 0; }
.mlp-flow { display: flex; flex-wrap: wrap; gap: 8px; }

.mlp-btn { border: 1px solid var(--divider-color, #bbb); background: var(--card-background-color, #fff); color: var(--primary-text-color, #212121); border-radius: 18px;
  padding: 7px 14px; font: inherit; font-size: 13px; cursor: pointer; text-decoration: none; display: inline-flex; align-items: center; gap: 6px; }
.mlp-btn:hover:not(:disabled) { background: var(--secondary-background-color, #eee); }
.mlp-btn:disabled { opacity: 0.5; cursor: default; }
.mlp-btn-primary { background: var(--primary-color, #03a9f4); color: var(--text-primary-color, #fff); border-color: transparent; }
.mlp-btn-primary:hover:not(:disabled) { background: var(--primary-color, #03a9f4); filter: brightness(1.1); }
.mlp-btn-text { border-color: transparent; background: none; color: var(--primary-color, #03a9f4); }
.mlp-btn-icon { padding: 4px 8px; border-radius: 8px; min-width: 30px; justify-content: center; }
.mlp-chip { border: 1px solid var(--divider-color, #bbb); background: var(--card-background-color, #fff); color: var(--primary-text-color, #212121); border-radius: 8px; padding: 6px 10px; font: inherit; font-size: 13px; cursor: pointer; }
.mlp-chip-on { background: color-mix(in srgb, var(--primary-color, #03a9f4) 22%, var(--card-background-color, #fff)); border-color: var(--primary-color, #03a9f4); }
.mlp-chip:disabled { opacity: 0.5; cursor: default; }
.mlp-seg { display: inline-flex; border: 1px solid var(--divider-color, #bbb); border-radius: 18px; overflow: hidden; width: 100%; }
.mlp-seg-btn { flex: 1; border: none; background: var(--card-background-color, #fff); color: var(--primary-text-color, #212121); padding: 8px 12px; font: inherit; cursor: pointer; }
.mlp-seg-btn + .mlp-seg-btn { border-left: 1px solid var(--divider-color, #bbb); }
.mlp-seg-on { background: color-mix(in srgb, var(--primary-color, #03a9f4) 25%, var(--card-background-color, #fff)); font-weight: 600; }
.mlp-seg-inline { width: auto; align-self: flex-start; }
.mlp-seg-inline .mlp-seg-btn { padding: 8px 14px; }
.mlp-check { display: flex; align-items: center; gap: 6px; }
.mlp-check label { flex: 1; display: flex; align-items: center; gap: 8px; cursor: pointer; }
.mlp-check input { width: 18px; height: 18px; }
.mlp-info { flex: none; width: 24px; height: 24px; border-radius: 50%; border: 1.5px solid var(--primary-color, #03a9f4); color: var(--primary-color, #03a9f4); background: none;
  font: italic 700 13px/1 serif; cursor: pointer; padding: 0; }
.mlp-info:hover { background: var(--secondary-background-color, #eee); }
.mlp-stepper { display: flex; align-items: center; gap: 8px; }
.mlp-stepper > span:first-child { flex: 1; }
.mlp-count { min-width: 20px; text-align: center; font-weight: 600; }

.mlp-sidecards { display: flex; gap: 8px; }
.mlp-sidecard { flex: 1; min-width: 0; text-align: left; border: 1px solid var(--divider-color, #bbb); border-radius: 12px; padding: 10px;
  background: var(--card-background-color, #fff); color: inherit; font: inherit; cursor: pointer; display: flex; flex-direction: column; gap: 2px; }
.mlp-sidecard-on { border: 2px solid var(--primary-color, #03a9f4); padding: 9px; background: color-mix(in srgb, var(--primary-color, #03a9f4) 14%, var(--card-background-color, #fff)); }
.mlp-sidecard-head { display: flex; align-items: center; justify-content: space-between; font-weight: 600; }
.mlp-sidecard .mlp-trunc { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mlp-warn-ic { color: var(--error-color, #db4437); font-weight: 700; }

.mlp-dircards { display: flex; gap: 8px; }
.mlp-dir { flex: 1; border: 2px solid; border-radius: 12px; padding: 10px; background: var(--card-background-color, #fff); display: flex; flex-direction: column; gap: 4px; }
.mlp-dir-title { font-weight: 600; }
.mlp-dir-margin { font-size: 18px; font-weight: 500; }
.mlp-dir-verdict { font-weight: 700; }

.mlp-progress { width: 100%; height: 6px; appearance: none; border: none; border-radius: 3px; overflow: hidden; background: var(--divider-color, #ddd); accent-color: var(--primary-color, #03a9f4); }
.mlp-progress::-webkit-progress-bar { background: var(--divider-color, #ddd); }
.mlp-progress::-webkit-progress-value { background: var(--primary-color, #03a9f4); }
.mlp-progress::-moz-progress-bar { background: var(--primary-color, #03a9f4); }
.mlp-spin { display: inline-block; width: 14px; height: 14px; border: 2px solid var(--divider-color, #bbb); border-top-color: var(--primary-color, #03a9f4); border-radius: 50%; animation: mlp-rot 0.9s linear infinite; flex: none; }
@keyframes mlp-rot { to { transform: rotate(360deg); } }
.mlp-details { margin-top: 4px; font-size: 12px; }
.mlp-details summary { cursor: pointer; color: var(--secondary-text-color, #727272); }
.mlp-pre { margin: 4px 0 0; padding: 6px 8px; max-height: 180px; overflow: auto; white-space: pre-wrap; word-break: break-word; user-select: text; background: var(--secondary-background-color, #f3f3f3); border-radius: 6px; font-size: 11px; }
.mlp-status { display: flex; align-items: center; gap: 8px; }
.mlp-status > .mlp-small { flex: 1; }

.mlp-chart { display: flex; flex-direction: column; gap: 8px; }
.mlp-svg { width: 100%; height: auto; display: block; touch-action: pan-y; user-select: none; }
.mlp-svg .grid { stroke: var(--primary-text-color, #212121); stroke-opacity: 0.12; stroke-width: 1; }
.mlp-svg .lbl { fill: var(--primary-text-color, #212121); font-size: 10px; }
.mlp-svg .axis { stroke: var(--primary-text-color, #212121); stroke-width: 1; }
.mlp-svg .terrain { fill: #8D6E63; fill-opacity: 0.55; }
.mlp-svg .terrain-line { stroke: #5D4037; stroke-width: 1.5; }
.mlp-svg .fresnel { fill: var(--accent-color, #ff9800); fill-opacity: 0.18; }
.mlp-svg .los { stroke: var(--primary-color, #03a9f4); stroke-width: 2; }
.mlp-svg .mast { stroke: var(--primary-text-color, #212121); stroke-width: 3; }
.mlp-svg .los-dot { fill: var(--primary-color, #03a9f4); }
.mlp-svg .sel-line { stroke: var(--primary-text-color, #212121); stroke-width: 1; stroke-dasharray: 8 6; }
.mlp-svg .sel-g { fill: #5D4037; }
.mlp-svg .sel-l { fill: var(--primary-color, #03a9f4); }
.mlp-legend { display: flex; flex-wrap: wrap; gap: 4px 16px; font-size: 12px; }
.mlp-legend-item { display: inline-flex; align-items: center; gap: 6px; }
.mlp-dot { width: 10px; height: 10px; border-radius: 50%; display: inline-block; }
.mlp-dot-terrain { background: #8D6E63; }
.mlp-dot-los { background: var(--primary-color, #03a9f4); }
.mlp-dot-fresnel { background: var(--accent-color, #ff9800); opacity: 0.5; }
.mlp-plan { display: flex; flex-direction: column; gap: 6px; }
.mlp-plan-canvas { width: 100%; aspect-ratio: 1 / 1; height: auto; border-radius: 8px; }
.mlp-grad { height: 12px; border-radius: 6px; border: 1px solid var(--divider-color, #bbb); }
.mlp-grad-labels { display: flex; justify-content: space-between; font-size: 11px; color: var(--secondary-text-color, #727272); }

.mlp-backdrop { position: absolute; inset: 0; z-index: 1500; background: rgba(0,0,0,0.5); display: flex; align-items: center; justify-content: center; padding: 16px; }
.mlp-dialog { background: var(--card-background-color, #fff); color: var(--primary-text-color, #212121); border-radius: 16px; max-width: 560px; width: 100%; max-height: 100%; display: flex; flex-direction: column; box-shadow: 0 8px 32px rgba(0,0,0,0.4); }
.mlp-dialog-title { margin: 0; padding: 18px 20px 8px; font-size: 18px; font-weight: 500; }
.mlp-dialog-body { padding: 4px 20px 8px; overflow-y: auto; line-height: 1.5; font-size: 14px; }
.mlp-dialog-body p { margin: 0 0 12px; }
.mlp-dialog-actions { padding: 8px 16px 16px; display: flex; justify-content: flex-end; }
.mlp-picklist { display: flex; flex-direction: column; max-height: 360px; overflow-y: auto; }
.mlp-pickrow { text-align: left; border: none; border-bottom: 1px solid var(--divider-color, #ddd); background: none; color: inherit; font: inherit; padding: 8px 4px; cursor: pointer; display: flex; flex-direction: column; gap: 2px; }
.mlp-pickrow:hover { background: var(--secondary-background-color, #eee); }

.mlp-banner { position: absolute; left: 50%; top: 12px; transform: translateX(-50%); z-index: 1200; display: flex; align-items: center; gap: 10px; padding: 6px 8px 6px 16px;
  border-radius: 24px; background: var(--primary-text-color, #212121); color: var(--card-background-color, #fff); box-shadow: 0 2px 10px rgba(0,0,0,0.4); max-width: calc(100% - 24px); }
.mlp-banner .mlp-btn-text { color: var(--primary-color, #03a9f4); }
.mtsw-map .mlp-picking, .mtsw-map .mlp-picking .leaflet-interactive { cursor: crosshair !important; }

.mlp-layers { position: absolute; left: 54px; top: 10px; z-index: 1000; width: min(300px, calc(100% - 70px)); max-height: 45%; display: flex; flex-direction: column;
  background: var(--card-background-color, #fff); color: var(--primary-text-color, #212121); border-radius: 10px; box-shadow: 0 1px 8px rgba(0,0,0,0.35); overflow: hidden; font-size: 12px; }
.mlp-layers-head { display: flex; justify-content: space-between; align-items: center; border: none; background: var(--secondary-background-color, #eee); color: inherit; font: inherit; font-weight: 600; padding: 7px 10px; cursor: pointer; text-align: left; }
.mlp-layers-list { overflow-y: auto; }
.mlp-layer-row { display: flex; gap: 6px; padding: 8px 10px; border-top: 1px solid var(--divider-color, #ddd); align-items: flex-start; }
.mlp-layer-info { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.mlp-layer-info input[type=range] { width: 100%; }
.mlp-layer-name { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mlp-layer-sub { color: var(--secondary-text-color, #727272); font-size: 11px; }
.mlp-layer-btns { display: flex; flex-direction: column; gap: 2px; }

.mlp-pin-wrap { background: none; border: none; }
.mlp-pin { width: 26px; height: 26px; border-radius: 50%; border: 2px solid #fff; color: #fff; font: 700 13px/22px sans-serif; text-align: center; box-shadow: 0 1px 4px rgba(0,0,0,0.5); }
.mlp-pin-a { background: #1565c0; }
.mlp-pin-b { background: #c62828; }
.mlp-cov-img { image-rendering: auto; }

@media (max-width: 600px) {
  .mlp-panel { width: 100%; border-left: none; }
  .mlp-layers { left: 8px; top: 56px; width: calc(100% - 16px); }
}
`;
