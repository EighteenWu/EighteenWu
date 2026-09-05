#!/usr/bin/env node
/**
 * Simulate a real Snake match (eat, grow, score, maybe die) and emit
 * a CSS-animated SVG that looks like watching someone play.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const COLS = 22;
const ROWS = 12;
const CELL = 26;
const MAX_TICKS = 160;
const MIN_EATEN = 14;
const MAX_SEED_TRIES = 80;

const FONT_3X5 = {
  "0": ["111", "101", "101", "101", "111"],
  "1": ["010", "110", "010", "010", "111"],
  "2": ["111", "001", "111", "100", "111"],
  "3": ["111", "001", "111", "001", "111"],
  "4": ["101", "101", "111", "001", "001"],
  "5": ["111", "100", "111", "001", "111"],
  "6": ["111", "100", "111", "101", "111"],
  "7": ["111", "001", "001", "001", "001"],
  "8": ["111", "101", "111", "101", "111"],
  "9": ["111", "101", "111", "001", "111"],
  A: ["010", "101", "111", "101", "101"],
  D: ["110", "101", "101", "101", "110"],
  E: ["111", "100", "111", "100", "111"],
  G: ["111", "100", "101", "101", "111"],
  I: ["111", "010", "010", "010", "111"],
  K: ["101", "101", "110", "101", "101"],
  L: ["100", "100", "100", "100", "111"],
  M: ["101", "111", "111", "101", "101"],
  N: ["110", "101", "101", "101", "101"],
  O: ["111", "101", "101", "101", "111"],
  P: ["111", "101", "111", "100", "100"],
  R: ["111", "101", "110", "101", "101"],
  S: ["111", "100", "111", "001", "111"],
  T: ["111", "010", "010", "010", "010"],
  U: ["101", "101", "101", "101", "111"],
  V: ["101", "101", "101", "101", "010"],
  W: ["101", "101", "111", "111", "101"],
  Y: ["101", "101", "010", "010", "010"],
  " ": ["000", "000", "000", "000", "000"],
  "+": ["000", "010", "111", "010", "000"],
};

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function dateSeed() {
  const fromEnv = process.env.GAME_SEED;
  if (fromEnv && /^\d+$/.test(fromEnv)) return Number(fromEnv);
  const now = new Date();
  return (
    now.getUTCFullYear() * 10000 +
    (now.getUTCMonth() + 1) * 100 +
    now.getUTCDate()
  );
}

function key(x, y) {
  return `${x},${y}`;
}

function parseKey(k) {
  const [x, y] = k.split(",").map(Number);
  return { x, y };
}

function dirsFrom(x, y) {
  return [
    { x: x + 1, y, name: "right" },
    { x: x - 1, y, name: "left" },
    { x: x, y: y + 1, name: "down" },
    { x: x, y: y - 1, name: "up" },
  ];
}

function inBoard(x, y) {
  return x >= 0 && y >= 0 && x < COLS && y < ROWS;
}

function opposite(a, b) {
  return (
    (a === "left" && b === "right") ||
    (a === "right" && b === "left") ||
    (a === "up" && b === "down") ||
    (a === "down" && b === "up")
  );
}

function bfs(start, goal, blocked) {
  if (start.x === goal.x && start.y === goal.y) return [];
  const startKey = key(start.x, start.y);
  const goalKey = key(goal.x, goal.y);
  const prev = new Map();
  const q = [start];
  prev.set(startKey, null);

  while (q.length) {
    const cur = q.shift();
    for (const n of dirsFrom(cur.x, cur.y)) {
      if (!inBoard(n.x, n.y)) continue;
      const nk = key(n.x, n.y);
      if (prev.has(nk)) continue;
      if (blocked.has(nk) && nk !== goalKey) continue;
      prev.set(nk, { x: cur.x, y: cur.y, dir: n.name });
      if (nk === goalKey) {
        const path = [];
        let ck = nk;
        while (ck !== startKey) {
          const p = prev.get(ck);
          path.push(p.dir);
          ck = key(p.x, p.y);
        }
        path.reverse();
        return path;
      }
      q.push({ x: n.x, y: n.y });
    }
  }
  return null;
}

function spawnFood(snake, rand) {
  const taken = new Set(snake.map((p) => key(p.x, p.y)));
  const empty = [];
  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      if (!taken.has(key(x, y))) empty.push({ x, y });
    }
  }
  if (!empty.length) return null;
  return empty[Math.floor(rand() * empty.length)];
}

function pickMove(snake, food, dir, rand) {
  const head = snake[0];
  const tail = snake[snake.length - 1];
  const body = new Set(snake.map((p) => key(p.x, p.y)));
  // Tail will vacate unless we grow this tick — treat tail as free for pathing.
  body.delete(key(tail.x, tail.y));

  const toFood = bfs(head, food, body);
  if (toFood && toFood.length) {
    const next = toFood[0];
    if (!opposite(dir, next)) return next;
  }

  const toTail = bfs(head, tail, body);
  if (toTail && toTail.length && !opposite(dir, toTail[0])) return toTail[0];

  const options = dirsFrom(head.x, head.y)
    .filter((n) => inBoard(n.x, n.y) && !body.has(key(n.x, n.y)) && !opposite(dir, n.name))
    .map((n) => n.name);

  if (options.length) return options[Math.floor(rand() * options.length)];

  const desperate = dirsFrom(head.x, head.y).find(
    (n) => inBoard(n.x, n.y) && !body.has(key(n.x, n.y)),
  );
  return desperate ? desperate.name : dir;
}

function simulate(seed) {
  const rand = mulberry32(seed);
  const startX = 4;
  const startY = 6;
  let snake = [
    { x: startX, y: startY },
    { x: startX - 1, y: startY },
    { x: startX - 2, y: startY },
  ];
  let dir = "right";
  let food = spawnFood(snake, rand);
  let score = 0;
  let eaten = 0;
  const frames = [
    {
      snake: snake.map((p) => ({ ...p })),
      food: food ? { ...food } : null,
      dir,
      score,
      length: snake.length,
      eaten,
      dead: false,
      justAte: false,
    },
  ];

  for (let tick = 0; tick < MAX_TICKS; tick++) {
    dir = pickMove(snake, food, dir, rand);
    const head = snake[0];
    const step = {
      right: { x: 1, y: 0 },
      left: { x: -1, y: 0 },
      up: { x: 0, y: -1 },
      down: { x: 0, y: 1 },
    }[dir];
    const next = { x: head.x + step.x, y: head.y + step.y };

    const hitWall = !inBoard(next.x, next.y);
    const hitBody = snake.some(
      (p, i) => i < snake.length - 1 && p.x === next.x && p.y === next.y,
    );
    if (hitWall || hitBody) {
      frames.push({
        snake: snake.map((p) => ({ ...p })),
        food: food ? { ...food } : null,
        dir,
        score,
        length: snake.length,
        eaten,
        dead: true,
        justAte: false,
      });
      break;
    }

    const ate = food && next.x === food.x && next.y === food.y;
    snake = [next, ...snake];
    if (ate) {
      score += 10;
      eaten += 1;
      food = spawnFood(snake, rand);
    } else {
      snake.pop();
    }

    frames.push({
      snake: snake.map((p) => ({ ...p })),
      food: food ? { ...food } : null,
      dir,
      score,
      length: snake.length,
      eaten,
      dead: false,
      justAte: ate,
    });
  }

  return { frames, eaten, score, seed };
}

function bestMatch(baseSeed) {
  let best = null;
  for (let i = 0; i < MAX_SEED_TRIES; i++) {
    const result = simulate(baseSeed + i * 97);
    if (!best || result.eaten > best.eaten || (result.eaten === best.eaten && result.frames.length > best.frames.length)) {
      best = result;
    }
    if (result.eaten >= MIN_EATEN && result.frames.length >= 90) return result;
  }
  return best;
}

function pixelGlyph(ch, x, y, size, color) {
  const g = FONT_3X5[ch];
  if (!g) return "";
  let out = "";
  for (let r = 0; r < 5; r++) {
    for (let c = 0; c < 3; c++) {
      if (g[r][c] === "1") {
        out += `<rect x="${x + c * size}" y="${y + r * size}" width="${size}" height="${size}" fill="${color}"/>`;
      }
    }
  }
  return out;
}

function pixelText(text, x, y, size, color, tracking = 1) {
  let out = "";
  let cx = x;
  for (const ch of text) {
    out += pixelGlyph(ch, cx, y, size, color);
    cx += 3 * size + size * tracking;
  }
  return out;
}

function esc(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function buildSvg(match) {
  const { frames, seed } = match;
  const tickMs = 140;
  const holdDead = 12;
  const last = frames[frames.length - 1];
  const playFrames = last.dead
    ? [...frames, ...Array.from({ length: holdDead }, () => last)]
    : frames;
  const n = playFrames.length;
  const dur = ((n * tickMs) / 1000).toFixed(2);
  const maxLen = playFrames.reduce((m, f) => Math.max(m, f.snake.length), 0);

  const fieldX = 36;
  const fieldY = 78;
  const fieldW = COLS * CELL;
  const fieldH = ROWS * CELL;
  const width = fieldW + 72;
  const height = fieldH + 150;

  const pct = (i) => ((i / n) * 100).toFixed(3);

  const headFrames = [];
  const foodFrames = [];
  const scoreShows = [];
  const lenShows = [];
  const deadShows = [];
  const yumShows = [];

  for (let i = 0; i < n; i++) {
    const f = playFrames[i];
    const h = f.snake[0];
    const rot = { right: 0, down: 90, left: 180, up: -90 }[f.dir];
    headFrames.push(
      `${pct(i)}%{transform:translate(${fieldX + h.x * CELL}px,${fieldY + h.y * CELL}px) rotate(${rot}deg)}`,
    );
    if (f.food) {
      foodFrames.push(
        `${pct(i)}%{transform:translate(${fieldX + f.food.x * CELL + CELL / 2}px,${fieldY + f.food.y * CELL + CELL / 2}px);opacity:1}`,
      );
    } else {
      foodFrames.push(`${pct(i)}%{opacity:0}`);
    }
  }
  headFrames.push(`100%{${headFrames[0].slice(headFrames[0].indexOf("{") + 1)}`);
  foodFrames.push(`100%{${foodFrames[0].slice(foodFrames[0].indexOf("{") + 1)}`);

  const uniqueScores = [...new Set(playFrames.map((f) => f.score))];
  const uniqueLens = [...new Set(playFrames.map((f) => f.length))];

  for (const score of uniqueScores) {
    const spans = [];
    for (let i = 0; i < n; i++) {
      if (playFrames[i].score === score) spans.push(i);
    }
    scoreShows.push({ score, spans });
  }
  for (const length of uniqueLens) {
    const spans = [];
    for (let i = 0; i < n; i++) {
      if (playFrames[i].length === length) spans.push(i);
    }
    lenShows.push({ length, spans });
  }

  const visibilityKeyframes = (spans, id) => {
    const marks = ["0%{opacity:0}"];
    let prevOn = false;
    for (let i = 0; i < n; i++) {
      const on = spans.includes(i);
      if (on !== prevOn) {
        marks.push(`${pct(i)}%{opacity:${on ? 1 : 0}}`);
        prevOn = on;
      }
    }
    marks.push(`100%{opacity:${spans.includes(0) ? 1 : 0}}`);
    return `@keyframes ${id}{${marks.join("")}}`;
  };

  let bodyCss = "";
  let bodyEls = "";
  for (let s = 1; s < maxLen; s++) {
    const framesCss = [];
    for (let i = 0; i < n; i++) {
      const seg = playFrames[i].snake[s];
      if (seg) {
        framesCss.push(
          `${pct(i)}%{transform:translate(${fieldX + seg.x * CELL}px,${fieldY + seg.y * CELL}px);opacity:1}`,
        );
      } else {
        framesCss.push(`${pct(i)}%{opacity:0}`);
      }
    }
    const first = playFrames[0].snake[s];
    framesCss.push(
      first
        ? `100%{transform:translate(${fieldX + first.x * CELL}px,${fieldY + first.y * CELL}px);opacity:1}`
        : `100%{opacity:0}`,
    );
    bodyCss += `@keyframes bod${s}{${framesCss.join("")}}`;
    const hue = 118 - Math.min(s * 3, 36);
    const light = 58 - Math.min(s * 1.2, 18);
    bodyEls += `<g class="bod bod${s}"><rect x="3" y="3" width="${CELL - 6}" height="${CELL - 6}" rx="7" fill="hsl(${hue},86%,${light}%)"/></g>`;
  }

  const cssChunks = [];
  const scoreEls = [];
  const lenEls = [];

  scoreShows.forEach((item, idx) => {
    const id = `sc${idx}`;
    cssChunks.push(visibilityKeyframes(item.spans, id));
    cssChunks.push(`.${id}{animation:${id} ${dur}s steps(1) infinite}`);
    scoreEls.push(
      `<g class="${id}">${pixelText(String(item.score).padStart(3, "0"), 0, 0, 3, "#d7ff6a")}</g>`,
    );
  });
  lenShows.forEach((item, idx) => {
    const id = `ln${idx}`;
    cssChunks.push(visibilityKeyframes(item.spans, id));
    cssChunks.push(`.${id}{animation:${id} ${dur}s steps(1) infinite}`);
    lenEls.push(
      `<g class="${id}">${pixelText(String(item.length).padStart(2, "0"), 0, 0, 3, "#7dffe1")}</g>`,
    );
  });

  const deadSpans = playFrames.map((f, i) => (f.dead ? i : -1)).filter((i) => i >= 0);
  cssChunks.push(visibilityKeyframes(deadSpans, "dead"));
  cssChunks.push(`.dead{animation:dead ${dur}s steps(1) infinite}`);

  const yumSpans = [];
  for (let i = 0; i < n; i++) {
    if (playFrames[i].justAte) {
      yumSpans.push(i);
      if (i + 1 < n) yumSpans.push(i + 1);
      if (i + 2 < n) yumSpans.push(i + 2);
    }
  }
  cssChunks.push(visibilityKeyframes(yumSpans, "yum"));
  cssChunks.push(`.yum{animation:yum ${dur}s steps(1) infinite}`);

  const grid = [];
  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      const odd = (x + y) % 2 === 0;
      grid.push(
        `<rect x="${fieldX + x * CELL}" y="${fieldY + y * CELL}" width="${CELL}" height="${CELL}" fill="${odd ? "#152016" : "#101810"}"/>`,
      );
    }
  }

  const css = [
    `.head,.food,.bod{transform-box:view-box;transform-origin:0 0}`,
    `.head{animation:head ${dur}s steps(1) infinite;transform-origin:${CELL / 2}px ${CELL / 2}px}`,
    `@keyframes head{${headFrames.join("")}}`,
    `.food{animation:food ${dur}s steps(1) infinite}`,
    `@keyframes food{${foodFrames.join("")}}`,
    `.food-core{animation:pulse 0.7s ease-in-out infinite alternate}`,
    `@keyframes pulse{from{transform:scale(1)}to{transform:scale(1.18)}}`,
    ...Array.from({ length: maxLen - 1 }, (_, i) => `.bod${i + 1}{animation:bod${i + 1} ${dur}s steps(1) infinite}`),
    bodyCss,
    ...cssChunks,
  ].join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="Autoplay Snake: the snake eats food and grows longer">
  <title>Arcade Snake (autoplay)</title>
  <desc>${esc(`Seed ${seed}. Eats ${match.eaten} pellets, max length ${maxLen}, score ${match.score}.`)}</desc>
  <style><![CDATA[
    ${css}
  ]]></style>
  <defs>
    <radialGradient id="bg" cx="50%" cy="30%" r="80%">
      <stop offset="0%" stop-color="#182218"/>
      <stop offset="100%" stop-color="#070a07"/>
    </radialGradient>
    <filter id="glow" x="-40%" y="-40%" width="180%" height="180%">
      <feGaussianBlur stdDeviation="2.2" result="b"/>
      <feMerge>
        <feMergeNode in="b"/>
        <feMergeNode in="SourceGraphic"/>
      </feMerge>
    </filter>
  </defs>
  <rect width="${width}" height="${height}" rx="28" fill="url(#bg)"/>
  <rect x="14" y="14" width="${width - 28}" height="${height - 28}" rx="22" fill="none" stroke="#2d4a2d" stroke-width="2"/>
  <g transform="translate(36 28)">
    ${pixelText("SNAKE", 0, 0, 4, "#9aff5c", 0.8)}
  </g>
  <g transform="translate(${width - 210} 26)">
    ${pixelText("SCORE", 0, 2, 2, "#5e7a4a")}
    <g transform="translate(70 0)">${scoreEls.join("")}</g>
  </g>
  <g transform="translate(${width - 90} 26)">
    ${pixelText("LEN", 0, 2, 2, "#4a7a70")}
    <g transform="translate(42 0)">${lenEls.join("")}</g>
  </g>
  <rect x="${fieldX - 4}" y="${fieldY - 4}" width="${fieldW + 8}" height="${fieldH + 8}" rx="10" fill="#0b0f0b" stroke="#2a3f2a" stroke-width="2"/>
  ${grid.join("")}
  ${bodyEls}
  <g class="head">
    <rect x="2" y="2" width="${CELL - 4}" height="${CELL - 4}" rx="8" fill="#c8ff57" filter="url(#glow)"/>
    <rect x="${CELL - 11}" y="7" width="4" height="4" rx="1" fill="#102008"/>
    <rect x="${CELL - 11}" y="${CELL - 11}" width="4" height="4" rx="1" fill="#102008"/>
  </g>
  <g class="food">
    <g class="food-core" filter="url(#glow)">
      <circle r="7" fill="#ff4d6d"/>
      <circle cx="-2" cy="-2" r="2" fill="#ffd0d8"/>
    </g>
  </g>
  <g class="yum" transform="translate(${fieldX + 8} ${fieldY + 8})" opacity="0">
    ${pixelText("YUM +10", 0, 0, 3, "#fff27a")}
  </g>
  <g class="dead" transform="translate(${fieldX + fieldW / 2 - 86} ${fieldY + fieldH / 2 - 22})" opacity="0">
    <rect x="-16" y="-14" width="204" height="52" rx="8" fill="#120808" fill-opacity="0.88"/>
    ${pixelText("GAME OVER", 0, 0, 4, "#ff6b6b")}
  </g>
  <g transform="translate(36 ${fieldY + fieldH + 20})">
    ${pixelText("AUTO PLAY   EAT AND GROW", 0, 0, 2, "#4d6348")}
  </g>
</svg>
`;
}

const seed = dateSeed();
const match = bestMatch(seed);
if (!match || match.eaten < 6) {
  console.error("Failed to simulate a long enough game", match);
  process.exit(1);
}

const here = path.dirname(fileURLToPath(import.meta.url));
const out = process.env.OUTPUT || path.join(here, "..", "dist", "arcade-snake.svg");
const outPath = path.resolve(out);
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, buildSvg(match), "utf8");
console.log(
  `Wrote ${outPath}  eaten=${match.eaten} score=${match.score} frames=${match.frames.length} seed=${match.seed}`,
);
