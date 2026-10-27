import { VISUALS } from "./config/index.js";

const SVG_NS = "http://www.w3.org/2000/svg";

export function iconMarkup(type, color = "currentColor", label = "") {
  const visual = VISUALS[type];
  if (!visual) throw new Error(`Unknown visual ID "${type}"`);
  return `<svg class="entity-icon" viewBox="0 0 100 100" role="img" aria-label="${label}" style="--icon-color:${color}">${visual.svg}</svg>`;
}

export function createSvgImage(type, color) {
  const visual = VISUALS[type];
  if (!visual) throw new Error(`Unknown visual ID "${type}"`);
  const svg = `<svg xmlns="${SVG_NS}" viewBox="0 0 100 100"><style>path,circle{fill:${color};stroke:rgba(255,255,255,.9);stroke-width:2;stroke-linejoin:round}.detail{fill:none;stroke:#071019;stroke-width:4}.detail-fill{fill:#071019;stroke:none}.cut{fill:#071019;stroke:${color};stroke-width:3}</style>${visual.svg}</svg>`;
  const image = new Image();
  image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  return image;
}