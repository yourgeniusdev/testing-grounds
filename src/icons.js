import { VISUALS } from "./config/index.js";

const SVG_NS = "http://www.w3.org/2000/svg";
const SQUADRON_CRAFT = '<path data-squadron-craft="" d="m50 37 15 28-15-7-15 7Z"/>';

function visualMarkup(type, stack) {
  const visual = VISUALS[type];
  if (!visual) throw new Error(`Unknown visual ID "${type}"`);
  if (type !== "squadron") return visual.svg;
  const displayCount = stack === undefined ? 3 : Math.max(1, stack);
  return `<circle class="detail-fill" cx="50" cy="52" r="7"/>${visual.formationOffsets[displayCount].map(offset => `<g transform="translate(${offset.x} ${offset.y})">${SQUADRON_CRAFT}</g>`).join("")}`;
}

export function iconMarkup(type, color = "currentColor", label = "", stack) {
  return `<svg class="entity-icon" viewBox="0 0 100 100" role="img" aria-label="${label}" style="--icon-color:${color}">${visualMarkup(type, stack)}</svg>`;
}

export function createSvgImage(type, color, stack) {
  const svg = `<svg xmlns="${SVG_NS}" viewBox="0 0 100 100"><style>path,circle{fill:${color};stroke:rgba(255,255,255,.9);stroke-width:2;stroke-linejoin:round}.detail{fill:none;stroke:#071019;stroke-width:4}.detail-fill{fill:#071019;stroke:none}.cut{fill:#071019;stroke:${color};stroke-width:3}</style>${visualMarkup(type, stack)}</svg>`;
  const image = new Image();
  image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  return image;
}