import { deepFreeze } from "./deep-freeze.js";

export const VISUALS = deepFreeze({
  cruiser: { id: "cruiser", size: 56, svg: '<path class="hull" d="M47 95 40 92 40 87 36 84 36 81 33 79 33 76 34 73 36 68 31 65 31 60 33 51 37 46 38 43 37 40 38 38 37 35 37 30 39 24 39 21 41 13 44 5H56l3 8 2 8v3l2 3-1 3 1 3-1 3 1 4-1 3 1 3 3 5 3 9v5l-5 3 2 5 1 3v3l-3 2v3l-4 3-1 5-7 3Z"/><path class="panel" d="m50 9 5 9 1 12 4 5-2 8 4 9-4 8 3 10-5 5-2 14-4 3-4-3-2-14-5-5 3-10-4-8 4-9-2-8 4-5 1-12Z"/><path class="armor-line" d="M40 25h20M37 39l13 4 13-4M34 55l16 5 16-5M35 69l15 7 15-7M40 82h20M44 17l6 5 6-5"/><path class="panel-line" d="M42 33h16M41 48h18M41 64h18"/><circle class="turret" cx="50" cy="34" r="6"/><circle class="turret" cx="50" cy="52" r="7"/><circle class="turret" cx="50" cy="70" r="6"/><path class="barrel" d="M47 30V19m6 11V19M47 47V35m6 12V35M47 66V55m6 11V55"/><circle class="turret-core" cx="50" cy="34" r="2"/><circle class="turret-core" cx="50" cy="52" r="2"/><circle class="turret-core" cx="50" cy="70" r="2"/>' },
  corvette: { id: "corvette", size: 29, svg: '<path class="hull" d="M47 94 39 87 38 75 32 66 36 55 34 44 40 32 42 17 50 5l8 12 2 15 6 12-2 11 4 11-6 9-1 12-8 7Z"/><path class="panel" d="m50 12 5 14 1 15-4 10 5 12-4 13-3 10-3-10-4-13 5-12-4-10 1-15Z"/><path class="armor-line" d="M40 35h20M36 52l14 6 14-6M39 72l11 6 11-6"/><path class="panel-line" d="M44 43h12M43 65h14"/><circle class="turret" cx="50" cy="48" r="7"/><path class="barrel" d="M47 43V28m6 15V28"/><circle class="turret-core" cx="50" cy="48" r="2"/>' },
  frigate: { id: "frigate", size: 34, svg: '<path class="hull" d="M47 95 40 89 39 78 34 72 36 62 32 55 36 46 37 35 41 24 43 11 50 4l7 7 2 13 4 11 1 11 4 9-4 7 2 10-5 6-1 11-7 6Z"/><path class="panel" d="m50 10 4 12 3 13-2 11 4 10-4 9 2 12-7 11-7-11 2-12-4-9 4-10-2-11 3-13Z"/><path class="armor-line" d="M41 28h18M37 43l13 5 13-5M36 61l14 6 14-6M41 79h18"/><path class="panel-line" d="M44 38h12M43 58h14"/><circle class="turret" cx="50" cy="39" r="6"/><circle class="turret" cx="50" cy="61" r="6"/><path class="barrel" d="M47 35V23m6 12V23M47 57V45m6 12V45"/><circle class="turret-core" cx="50" cy="39" r="2"/><circle class="turret-core" cx="50" cy="61" r="2"/>' },
  destroyer: { id: "destroyer", size: 38, svg: '<path class="hull" d="M46 96 39 91 38 82 33 76 35 67 30 59 34 51 33 42 38 34 39 24 43 14 50 3l7 11 4 10 1 10 5 8-1 9 4 8-5 8 2 9-5 6-1 9-7 5Z"/><path class="panel" d="m50 9 5 12 2 13-3 9 5 10-4 10 3 11-4 12-4 4-4-4-4-12 3-11-4-10 5-10-3-9 2-13Z"/><path class="armor-line" d="M40 24h20M36 39l14 5 14-5M34 55l16 6 16-6M36 71l14 6 14-6M40 85h20"/><path class="panel-line" d="M43 32h14M42 49h16M42 66h16"/><circle class="turret" cx="50" cy="33" r="6"/><circle class="turret" cx="50" cy="52" r="7"/><circle class="turret" cx="50" cy="72" r="6"/><path class="barrel" d="M47 29V17m6 12V17M47 47V35m6 12V35M47 68V56m6 12V56"/><circle class="turret-core" cx="50" cy="33" r="2"/><circle class="turret-core" cx="50" cy="52" r="2"/><circle class="turret-core" cx="50" cy="72" r="2"/>' },
  battleship: { id: "battleship", size: 68, svg: '<path class="hull" d="M45 98 36 94 35 87 29 83 31 75 25 70 29 61 24 53 28 44 27 35 33 29 35 19 42 10 50 2l8 8 7 9 2 10 6 6-1 9 4 9-5 8 4 9-6 5 2 8-6 4-1 7-9 4Z"/><path class="panel" d="m50 7 6 10 3 12 5 8-3 9 6 8-6 9 5 8-5 8-3 12-8 4-8-4-3-12-5-8 5-8-6-9 6-8-3-9 5-8 3-12Z"/><path class="armor-line" d="M39 18h22M34 31l16 6 16-6M29 46l21 7 21-7M28 62l22 8 22-8M33 78l17 7 17-7M39 91h22"/><path class="panel-line" d="M41 25h18M38 41h24M37 58h26M39 75h22M43 88h14"/><circle class="turret" cx="50" cy="27" r="6"/><circle class="turret" cx="50" cy="44" r="7"/><circle class="turret" cx="50" cy="62" r="7"/><circle class="turret" cx="50" cy="79" r="6"/><path class="barrel" d="M47 23V11m6 12V11M47 39V27m6 12V27M47 57V45m6 12V45M47 75V63m6 12V63"/><circle class="turret-core" cx="50" cy="27" r="2"/><circle class="turret-core" cx="50" cy="44" r="2"/><circle class="turret-core" cx="50" cy="62" r="2"/><circle class="turret-core" cx="50" cy="79" r="2"/>' },
  squadron: {
    id: "squadron", size: 25,
    svg: '<path class="hull" d="m50 7 15 28-15-7-15 7Z"/><path class="hull" d="m19 50 15 28-15-7-15 7Z"/><path class="hull" d="m81 50 15 28-15-7-15 7Z"/><circle class="turret-core" cx="50" cy="52" r="7"/>',
    formationOffsets: {
      1: [{ x: 0, y: 0 }],
      2: [{ x: -19, y: 8 }, { x: 19, y: 8 }],
      3: [{ x: 0, y: -19 }, { x: -21, y: 17 }, { x: 21, y: 17 }]
    }
  },
  bomber: {
    id: "bomber", size: 25,
    svg: '<path class="hull" d="M50 9 62 30 73 39 68 59 57 55 50 82 43 55 32 59 27 39 38 30Z"/><path class="panel" d="m50 18 7 17 6 8-7 8-6 20-6-20-7-8 6-8Z"/><path class="panel-line" d="M38 42h24M45 53h10"/><circle class="turret-core" cx="50" cy="42" r="3"/>',
    formationOffsets: {
      1: [{ x: 0, y: 0 }],
      2: [{ x: -19, y: 8 }, { x: 19, y: 8 }],
      3: [{ x: 0, y: -19 }, { x: -21, y: 17 }, { x: 21, y: 17 }]
    }
  },
  assaultCraft: { id: "assaultCraft", size: 27, svg: '<circle class="hull" cx="50" cy="50" r="39"/><path class="panel" d="M19 50c5-17 16-27 31-27s26 10 31 27c-5 17-16 27-31 27S24 67 19 50Z"/><path class="armor-line" d="M14 50h72M25 35h50M25 65h50"/><path class="panel-line" d="M22 50h14m28 0h14M42 27h16M42 73h16"/><circle class="turret" cx="50" cy="50" r="13"/><circle class="turret-core" cx="50" cy="50" r="5"/><path class="barrel" d="M50 37V14"/>' },
  asteroidField: { id: "asteroidField", size: 35, svg: '<path d="m20 30 12-15 22 4 10 17-8 19-25 4-17-11Z"/><path d="m60 57 12-13 18 8 3 19-15 15-20-8Z"/><circle class="detail-fill" cx="39" cy="37" r="5"/>' },
  debrisField: { id: "debrisField", size: 35, svg: '<path d="m12 27 18-8 8 11-17 11Zm39-11 14 7-6 13-15-7Zm19 34 18-5 4 15-17 7ZM25 62l18-8 7 16-20 10Z"/>' },
  nebula: { id: "nebula", size: 35, svg: '<path d="M16 55c-9-18 8-32 25-28C49 7 79 12 78 34c23 5 22 35 2 40-8 19-39 16-45 0-14 3-24-7-19-19Z"/>' },
  minefield: { id: "minefield", size: 35, svg: '<circle cx="50" cy="50" r="15"/><path class="detail" d="M50 6v23M50 71v23M6 50h23M71 50h23M19 19l17 17M64 64l17 17M81 19 64 36M36 64 19 81"/>' },
  largeAsteroid: { id: "largeAsteroid", size: 39, svg: '<path d="m15 27 17-20 29 5 25 18 8 29-18 28-33 8-27-17L6 49Z"/><path class="detail" d="m31 31 15-8 13 10-7 14-18 1Zm21 31 18-7 9 14-12 12-18-6Z"/>' },
  station: { id: "station", size: 39, svg: '<path d="M24 14h52v72H24Z"/><path d="M9 36h82v28H9Z"/><circle class="cut" cx="50" cy="50" r="14"/><path class="detail" d="M50 3v33M50 64v33M3 50h33M64 50h33"/>' }
});
