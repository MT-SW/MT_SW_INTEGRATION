// Web Worker liczący prognozę zasięgu poza wątkiem UI.
// Uruchomienie: new Worker(new URL('./coverage-worker.js', import.meta.url), { type: 'module' }).
// Protokół (postMessage):
//   -> {type:'run', id, input, elevation:{zoom, tiles:[{x,y,width,height,elevations}]}, clutter:null|ClutterPolygon[] (toTransferable), heights}
//   -> {type:'cancel', id}
//   <- {type:'progress', id, value}   (0..1)
//   <- {type:'done', id, result}      (CoverageResult)
//   <- {type:'error', id, name, message}
import { computeCoverageAsync } from './coverage.js';
import { samplerFromTiles } from './elevation.js';
import { ClutterMap } from './clutter.js';

const cancelled = new Set();

self.onmessage = async (ev) => {
  const msg = ev.data || {};
  if (msg.type === 'cancel') { cancelled.add(msg.id); return; }
  if (msg.type !== 'run') return;
  const { id } = msg;
  try {
    const elevationAt = samplerFromTiles(msg.elevation.zoom, msg.elevation.tiles);
    let clutterAt = null;
    if (msg.clutter) {
      const map = ClutterMap.fromTransferable(msg.clutter);
      const heights = msg.heights || {};
      clutterAt = (lat, lon) => map.heightAt(lat, lon, heights);
    }
    let lastPost = 0;
    const result = await computeCoverageAsync(msg.input, elevationAt, clutterAt, {
      shouldCancel: () => cancelled.has(id),
      onProgress: (value) => {
        const now = Date.now();
        if (value >= 1 || now - lastPost > 50) { lastPost = now; self.postMessage({ type: 'progress', id, value }); }
      },
    });
    self.postMessage({ type: 'done', id, result });
  } catch (e) {
    self.postMessage({ type: 'error', id, name: (e && e.name) || 'Error', message: String((e && e.message) || e) });
  } finally {
    cancelled.delete(id);
  }
};
