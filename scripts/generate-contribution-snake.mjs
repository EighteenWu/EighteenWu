#!/usr/bin/env node
/**
 * Contribution-graph snake: eat as many green days as possible.
 * If the snake dies or leftovers remain, those marks assemble into GAMEOVER.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SIZE_CELL = 16;
const SIZE_DOT = 12;
const DOT_R = 2;
const START_LEN = 4;
const MAX_LEN = 24;
const STEP_MS = 110;
const FREEZE_FRAMES = 6;
const ASSEMBLE_FRAMES = 22;
const HOLD_FRAMES = 32;
const USER = process.env.GITHUB_USER || "EighteenWu";

const PALETTES = {
  light: {
    empty: "#ebedf0",
    border: "#1b1f230a",
    snake: "purple",
    text: "#656d76",
    dots: ["#ebedf0", "#9be9a8", "#40c463", "#30a14e", "#216e39"],
  },
  dark: {
    empty: "#161b22",
    border: "#ffffff0a",
    snake: "#b392f0",
    text: "#9198a1",
    dots: ["#161b22", "#0e4429", "#006d32", "#26a641", "#39d353"],
  },
};

const LETTERS = {
  G: ["01110", "10001", "10000", "10111", "10001", "10001", "01110"],
  A: ["01110", "10001", "10001", "11111", "10001", "10001", "10001"],
  M: ["10001", "11011", "10101", "10101", "10001", "10001", "10001"],
  E: ["11111", "10000", "10000", "11110", "10000", "10000", "11111"],
  O: ["01110", "10001", "10001", "10001", "10001", "10001", "01110"],
  V: ["10001", "10001", "10001", "10001", "10001", "01010", "00100"],
  R: ["11110", "10001", "10001", "11110", "10100", "10010", "10001"],
};

function key(x, y) {
  return `${x},${y}`;
}

function dist(a, b) {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

function dirs(x, y) {
  return [
    { x: x + 1, y },
    { x: x - 1, y },
    { x, y: y + 1 },
    { x, y: y - 1 },
  ];
}

function inBoard(x, y, cols, rows) {
  return x >= 0 && y >= 0 && x < cols && y < rows;
}

function bfs(start, goal, blocked, cols, rows) {
  const goalKey = key(goal.x, goal.y);
  const startKey = key(start.x, start.y);
  if (startKey === goalKey) return [];
  const prev = new Map([[startKey, null]]);
  const q = [start];
  while (q.length) {
    const cur = q.shift();
    for (const n of dirs(cur.x, cur.y)) {
      if (!inBoard(n.x, n.y, cols, rows)) continue;
      const nk = key(n.x, n.y);
      if (prev.has(nk)) continue;
      if (blocked.has(nk) && nk !== goalKey) continue;
      prev.set(nk, cur);
      if (nk === goalKey) {
        const path = [{ x: n.x, y: n.y }];
        let p = cur;
        while (key(p.x, p.y) !== startKey) {
          path.push(p);
          p = prev.get(key(p.x, p.y));
        }
        path.reverse();
        return path;
      }
      q.push(n);
    }
  }
  return null;
}

function nearestFoodPath(head, foods, blocked, cols, rows) {
  const foodSet = new Set(foods.map((f) => key(f.x, f.y)));
  const prev = new Map([[key(head.x, head.y), null]]);
  const q = [head];
  while (q.length) {
    const cur = q.shift();
    for (const n of dirs(cur.x, cur.y)) {
      if (!inBoard(n.x, n.y, cols, rows)) continue;
      const nk = key(n.x, n.y);
      if (prev.has(nk)) continue;
      if (blocked.has(nk) && !foodSet.has(nk)) continue;
      prev.set(nk, cur);
      if (foodSet.has(nk)) {
        const path = [n];
        let p = cur;
        const startKey = key(head.x, head.y);
        while (key(p.x, p.y) !== startKey) {
          path.push(p);
          p = prev.get(key(p.x, p.y));
        }
        path.reverse();
        return path;
      }
      q.push(n);
    }
  }
  return null;
}

function anySafe(head, blocked, cols, rows) {
  return dirs(head.x, head.y).find(
    (n) => inBoard(n.x, n.y, cols, rows) && !blocked.has(key(n.x, n.y)),
  );
}

function levelFromCount(count, cuts) {
  if (count <= 0) return 0;
  if (count <= cuts[0]) return 1;
  if (count <= cuts[1]) return 2;
  if (count <= cuts[2]) return 3;
  return 4;
}

function quartileCuts(counts) {
  const nz = counts.filter((n) => n > 0).sort((a, b) => a - b);
  if (!nz.length) return [1, 2, 3];
  const at = (q) => nz[Math.min(nz.length - 1, Math.floor(q * (nz.length - 1)))];
  return [at(0.25), at(0.5), at(0.75)];
}

async function fetchCalendar(login, token) {
  const res = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "User-Agent": "contribution-snake",
    },
    body: JSON.stringify({
      query: `query($login:String!){
        user(login:$login){
          contributionsCollection{
            contributionCalendar{
              weeks{ contributionDays{ contributionCount weekday } }
            }
          }
        }
      }`,
      variables: { login },
    }),
  });
  if (!res.ok) {
    throw new Error(`GitHub GraphQL ${res.status}: ${await res.text()}`);
  }
  const json = await res.json();
  const weeks = json.data?.user?.contributionsCollection?.contributionCalendar?.weeks;
  if (!weeks) throw new Error(`No contribution calendar: ${JSON.stringify(json.errors || json)}`);
  return weeks;
}

function simulate(grid) {
  const cols = grid.length;
  const rows = 7;
  const foods = [];
  for (let x = 0; x < cols; x++) {
    for (let y = 0; y < rows; y++) {
      if (grid[x][y].count > 0) foods.push({ x, y, count: grid[x][y].count });
    }
  }

  let snake = [
    { x: 2, y: 3 },
    { x: 1, y: 3 },
    { x: 0, y: 3 },
    { x: 0, y: 2 },
  ].slice(0, START_LEN);

  const remaining = new Map(foods.map((f) => [key(f.x, f.y), f]));
  for (const p of snake) remaining.delete(key(p.x, p.y));
  let score = 0;
  const frames = [];
  const eatenAt = new Map();
  let ended = "clear";
  let guard = 0;
  const limit = cols * rows * 10;

  const snapshot = (justAte = false, dead = false) => {
    frames.push({
      snake: snake.map((p) => ({ ...p })),
      score,
      length: snake.length,
      justAte,
      dead,
    });
  };

  snapshot();

  while (remaining.size && guard++ < limit) {
    const head = snake[0];
    const tail = snake[snake.length - 1];
    const occupied = new Set(snake.map((p) => key(p.x, p.y)));
    const blocked = new Set(occupied);
    blocked.delete(key(tail.x, tail.y));

    const targets = [...remaining.values()].filter((f) => !occupied.has(key(f.x, f.y)));
    let path = nearestFoodPath(head, targets, blocked, cols, rows);
    if (!path) path = bfs(head, tail, blocked, cols, rows);
    const step = path && path.length ? path[0] : anySafe(head, blocked, cols, rows);
    if (!step) {
      ended = remaining.size ? "stuck" : "clear";
      snapshot(false, true);
      break;
    }

    const stepKey = key(step.x, step.y);
    const growing = remaining.has(stepKey);
    const hitSelf = snake.some((p, i) => {
      if (p.x !== step.x || p.y !== step.y) return false;
      return growing || i !== snake.length - 1;
    });
    if (hitSelf || !inBoard(step.x, step.y, cols, rows)) {
      ended = "dead";
      snapshot(false, true);
      break;
    }

    const ate = remaining.get(stepKey);
    snake = [step, ...snake];
    if (ate) {
      remaining.delete(stepKey);
      score += ate.count;
      eatenAt.set(stepKey, frames.length);
      if (snake.length > MAX_LEN) snake.pop();
    } else {
      snake.pop();
    }
    snapshot(Boolean(ate), false);
  }

  if (remaining.size && ended === "clear") ended = "stuck";
  if (!remaining.size) ended = "clear";

  return { frames, eatenAt, score, ended, leftover: remaining.size, foods };
}

function gameoverPixels(cols) {
  const word = ["G", "A", "M", "E", "O", "V", "E", "R"];
  const letterW = 5;
  const gap = 1;
  const wordW = word.length * letterW + (word.length - 1) * gap;
  const originX = Math.max(0, Math.floor((cols - wordW) / 2));
  const pixels = [];
  word.forEach((ch, i) => {
    const glyph = LETTERS[ch];
    const ox = originX + i * (letterW + gap);
    for (let y = 0; y < 7; y++) {
      for (let x = 0; x < letterW; x++) {
        if (glyph[y][x] === "1") pixels.push({ x: ox + x, y });
      }
    }
  });
  return pixels;
}

function assignMarks(foods, pixels) {
  const unused = foods.map((f) => ({ ...f }));
  const pairs = [];
  for (const pixel of pixels) {
    if (!unused.length) break;
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < unused.length; i++) {
      const d = dist(unused[i], pixel);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    pairs.push({ from: unused.splice(best, 1)[0], to: pixel });
  }
  for (const extra of unused) pairs.push({ from: extra, to: null });
  return pairs;
}

function visibilityKeyframes(onAt, n) {
  const marks = [];
  let prev = null;
  for (let i = 0; i < n; i++) {
    const on = onAt[i];
    if (on !== prev) {
      marks.push(`${((i / n) * 100).toFixed(3)}%{opacity:${on ? 1 : 0}}`);
      prev = on;
    }
  }
  marks.push(`100%{opacity:${onAt[0] ? 1 : 0}}`);
  return marks.join("");
}

function compactKeyframes(kf) {
  const styleOf = (item) => item.replace(/^[0-9.]+%/, "");
  const out = [];
  for (let i = 0; i < kf.length; i++) {
    const prev = i > 0 ? styleOf(kf[i - 1]) : null;
    const cur = styleOf(kf[i]);
    const next = i < kf.length - 1 ? styleOf(kf[i + 1]) : null;
    if (i === 0 || i === kf.length - 1 || kf[i].startsWith("99.") || cur !== prev || cur !== next) {
      out.push(kf[i]);
    }
  }
  return out;
}

function buildSvg(grid, match, theme) {
  const pal = PALETTES[theme];
  const cols = grid.length;
  const rows = 7;
  const { frames, eatenAt, ended, foods } = match;
  const showOver = true;
  const playN = frames.length;
  const assembleStart = playN + FREEZE_FRAMES;
  const assembleEnd = assembleStart + ASSEMBLE_FRAMES;
  const n = showOver ? assembleEnd + HOLD_FRAMES : playN;
  const dur = n * STEP_MS;
  const maxLen = frames.reduce((m, f) => Math.max(m, f.snake.length), 0);
  const last = frames[playN - 1];
  const pairs = assignMarks(foods, gameoverPixels(cols));
  const pairByFrom = new Map(pairs.map((p) => [key(p.from.x, p.from.y), p]));

  const width = (cols + 2) * SIZE_CELL;
  const height = (rows + 3) * SIZE_CELL;
  const viewBox = `${-SIZE_CELL} ${-SIZE_CELL * 1.5} ${width} ${height}`;
  const inset = (SIZE_CELL - SIZE_DOT) / 2;
  const pct = (i) => ((i / n) * 100).toFixed(3);

  const css = [];
  css.push(`:root{--cb:${pal.border};--cs:${pal.snake};--ce:${pal.empty};${pal.dots.map((c, i) => `--c${i}:${c}`).join(";")}}`);
  css.push(`.c{shape-rendering:geometricPrecision;fill:var(--ce);stroke-width:1px;stroke:var(--cb);width:${SIZE_DOT}px;height:${SIZE_DOT}px;transform-box:view-box;transform-origin:0 0}`);
  css.push(`.s{shape-rendering:geometricPrecision;fill:var(--cs);animation:none linear ${dur}ms infinite;transform-box:view-box;transform-origin:0 0}`);
  css.push(`.hud{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif;font-size:13px;font-variant-numeric:tabular-nums;fill:${pal.text}}`);
  css.push(`.digit{opacity:0}`);
  css.push(`@keyframes emptyFade{0%{opacity:1} ${pct(playN)}%{opacity:1} ${pct(assembleEnd)}%{opacity:0} 99.9%{opacity:0} 100%{opacity:1}}`);
  css.push(`.empty{animation:emptyFade ${dur}ms linear infinite}`);

  const cells = [];
  for (let x = 0; x < cols; x++) {
    for (let y = 0; y < rows; y++) {
      const cell = grid[x][y];
      const id = `c${x}x${y}`;
      const eatFrame = eatenAt.get(key(x, y));
      const pair = pairByFrom.get(key(x, y));

      if (cell.level === 0) {
        cells.push(
          `<rect class="c empty" x="${x * SIZE_CELL + inset}" y="${y * SIZE_CELL + inset}" rx="${DOT_R}" ry="${DOT_R}"/>`,
        );
        continue;
      }

      const kf = [];
      const fromX = x * SIZE_CELL + inset;
      const fromY = y * SIZE_CELL + inset;
      const toX = pair?.to ? pair.to.x * SIZE_CELL + inset : fromX;
      const toY = pair?.to ? pair.to.y * SIZE_CELL + inset : fromY;
      const keep = Boolean(pair?.to);

      kf.push(`0%{fill:var(--c${cell.level});transform:translate(0px,0px);opacity:1}`);
      if (eatFrame != null) {
        kf.push(`${pct(eatFrame)}%{fill:var(--c${cell.level});transform:translate(0px,0px);opacity:1}`);
        kf.push(`${((eatFrame + 0.4) / n * 100).toFixed(3)}%{fill:var(--ce);transform:translate(0px,0px);opacity:1}`);
        kf.push(`${pct(playN)}%{fill:var(--ce);transform:translate(0px,0px);opacity:1}`);
      }
      if (showOver) {
        kf.push(`${pct(assembleStart)}%{fill:var(--c${cell.level});transform:translate(0px,0px);opacity:1}`);
        kf.push(
          `${pct(assembleEnd)}%{fill:var(--c${cell.level});transform:translate(${toX - fromX}px,${toY - fromY}px);opacity:${keep ? 1 : 0}}`,
        );
        kf.push(
          `99.99%{fill:var(--c${cell.level});transform:translate(${toX - fromX}px,${toY - fromY}px);opacity:${keep ? 1 : 0}}`,
        );
      }
      kf.push(`100%{fill:var(--c${cell.level});transform:translate(0px,0px);opacity:1}`);

      css.push(`@keyframes ${id}{${compactKeyframes(kf).join("")}}`);
      css.push(`.${id}{fill:var(--c${cell.level});animation:${id} ${dur}ms linear infinite}`);
      cells.push(
        `<rect class="c ${id}" x="${fromX}" y="${fromY}" rx="${DOT_R}" ry="${DOT_R}"/>`,
      );
    }
  }

  const snakeEls = [];
  for (let s = 0; s < maxLen; s++) {
    const size = s === 0 ? SIZE_CELL * 0.92 : SIZE_DOT;
    const pad = (SIZE_CELL - size) / 2;
    const rr = s === 0 ? 4.5 : DOT_R;
    const pts = frames.map((f) => f.snake[s] || null);
    const firstPos = pts.find(Boolean) || last.snake[0];
    const kf = [];
    for (let i = 0; i < n; i++) {
      const play = i < playN ? pts[i] : last.snake[s] || firstPos;
      const on = i < assembleStart && Boolean(i < playN ? pts[i] : last.snake[s]);
      const p = play || firstPos;
      kf.push(
        `${pct(i)}%{transform:translate(${p.x * SIZE_CELL}px,${p.y * SIZE_CELL}px);opacity:${on ? 1 : 0}}`,
      );
    }
    kf.push(
      `100%{transform:translate(${(pts[0] || firstPos).x * SIZE_CELL}px,${(pts[0] || firstPos).y * SIZE_CELL}px);opacity:${pts[0] ? 1 : 0}}`,
    );
    css.push(`@keyframes s${s}{${compactKeyframes(kf).join("")}}`);
    css.push(`.s${s}{animation:s${s} ${dur}ms linear infinite}`);
    snakeEls.push(
      `<rect class="s s${s}" x="${pad.toFixed(1)}" y="${pad.toFixed(1)}" width="${size.toFixed(1)}" height="${size.toFixed(1)}" rx="${rr.toFixed(1)}" ry="${rr.toFixed(1)}"/>`,
    );
  }

  const scores = Array.from({ length: n }, (_, i) => (i < playN ? frames[i].score : last.score));
  const maxScore = last.score;
  const digits = Math.max(3, String(maxScore).length);
  const digitEls = [];
  for (let d = 0; d < digits; d++) {
    const place = 10 ** (digits - 1 - d);
    for (let glyph = 0; glyph < 10; glyph++) {
      const onAt = scores.map((score) => Math.floor(score / place) % 10 === glyph);
      if (!onAt.some(Boolean)) continue;
      const id = `d${d}g${glyph}`;
      css.push(`@keyframes ${id}{${visibilityKeyframes(onAt, n)}}`);
      css.push(`.${id}{animation:${id} ${dur}ms steps(1) infinite}`);
      digitEls.push(`<text class="hud digit ${id}" x="${d * 9}" y="0">${glyph}</text>`);
    }
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" width="${width}" height="${height}" role="img">
  <style><![CDATA[
${css.join("\n")}
  ]]></style>
  <g transform="translate(0 ${-SIZE_CELL + 2})">${digitEls.join("")}</g>
  ${cells.join("")}
  ${snakeEls.join("")}
</svg>
`;
}

function tokenFromEnv() {
  return process.env.GITHUB_TOKEN || process.env.GH_TOKEN || null;
}

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = process.env.OUTPUT_DIR || path.join(here, "..", "dist");
const token = tokenFromEnv();
if (!token) {
  console.error("GITHUB_TOKEN is required");
  process.exit(1);
}

const weeks = await fetchCalendar(USER, token);
const cols = weeks.length;
const counts = [];
const grid = Array.from({ length: cols }, (_, x) => {
  const col = Array.from({ length: 7 }, (_, y) => ({ count: 0, level: 0 }));
  for (const day of weeks[x].contributionDays) {
    col[day.weekday] = { count: day.contributionCount, level: 0 };
    counts.push(day.contributionCount);
  }
  return col;
});
const cuts = quartileCuts(counts);
for (const col of grid) {
  for (const cell of col) cell.level = levelFromCount(cell.count, cuts);
}

const match = simulate(grid);
if (match.frames.length < 20) {
  console.error("simulation too short", match.frames.length, match.score, match.ended);
  process.exit(1);
}

fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, "github-contribution-grid-snake.svg"), buildSvg(grid, match, "light"));
fs.writeFileSync(path.join(outDir, "github-contribution-grid-snake-dark.svg"), buildSvg(grid, match, "dark"));
console.log(
  `weeks=${cols} foods=${match.foods.length} eaten=${match.eatenAt.size} leftover=${match.leftover} ended=${match.ended} score=${match.score} frames=${match.frames.length} maxLen=${match.frames.reduce((m, f) => Math.max(m, f.snake.length), 0)}`,
);
