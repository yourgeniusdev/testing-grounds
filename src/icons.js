const SVG_NS = "http://www.w3.org/2000/svg";

const PATHS = {
  cruiser: '<path d="M48 5 69 26 92 33 78 48 92 63 69 70 48 91 34 66 9 57 19 48 9 39 34 30Z"/><path class="detail" d="M48 17v62M27 40h42M27 56h42"/>',
  frigate: '<path d="M50 4 68 29 88 40 71 51 82 78 57 69 50 94 43 69 18 78 29 51 12 40 32 29Z"/><path class="detail" d="M50 16v64M34 42h32"/>',
  destroyer: '<path d="M50 4 75 27 91 48 73 55 78 84 51 72 24 84 29 55 9 48 25 27Z"/><path class="detail" d="M50 15v60M29 48h42"/>',
  battleship: '<path d="M50 3 72 22 94 38 82 51 93 70 65 72 50 95 35 72 7 70 18 51 6 38 28 22Z"/><path class="detail" d="M50 14v68M25 39h50M25 58h50"/>',
  squadron: '<path d="m50 7 15 28-15-7-15 7Z"/><path d="m19 50 15 28-15-7-15 7Z"/><path d="m81 50 15 28-15-7-15 7Z"/><circle class="detail-fill" cx="50" cy="52" r="7"/>',
  asteroidField: '<path d="m20 30 12-15 22 4 10 17-8 19-25 4-17-11Z"/><path d="m60 57 12-13 18 8 3 19-15 15-20-8Z"/><circle class="detail-fill" cx="39" cy="37" r="5"/>',
  debrisField: '<path d="m12 27 18-8 8 11-17 11Zm39-11 14 7-6 13-15-7Zm19 34 18-5 4 15-17 7ZM25 62l18-8 7 16-20 10Z"/>',
  nebula: '<path d="M16 55c-9-18 8-32 25-28C49 7 79 12 78 34c23 5 22 35 2 40-8 19-39 16-45 0-14 3-24-7-19-19Z"/>',
  minefield: '<circle cx="50" cy="50" r="15"/><path class="detail" d="M50 6v23M50 71v23M6 50h23M71 50h23M19 19l17 17M64 64l17 17M81 19 64 36M36 64 19 81"/>',
  largeAsteroid: '<path d="m15 27 17-20 29 5 25 18 8 29-18 28-33 8-27-17L6 49Z"/><path class="detail" d="m31 31 15-8 13 10-7 14-18 1Zm21 31 18-7 9 14-12 12-18-6Z"/>',
  station: '<path d="M24 14h52v72H24Z"/><path d="M9 36h82v28H9Z"/><circle class="cut" cx="50" cy="50" r="14"/><path class="detail" d="M50 3v33M50 64v33M3 50h33M64 50h33"/>'
};

export function iconMarkup(type, color = "currentColor", label = "") {
  const content = PATHS[type] || PATHS.cruiser;
  return `<svg class="entity-icon" viewBox="0 0 100 100" role="img" aria-label="${label}" style="--icon-color:${color}">${content}</svg>`;
}

export function createSvgImage(type, color) {
  const svg = `<svg xmlns="${SVG_NS}" viewBox="0 0 100 100"><style>path,circle{fill:${color};stroke:rgba(255,255,255,.9);stroke-width:2;stroke-linejoin:round}.detail{fill:none;stroke:#071019;stroke-width:4}.detail-fill{fill:#071019;stroke:none}.cut{fill:#071019;stroke:${color};stroke-width:3}</style>${PATHS[type] || PATHS.cruiser}</svg>`;
  const image = new Image();
  image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  return image;
}