// Per-page analytics pop-up, loaded only inside CloudCannon's Visual Editor.
// Reads the snapshot the staging build writes to /analytics/pages.json; builds without analytics have no file, so nothing renders.

interface PageStats {
  views: number;
  users: number;
  engagementSeconds: number;
  bounceRate: number;
  daily: { date: string; views: number }[];
  sources: { name: string; value: number }[];
}

interface PagesSnapshot {
  generatedAt: string;
  source: "ga4" | "mock";
  range: { start: string; end: string; days: number };
  pages: Record<string, PageStats>;
}

const DATA_URL = "/analytics/pages.json";
const STORAGE_KEY = "cc-analytics-panel-open";

const compact = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 });
const duration = (s: number) => (s >= 60 ? `${Math.floor(s / 60)}m ${Math.round(s % 60)}s` : `${Math.round(s)}s`);
const shortDate = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString("en", { day: "numeric", month: "short", timeZone: "UTC" });

function readOpen(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function writeOpen(open: boolean) {
  try {
    localStorage.setItem(STORAGE_KEY, open ? "1" : "0");
  } catch {}
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

const STYLES = `
  :host {
    all: initial;
    position: fixed;
    left: 16px;
    bottom: 16px;
    z-index: 999990;
    font: 14px/1.4 system-ui, -apple-system, sans-serif;
    color: #111827;
    --series-1: #2a78d6;
  }
  button { font: inherit; cursor: pointer; }
  .pill {
    display: flex; align-items: center; gap: 8px;
    border: 0; border-radius: 999px; padding: 8px 14px;
    background: #034ad8; color: #fff;
    box-shadow: 0 4px 14px rgb(0 0 0 / 0.2);
  }
  .pill svg { width: 16px; height: 16px; }
  .card {
    width: min(320px, calc(100vw - 32px));
    background: #fff; border-radius: 12px; padding: 14px;
    box-shadow: 0 8px 30px rgb(0 0 0 / 0.22);
  }
  .head { display: flex; justify-content: space-between; align-items: start; gap: 8px; }
  .title { font-weight: 600; }
  .path { color: #6b7280; font-size: 12px; word-break: break-all; }
  .close { border: 0; background: none; color: #6b7280; font-size: 18px; line-height: 1; padding: 2px 4px; }
  .badge { display: inline-block; margin-left: 6px; border-radius: 999px; padding: 0 6px; font-size: 11px; background: #fef3c7; color: #78350f; vertical-align: middle; }
  .tiles { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin: 12px 0; }
  .tile { border: 1px solid #e5e7eb; border-radius: 8px; padding: 6px 8px; }
  .tile-label { font-size: 12px; color: #6b7280; }
  .tile-value { font-size: 18px; font-weight: 600; font-variant-numeric: tabular-nums; }
  .section { font-size: 12px; font-weight: 600; color: #374151; margin: 10px 0 4px; }
  .spark { position: relative; }
  .spark svg { display: block; width: 100%; height: 56px; outline: none; }
  .spark-line { fill: none; stroke: var(--series-1); stroke-width: 2; stroke-linejoin: round; }
  .spark-area { fill: var(--series-1); opacity: 0.1; }
  .spark-cross { stroke: #9ca3af; stroke-width: 1; }
  .spark-dot { fill: var(--series-1); stroke: #fff; stroke-width: 2; }
  .spark-tip { font-size: 12px; color: #374151; min-height: 1.4em; font-variant-numeric: tabular-nums; }
  ol { list-style: none; margin: 0; padding: 0; }
  li { margin: 4px 0; }
  .row { display: flex; justify-content: space-between; gap: 8px; font-size: 12px; }
  .row span:last-child { color: #4b5563; font-variant-numeric: tabular-nums; }
  .track { height: 4px; border-radius: 4px; background: #f3f4f6; margin-top: 2px; }
  .bar { height: 100%; border-radius: 4px; background: var(--series-1); }
  .foot { margin-top: 10px; display: flex; justify-content: space-between; gap: 8px; font-size: 11px; color: #6b7280; }
  .foot a { color: #034ad8; }
  .empty { color: #6b7280; margin: 12px 0 0; }
`;

const CHART_ICON =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 3v18h18"/><path d="m7 15 4-4 3 3 5-6"/></svg>';

class AnalyticsPanel extends HTMLElement {
  #root = this.attachShadow({ mode: "open" });
  #snapshot?: PagesSnapshot;
  #open = readOpen();

  set snapshot(value: PagesSnapshot) {
    this.#snapshot = value;
    this.render();
  }

  get stats(): PageStats | undefined {
    return this.#snapshot?.pages[location.pathname];
  }

  toggle(open: boolean) {
    this.#open = open;
    writeOpen(open);
    this.render();
  }

  render() {
    const snap = this.#snapshot;
    if (!snap) return;
    const style = el("style");
    style.textContent = STYLES;
    this.#root.replaceChildren(style, this.#open ? this.card(snap) : this.pill());
  }

  pill() {
    const button = el("button", "pill");
    button.innerHTML = CHART_ICON;
    const views = this.stats?.views;
    button.append(
      document.createTextNode(views === undefined ? "Analytics" : `${compact.format(views)} views`),
    );
    button.setAttribute("aria-expanded", "false");
    button.setAttribute("aria-label", "Show page analytics");
    button.addEventListener("click", () => this.toggle(true));
    return button;
  }

  card(snap: PagesSnapshot) {
    const card = el("section", "card");
    card.setAttribute("aria-label", "Page analytics");

    const head = el("div", "head");
    const titleWrap = el("div");
    const title = el("div", "title", "Page analytics");
    if (snap.source === "mock") title.append(el("span", "badge", "Mock data"));
    titleWrap.append(title, el("div", "path", `${location.pathname} · last ${snap.range.days} days`));
    const close = el("button", "close", "×");
    close.setAttribute("aria-label", "Collapse page analytics");
    close.addEventListener("click", () => this.toggle(false));
    head.append(titleWrap, close);
    card.append(head);

    const stats = this.stats;
    if (!stats) {
      card.append(el("p", "empty", `No data for this page in the last ${snap.range.days} days.`));
    } else {
      const tiles = el("div", "tiles");
      for (const [label, value] of [
        ["Page views", compact.format(stats.views)],
        ["Users", compact.format(stats.users)],
        ["Avg engagement", duration(stats.engagementSeconds)],
        ["Bounce rate", `${Math.round(stats.bounceRate * 100)}%`],
      ]) {
        const tile = el("div", "tile");
        tile.append(el("div", "tile-label", label), el("div", "tile-value", value));
        tiles.append(tile);
      }
      card.append(tiles, el("div", "section", "Page views per day"), this.sparkline(stats.daily));

      if (stats.sources.length) {
        card.append(el("div", "section", "Top sources"));
        const list = el("ol");
        const max = Math.max(1, ...stats.sources.map((s) => s.value));
        for (const source of stats.sources) {
          const item = el("li");
          const row = el("div", "row");
          row.append(el("span", undefined, source.name), el("span", undefined, compact.format(source.value)));
          const track = el("div", "track");
          const bar = el("div", "bar");
          bar.style.width = `${(source.value / max) * 100}%`;
          track.append(bar);
          item.append(row, track);
          list.append(item);
        }
        card.append(list);
      }
    }

    const foot = el("div", "foot");
    foot.append(el("span", undefined, `Snapshot ${new Date(snap.generatedAt).toLocaleDateString("en")}`));
    const link = el("a", undefined, "Full dashboard");
    link.href = "/analytics/";
    foot.append(link);
    card.append(foot);
    return card;
  }

  sparkline(daily: PageStats["daily"]) {
    const W = 290, H = 56, pad = 4;
    const max = Math.max(1, ...daily.map((d) => d.views));
    const pts = daily.map((d, i) => [
      pad + (i * (W - pad * 2)) / Math.max(1, daily.length - 1),
      pad + (1 - d.views / max) * (H - pad * 2),
    ]);
    const line = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join("");
    const area = `${line}L${pts[pts.length - 1][0]},${H - pad}L${pts[0][0]},${H - pad}Z`;

    const wrap = el("div", "spark");
    const ns = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(ns, "svg");
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    svg.setAttribute("preserveAspectRatio", "none");
    svg.setAttribute("tabindex", "0");
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", `Page views per day, peaking at ${max}`);
    const make = (tag: string, attrs: Record<string, string>) => {
      const node = document.createElementNS(ns, tag);
      for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
      svg.append(node);
      return node;
    };
    make("path", { d: area, class: "spark-area" });
    make("path", { d: line, class: "spark-line", "vector-effect": "non-scaling-stroke" });
    const cross = make("line", { class: "spark-cross", y1: "0", y2: String(H), visibility: "hidden", "vector-effect": "non-scaling-stroke" });
    const dot = make("circle", { class: "spark-dot", r: "3", visibility: "hidden" });

    const tip = el("div", "spark-tip", `Peak ${max.toLocaleString("en")} · hover for a day`);
    let index = -1;
    const show = (i: number) => {
      index = Math.max(0, Math.min(daily.length - 1, i));
      const [x, y] = pts[index];
      cross.setAttribute("x1", String(x));
      cross.setAttribute("x2", String(x));
      dot.setAttribute("cx", String(x));
      dot.setAttribute("cy", String(y));
      cross.setAttribute("visibility", "visible");
      dot.setAttribute("visibility", "visible");
      tip.textContent = `${daily[index].views.toLocaleString("en")} views · ${shortDate(daily[index].date)}`;
    };
    svg.addEventListener("pointermove", (event) => {
      const box = svg.getBoundingClientRect();
      show(Math.round(((event.clientX - box.left) / box.width) * (daily.length - 1)));
    });
    svg.addEventListener("keydown", (event) => {
      if (event.key === "ArrowRight") show(index + 1);
      else if (event.key === "ArrowLeft") show(index < 0 ? daily.length - 1 : index - 1);
    });

    wrap.append(svg, tip);
    return wrap;
  }
}

async function mount() {
  if (location.pathname.startsWith("/analytics/") || document.querySelector("cc-analytics-panel")) return;

  let snapshot: PagesSnapshot;
  try {
    const res = await fetch(DATA_URL, { cache: "no-store" });
    if (!res.ok) {
      console.info(`[analytics] ${DATA_URL} returned ${res.status}; this build has no analytics`);
      return;
    }
    snapshot = await res.json();
  } catch (error) {
    console.info("[analytics] No analytics snapshot available", error);
    return;
  }

  if (!customElements.get("cc-analytics-panel")) customElements.define("cc-analytics-panel", AnalyticsPanel);
  const panel = document.createElement("cc-analytics-panel") as AnalyticsPanel;
  document.body.append(panel);
  panel.snapshot = snapshot;
}

mount();
