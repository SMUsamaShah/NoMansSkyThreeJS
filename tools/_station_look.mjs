// Station hull and the star field: both are judged against black space, and
// both regressed in different ways (star confetti from chromatic aberration on
// point highlights; near-white hull losing its plating).
import { withGame } from './harness.mjs';
await withGame({ out: 'screenshots/station', width: 1280, height: 720 }, async (g) => {
  await g.look('01-station', 'NMS.stationVista(2.6)');
  await g.look('02-station-far', 'NMS.stationVista(5.0)');
});
