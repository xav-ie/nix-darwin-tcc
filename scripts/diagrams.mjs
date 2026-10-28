#!/usr/bin/env node
// Generates the docs' diagrams from one source of colors, assets/palette.json (a
// light and a dark theme). It writes docs/diagrams/<name>.svg (light) and
// <name>-dark.svg, and fills the marked blocks in README.md:
//   <!-- diagram:NAME --> … <!-- /diagram:NAME -->  a <picture> with the diagram and its alt text
// Every diagram is built from the same primitives and themed through CSS classes,
// so each body is written once. Run: node scripts/diagrams.mjs (in `nix develop ./dev`)
// `nix flake check ./dev` runs it too and fails if anything it writes differs from
// what's committed.
import {
  mkdirSync,
  readdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => readFileSync(path.join(root, file), "utf8");
const write = (file, text) => writeFileSync(path.join(root, file), text);
const palette = JSON.parse(read("assets/palette.json"));
const DIR = "docs/diagrams";
const DOCS = ["README.md"];

// --- primitives -------------------------------------------------------------------
const W = 1062;
const M = 24;
const SIZE = { head: 19, title: 16, sub: 13.5, label: 13, code: 12.5 };
const FONT = `-apple-system, 'Segoe UI', Helvetica, Arial, sans-serif`;
const MONO = `ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`;

const esc = (s) =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const n = (v) => Math.round(v * 10) / 10;
// Deterministic text width estimates, so layout needs no browser.
const textWidth = (s, size) => s.length * size * 0.54;
// Greedy word wrap to a pixel width.
const wrap = (s, size, width) =>
  s.split(" ").reduce(
    (out, word) => {
      const last = out.at(-1);
      if (last && textWidth(`${last} ${word}`, size) > width) out.push(word);
      else out[out.length - 1] = last ? `${last} ${word}` : word;
      return out;
    },
    [""],
  );

// Themes apply through CSS classes, so every diagram body is written once.
// `live` (green) is the module doing its job; `alt` (teal) a second kind of
// grant; `warn` (amber) what goes wrong without it.
const style = (c) => `<style>
  text { font-family: ${FONT}; fill: ${c.text}; }
  .bg { fill: ${c.bg}; }
  .box { fill: ${c.surface}; stroke: ${c.line}; stroke-width: 2; }
  .key { fill: ${c.live}; fill-opacity: .09; stroke: ${c.live}; stroke-width: 2.5; }
  .alt { fill: ${c.alt}; fill-opacity: .08; stroke: ${c.alt}; stroke-width: 2.5; }
  .warn { fill: ${c.warn}; fill-opacity: .08; stroke: ${c.warn}; stroke-width: 2; stroke-dasharray: 7 6; }
  .head { font-size: ${SIZE.head}px; font-weight: 700; }
  .lede { font-size: ${SIZE.sub + 1}px; fill: ${c.muted}; }
  .title { font-size: ${SIZE.title}px; font-weight: 650; }
  .sub { font-size: ${SIZE.sub}px; fill: ${c.muted}; }
  .field { font-size: ${SIZE.sub}px; font-weight: 650; fill: ${c.text}; }
  .code { font-family: ${MONO}; font-size: ${SIZE.code}px; fill: ${c.text}; }
  .code-bg { fill: ${c.bg}; stroke: ${c.line}; stroke-width: 1; }
  .label { font-size: ${SIZE.label}px; font-weight: 600; fill: ${c.text}; }
  .edge { fill: none; stroke: ${c.border}; stroke-width: 2; marker-end: url(#arrow); }
  .tag { fill: ${c.bg}; }
  .arrowhead { fill: ${c.border}; }
  .badge { fill: ${c.live}; }
  .badge-text { font-size: 12px; font-weight: 700; fill: ${c.bg}; }
  .dot { fill: ${c.muted}; }
  .ink { fill: none; stroke: ${c.text}; stroke-width: 2.4; stroke-linecap: round; stroke-linejoin: round; }
  .ink-key { fill: none; stroke: ${c.live}; stroke-width: 2.4; stroke-linecap: round; stroke-linejoin: round; }
  .ink-alt { fill: none; stroke: ${c.alt}; stroke-width: 2.4; stroke-linecap: round; stroke-linejoin: round; }
  .ink-warn { fill: none; stroke: ${c.warn}; stroke-width: 2.4; stroke-linecap: round; stroke-linejoin: round; }
</style>`;

const marker = (id, cls) =>
  `<marker id="${id}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path class="${cls}" d="M0 0L10 5L0 10z"/></marker>`;
const svg = (h, body) =>
  ["light", "dark"].map(
    (theme) =>
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${n(h)}" width="${W}" height="${n(h)}" role="img">` +
      `${style(palette[theme])}<defs>${marker("arrow", "arrowhead")}</defs>` +
      `<rect class="bg" width="${W}" height="${n(h)}" rx="16"/>${body}</svg>\n`,
  );

const text = (cls, x, y, s, anchor = "start") =>
  `<text class="${cls}" x="${n(x)}" y="${n(y)}"${anchor === "start" ? "" : ` text-anchor="${anchor}"`}>${esc(s)}</text>`;
const rect = (cls, x, y, w, h, r) =>
  `<rect class="${cls}" x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" rx="${r}"/>`;

// The takeaway, said before the picture: a headline and one line under it.
// Returns the body and where the picture can start.
const headline = (head, lede) => ({
  body: text("head", M, 36, head) + (lede ? text("lede", M, 60, lede) : ""),
  top: lede ? 92 : 68,
});

// Glyphs, drawn in a 48×48 square centered on (x, y), so a box can show what it is.
const GLYPHS = {
  file: "M-14 -20h18l10 10v30h-28zM4 -20v10h10M-5 2l-5 5l5 5M5 2l5 5l-5 5",
  terminal:
    "M-22 -16h44a3 3 0 0 1 3 3v26a3 3 0 0 1 -3 3h-44a3 3 0 0 1 -3 -3v-26a3 3 0 0 1 3 -3zM-14 -6l7 6l-7 6M-2 8h12",
  db: "M-16 -14a16 6 0 1 0 32 0a16 6 0 1 0 -32 0zM-16 -14v28a16 6 0 0 0 32 0v-28M-16 0a16 6 0 0 0 32 0",
  shield: "M0 -21l17 6v10c0 12 -8 20 -17 24c-9 -4 -17 -12 -17 -24v-10zM-7 0l5 5l10 -10",
  tag: "M-20 -20h16l22 22l-16 16l-22 -22zM-11 -11a3 3 0 1 0 0.1 0",
  seal: "M-12 -9a12 12 0 1 0 24 0a12 12 0 1 0 -24 0zM-5 -9l3.5 3.5l7 -7M-9 1l-4 19l13 -6l13 6l-4 -19",
  hash: "M-6 -20l-5 40M8 -20l-5 40M-17 -7h36M-19 7h36",
  restart: "M15 -10a17 17 0 1 0 2 12M15 -22v12h-12",
  alert: "M0 -20l20 36h-40zM0 -6v9M0 9v0.5",
};
const glyph = (name, x, y, kind = "box") =>
  `<path class="${{ key: "ink-key", alt: "ink-alt", warn: "ink-warn" }[kind] ?? "ink"}" transform="translate(${n(x)} ${n(y)})" d="${GLYPHS[name]}"/>`;

// A box with an optional glyph on top, a title and wrapped subtitles under it,
// all centered. kind is box (plain), key (green), alt (teal) or warn (amber).
const box = ({ x, y, w, h, icon, text: [title, ...subs], kind = "box" }) => {
  const subLines = subs.flatMap((s) => wrap(s, SIZE.sub, w - 28));
  const height =
    (icon ? 58 : 0) + SIZE.title * 1.35 + subLines.length * SIZE.sub * 1.35;
  let top = y + (h - height) / 2;
  let out = rect(kind, x, y, w, h, 14);
  if (icon) {
    out += glyph(icon, x + w / 2, top + 24, kind);
    top += 58;
  }
  out += text("title", x + w / 2, top + SIZE.title, title, "middle");
  top += SIZE.title * 1.35;
  return (
    out +
    subLines
      .map((s, i) =>
        text("sub", x + w / 2, top + SIZE.sub * (i + 1) * 1.35 - 4, s, "middle"),
      )
      .join("")
  );
};

// A box with a glyph and title on top and a bulleted list under them.
const ITEM = 24;
const listBox = ({ x, y, w, h, icon, title, items, kind = "box" }) => {
  const height = 58 + SIZE.title * 1.35 + 8 + items.length * ITEM;
  const top = y + (h - height) / 2;
  const left = x + w / 2 - 62;
  return (
    rect(kind, x, y, w, h, 14) +
    glyph(icon, x + w / 2, top + 24, kind) +
    text("title", x + w / 2, top + 58 + SIZE.title, title, "middle") +
    items
      .map((s, i) => {
        const yy = top + 58 + SIZE.title * 1.35 + 8 + i * ITEM + 16;
        return (
          `<circle class="dot" cx="${n(left - 10)}" cy="${n(yy - 4.5)}" r="2.5"/>` +
          text("sub", left, yy, s)
        );
      })
      .join("")
  );
};

// A card for comparing options: glyph and title, the setting as code, then
// labeled rows ([field, text]) left-aligned under it.
const card = ({ x, y, w, h, icon, title, code, rows, kind = "box" }) => {
  const pad = 22;
  let top = y + 26;
  let out = rect(kind, x, y, w, h, 14) + glyph(icon, x + w / 2, top + 22, kind);
  top += 62;
  out += text("title", x + w / 2, top, title, "middle");
  top += 16;
  const cw = textWidth(code, SIZE.code) + 22;
  out +=
    rect("code-bg", x + (w - cw) / 2, top, cw, 26, 6) +
    text("code", x + w / 2, top + 17.5, code, "middle");
  top += 50;
  for (const [field, s] of rows) {
    out += text("field", x + pad, top, field);
    wrap(s, SIZE.sub, w - 2 * pad).forEach((line) => {
      top += SIZE.sub * 1.4;
      out += text("sub", x + pad, top, line);
    });
    top += 26;
  }
  return out;
};

// A label on a line, over a background so the line doesn't run through it. A
// label can be a step, [number, text], shown with a numbered badge.
const label = (x, y, l) => {
  const [step, s] = Array.isArray(l) ? l : [null, l];
  const badge = step ? 24 : 0;
  const w = textWidth(s, SIZE.label) + 14 + badge;
  const left = x - w / 2;
  return (
    rect("tag", left, y - 12, w, 22, 6) +
    (step
      ? `<circle class="badge" cx="${n(left + 13)}" cy="${n(y - 1)}" r="9.5"/>` +
        text("badge-text", left + 13, y + 3.5, step, "middle")
      : "") +
    text("label", left + badge + 7, y + 3.5, s)
  );
};

const arrow = (points) =>
  `<path class="edge" d="M${points.map(([x, y]) => `${n(x)} ${n(y)}`).join("L")}"/>`;

// --- layout ---------------------------------------------------------------------------
// A grid of equal columns: cell(col, row) is a box's position, spanning `span` columns
// or `rows` rows.
const grid = ({ cols, gapX, rowH, gapY = 0, top, left = M, width = W - 2 * M }) => {
  const colW = (width - gapX * (cols - 1)) / cols;
  return (col, row = 0, { span = 1, rows = 1 } = {}) => ({
    x: left + col * (colW + gapX),
    y: top + row * (rowH + gapY),
    w: colW * span + gapX * (span - 1),
    h: rowH * rows + gapY * (rows - 1),
  });
};

// An arrow between two boxes side by side, at the middle of their shared height,
// with an optional label above it.
const link = (a, b, { label: tag } = {}) => {
  const top = Math.max(a.y, b.y),
    bottom = Math.min(a.y + a.h, b.y + b.h);
  const y = (top + bottom) / 2;
  const x1 = a.x + a.w,
    x2 = b.x;
  return (
    arrow([
      [x1, y],
      [x2, y],
    ]) + (tag ? label((x1 + x2) / 2, y - 16, tag) : "")
  );
};

// An arrow from the middle of a's right edge to the middle of b's left edge,
// bending once halfway, for a fan-out or fan-in between rows of different heights.
const elbow = (a, b) => {
  const x1 = a.x + a.w,
    y1 = a.y + a.h / 2,
    x2 = b.x,
    y2 = b.y + b.h / 2,
    mid = (x1 + x2) / 2;
  return arrow([
    [x1, y1],
    [mid, y1],
    [mid, y2],
    [x2, y2],
  ]);
};

// --- diagrams ------------------------------------------------------------------------
// Each returns { h, body, alt }.
const diagrams = {
  // The whole idea: config in, granted apps out.
  "what-it-does"() {
    const h = headline(
      "Privacy permissions, declared in your nix-darwin config",
      "each rebuild writes your grants into macOS's permission databases, so apps are allowed without clicking through System Settings",
    );
    const cell = grid({ cols: 4, gapX: 64, rowH: 162, gapY: 18, top: h.top });
    const config = {
      ...cell(0, 0, { rows: 2 }),
      icon: "file",
      text: ["Your config", "security.tcc.apps: apps and their permissions"],
    };
    const rebuild = {
      ...cell(1, 0, { rows: 2 }),
      icon: "terminal",
      text: ["darwin-rebuild switch", "writes the grants, then reloads tccd"],
    };
    const system = {
      ...cell(2, 0),
      icon: "db",
      title: "System database",
      items: ["Accessibility", "Screen recording", "Full Disk Access"],
    };
    const user = {
      ...cell(2, 1),
      icon: "db",
      title: "Your user's database",
      items: ["Camera", "Microphone", "Contacts"],
    };
    const apps = {
      ...cell(3, 0, { rows: 2 }),
      icon: "shield",
      kind: "key",
      text: ["Apps are allowed", "no prompts, no clicking"],
    };
    return {
      h: apps.y + apps.h + 24,
      body:
        h.body +
        [config, rebuild, apps].map(box).join("") +
        [system, user].map(listBox).join("") +
        link(config, rebuild) +
        elbow(rebuild, system) +
        elbow(rebuild, user) +
        elbow(system, apps) +
        elbow(user, apps),
      alt: "Privacy permissions, declared in your nix-darwin config. Your config's security.tcc.apps lists apps and their permissions. darwin-rebuild switch writes the grants into macOS's permission databases, then reloads tccd: the system database for Accessibility, Screen recording and Full Disk Access, and your user's database for Camera, Microphone and Contacts. Apps are allowed with no prompts and no System Settings clicks",
    };
  },

  // The three ways a grant can identify its app, and when to use each.
  pinning() {
    const h = headline(
      "Choose how a grant recognizes its app",
      "a grant can match an app by its bundle id alone, by the certificate it's signed with, or by its exact build",
    );
    const cell = grid({ cols: 3, gapX: 24, rowH: 296, top: h.top });
    const cards = [
      {
        ...cell(0),
        icon: "tag",
        title: "Bundle id only",
        code: "no appPath",
        rows: [
          ["Matches", "any app with that bundle id"],
          ["Use for", "apps as their developer signed them"],
          ["Survives", "everything; nothing to re-pin"],
        ],
      },
      {
        ...cell(1),
        icon: "seal",
        kind: "alt",
        title: "Signing certificate",
        code: 'pin = "designated";',
        rows: [
          ["Matches", "builds from the same certificate"],
          ["Use for", "apps you modify and re-sign"],
          ["Survives", "app updates and re-signs"],
        ],
      },
      {
        ...cell(2),
        icon: "hash",
        kind: "key",
        title: "Exact build",
        code: 'pin = "cdhash";',
        rows: [
          ["Matches", "this exact build and nothing else"],
          ["Use for", "ad-hoc signed builds from Nix"],
          ["Survives", "nothing; re-pinned on every rebuild"],
        ],
      },
    ];
    return {
      h: cards[0].y + cards[0].h + 24,
      body: h.body + cards.map(card).join(""),
      alt: 'Choose how a grant recognizes its app. Bundle id only, with no appPath, matches any app with that bundle id: use it for apps as their developer signed them; it survives everything. pin = "designated" matches builds signed with the same certificate: use it for apps you modify and re-sign; it survives app updates and re-signs. pin = "cdhash" matches one exact build: use it for ad-hoc signed builds from Nix; it is re-pinned on every rebuild',
    };
  },

  // Why build-pinned grants go first: a rebuilt daemon must start already allowed.
  "activation-order"() {
    const h = headline(
      "Rebuilt daemons start already allowed",
      "build-pinned grants are written before launchd restarts anything; the rest after your apps are re-signed",
    );
    const cell = grid({ cols: 3, gapX: 90, rowH: 160, gapY: 34, top: h.top });
    const pre = {
      ...cell(0),
      icon: "hash",
      kind: "key",
      text: ["preActivation", 'writes pin = "cdhash" grants for the new builds, reloads tccd'],
    };
    const launchd = {
      ...cell(1),
      icon: "restart",
      text: ["launchd", "restarts changed daemons; their grants are ready"],
    };
    const post = {
      ...cell(2),
      icon: "seal",
      kind: "alt",
      text: ["postActivation", "writes bundle-id and designated grants after any re-signing"],
    };
    const warn = {
      ...cell(0, 1, { span: 3 }),
      h: 74,
    };
    const warnText = [
      text("title", warn.x + 70, warn.y + 32, "If build-pinned grants waited until postActivation"),
      text(
        "sub",
        warn.x + 70,
        warn.y + 54,
        "a rebuilt daemon would start against its previous build's grant, and macOS would ask “would like to control this computer?”",
      ),
    ].join("");
    return {
      h: warn.y + warn.h + 24,
      body:
        h.body +
        [pre, launchd, post].map(box).join("") +
        link(pre, launchd, { label: ["1", "then"] }) +
        link(launchd, post, { label: ["2", "then"] }) +
        rect("warn", warn.x, warn.y, warn.w, warn.h, 14) +
        glyph("alert", warn.x + 38, warn.y + warn.h / 2 + 2, "warn") +
        warnText,
      alt: 'Rebuilt daemons start already allowed. First, preActivation writes the pin = "cdhash" grants for the new builds and reloads tccd. Then launchd restarts changed agents and daemons, whose grants are already in place. Then postActivation writes the bundle-id and designated grants, after any re-signing. If build-pinned grants waited until postActivation, a rebuilt daemon would start against its previous build\'s grant and macOS would ask whether it may control this computer',
    };
  },
};

// --- write ---------------------------------------------------------------------------
mkdirSync(path.join(root, DIR), { recursive: true });
// Only what this script writes lives in DIR: a diagram removed here disappears there too.
for (const f of readdirSync(path.join(root, DIR)))
  if (
    !Object.keys(diagrams).some(
      (name) => f === `${name}.svg` || f === `${name}-dark.svg`,
    )
  )
    unlinkSync(path.join(root, DIR, f));
const built = Object.fromEntries(
  Object.entries(diagrams).map(([name, make]) => {
    const d = make();
    const [light, dark] = svg(d.h, d.body);
    write(`${DIR}/${name}.svg`, light);
    write(`${DIR}/${name}-dark.svg`, dark);
    return [name, d];
  }),
);

// Fills every marked block in a doc, outside code fences (so docs can show the
// markers themselves); unknown names fail loudly.
const fill = (file) => {
  const rel = path.relative(path.dirname(file), DIR);
  const block = (_, name) => {
    if (!built[name]) throw new Error(`${file}: no diagram ${name}`);
    const alt = esc(built[name].alt).replace(/"/g, "&quot;");
    return `<!-- diagram:${name} -->\n<picture>\n  <source media="(prefers-color-scheme: dark)" srcset="${rel}/${name}-dark.svg">\n  <img src="${rel}/${name}.svg" alt="${alt}">\n</picture>\n<!-- /diagram:${name} -->`;
  };
  const src = read(file)
    .split(/(^[ \t]*```[\s\S]*?^[ \t]*```)/m)
    .map((part, i) =>
      i % 2
        ? part
        : part.replace(
            /<!-- diagram:([\w-]+) -->[\s\S]*?<!-- \/diagram:\1 -->/g,
            block,
          ),
    )
    .join("");
  write(file, src);
};
DOCS.forEach(fill);

console.log(`Wrote ${Object.keys(built).length} diagrams and filled the docs`);
