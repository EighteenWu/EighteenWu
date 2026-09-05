#!/usr/bin/env node
/**
 * Contribution-graph snake: same look as Platane/snk,
 * but the snake grows when it eats a green day and a score ticks up.
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

function key(x, y) {
  return `${x},${y}`;
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

function nearestFood(head, foods, blocked, cols, rows) {
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
  let score = 0;
  const frames = [];
  const eatenAt = new Map();
  let guard = 0;
  const limit = cols * rows * 8;

  const snapshot = (justAte = false) => {
    frames.push({
      snake: snake.map((p) => ({ ...p })),
      score,
      length: snake.length,
      justAte,
    });
  };

  snapshot();

  while (remaining.size && guard++ < limit) {
    const head = snake[0];
    const tail = snake[snake.length - 1];
    const blocked = new Set(snake.map((p) => key(p.x, p.y)));
    blocked.delete(key(tail.x, tail.y));

    const foodList = [...remaining.values()];
    let path = nearestFood(head, foodList, blocked, cols, rows);
    if (!path) {
      const toTail = bfs(head, tail, blocked, cols, rows);
      path = toTail && toTail.length ? toTail : null;
    }
    const step = path && path.length ? path[0] : anySafe(head, blocked, cols, rows);
    if (!step) break;

    const ate = remaining.get(key(step.x, step.y));
    snake = [step, ...snake];
    if (ate) {
      remaining.delete(key(step.x, step.y));
      score += ate.count;
      eatenAt.set(key(step.x, step.y), frames.length);
      if (snake.length > MAX_LEN) snake.pop();
    } else {
      snake.pop();
    }
    snapshot(Boolean(ate));
  }

  return { frames, eatenAt, score };
}

function lerpSize(i) {
  return i === 0 ? SIZE_CELL * 0.92 : SIZE_DOT;
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

function buildSvg(grid, match, theme) {
  const pal = PALETTES[theme];
  const cols = grid.length;
  const rows = 7;
  const { frames, eatenAt } = match;
  const n = frames.length;
  const dur = n * STEP_MS;
  const maxLen = frames.reduce((m, f) => Math.max(m, f.snake.length), 0);

  const width = (cols + 2) * SIZE_CELL;
  const height = (rows + 3) * SIZE_CELL;
  const viewBox = `${-SIZE_CELL} ${-SIZE_CELL * 1.5} ${width} ${height}`;
  const m = (SIZE_CELL - SIZE_DOT) / 2;

  const css = [];
  css.push(`:root{--cb:${pal.border};--cs:${pal.snake};--ce:${pal.empty};${pal.dots.map((c, i) => `--c${i}:${c}`).join(";")}}`);
  css.push(`.c{shape-rendering:geometricPrecision;fill:var(--ce);stroke-width:1px;stroke:var(--cb);width:${SIZE_DOT}px;height:${SIZE_DOT}px}`);
  css.push(`.s{shape-rendering:geometricPrecision;fill:var(--cs);animation:none linear ${dur}ms infinite;transform-box:view-box;transform-origin:0 0}`);
  css.push(`.hud{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif;font-size:13px;font-variant-numeric:tabular-nums;fill:${pal.text}}`);
  css.push(`.digit{opacity:0}`);

  const cells = [];
  for (let x = 0; x < cols; x++) {
    for (let y = 0; y < rows; y++) {
      const cell = grid[x][y];
      const eatFrame = eatenAt.get(key(x, y));
      const id = eatFrame != null ? `c${x}x${y}` : "";
      if (eatFrame != null) {
        const t = eatFrame / n;
        css.push(`@keyframes ${id}{0%{fill:var(--c${cell.level})} ${((t - 0.0005) * 100).toFixed(3)}%{fill:var(--c${cell.level})} ${((t + 0.0005) * 100).toFixed(3)}%{fill:var(--ce)} 100%{fill:var(--ce)}}`);
        css.push(`.${id}{fill:var(--c${cell.level});animation:${id} ${dur}ms linear infinite}`);
      } else if (cell.level > 0) {
        css.push(`.k${x}x${y}{fill:var(--c${cell.level})}`);
      }
      const cls = ["c", id || (cell.level > 0 ? `k${x}x${y}` : "")].filter(Boolean).join(" ");
      cells.push(
        `<rect class="${cls}" x="${x * SIZE_CELL + m}" y="${y * SIZE_CELL + m}" rx="${DOT_R}" ry="${DOT_R}"/>`,
      );
    }
  }

  const snakeEls = [];
  for (let s = 0; s < maxLen; s++) {
    const size = lerpSize(s);
    const pad = (SIZE_CELL - size) / 2;
    const rr = s === 0 ? 4.5 : DOT_R;
    const pts = frames.map((f) => f.snake[s] || null);
    const firstPos = pts.find(Boolean) || { x: 0, y: 0 };
    const kf = [];
    for (let i = 0; i < n; i++) {
      const p = pts[i] || firstPos;
      const on = Boolean(pts[i]);
      const pct = ((i / n) * 100).toFixed(3);
      kf.push(
        `${pct}%{transform:translate(${p.x * SIZE_CELL}px,${p.y * SIZE_CELL}px);opacity:${on ? 1 : 0}}`,
      );
    }
    kf.push(
      `100%{transform:translate(${(pts[0] || firstPos).x * SIZE_CELL}px,${(pts[0] || firstPos).y * SIZE_CELL}px);opacity:${pts[0] ? 1 : 0}}`,
    );
    const compact = [];
    for (let i = 0; i < kf.length; i++) {
      if (i === 0 || i === kf.length - 1 || kf[i].replace(/^[0-9.]+%/, "") !== kf[i - 1].replace(/^[0-9.]+%/, "")) {
        compact.push(kf[i]);
      }
    }
    css.push(`@keyframes s${s}{${compact.join("")}}`);
    css.push(`.s${s}{animation:s${s} ${dur}ms linear infinite}`);
    snakeEls.push(
      `<rect class="s s${s}" x="${pad.toFixed(1)}" y="${pad.toFixed(1)}" width="${size.toFixed(1)}" height="${size.toFixed(1)}" rx="${rr.toFixed(1)}" ry="${rr.toFixed(1)}"/>`,
    );
  }

  const maxScore = frames[frames.length - 1].score;
  const digits = Math.max(3, String(maxScore).length);
  const digitEls = [];
  for (let d = 0; d < digits; d++) {
    const place = 10 ** (digits - 1 - d);
    for (let glyph = 0; glyph < 10; glyph++) {
      const onAt = frames.map((f) => Math.floor(f.score / place) % 10 === glyph);
      if (!onAt.some(Boolean)) continue;
      const id = `d${d}g${glyph}`;
      css.push(`@keyframes ${id}{${visibilityKeyframes(onAt, n)}}`);
      css.push(`.${id}{animation:${id} ${dur}ms steps(1) infinite}`);
      digitEls.push(
        `<text class="hud digit ${id}" x="${d * 9}" y="0">${glyph}</text>`,
      );
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
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN;
  if (process.env.GH_TOKEN) return process.env.GH_TOKEN;
  return null;
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
  console.error("simulation too short", match.frames.length, match.score);
  process.exit(1);
}

fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, "github-contribution-grid-snake.svg"), buildSvg(grid, match, "light"));
fs.writeFileSync(path.join(outDir, "github-contribution-grid-snake-dark.svg"), buildSvg(grid, match, "dark"));
console.log(
  `weeks=${cols} foods=${match.eatenAt.size} score=${match.score} frames=${match.frames.length} maxLen=${match.frames.reduce((m, f) => Math.max(m, f.snake.length), 0)}`,
);
