import { ANALYTICS_ENABLED, getSecret } from "astro:env/server";
import { getCollection } from "astro:content";

const RANGE_DAYS = 28;

export interface DailyPoint {
  date: string; // YYYY-MM-DD
  views: number;
}

export interface NamedValue {
  name: string;
  value: number;
}

export interface PageStats {
  views: number;
  users: number;
  engagementSeconds: number; // average per active user
  bounceRate: number; // 0–1
  daily: DailyPoint[];
  sources: NamedValue[];
}

export interface AnalyticsReport {
  generatedAt: string;
  source: "ga4" | "mock";
  range: { start: string; end: string; days: number };
  totals: { users: number; sessions: number; views: number; engagementSeconds: number };
  daily: (DailyPoint & { users: number })[];
  pages: Record<string, PageStats>;
  channels: NamedValue[];
  devices: NamedValue[];
}

export function isAnalyticsEnabled(): boolean {
  return ANALYTICS_ENABLED === true;
}

let reportPromise: Promise<AnalyticsReport> | undefined;

// Memoised so the dashboard page and the JSON endpoint share one fetch per build.
export function getAnalyticsReport(): Promise<AnalyticsReport> {
  reportPromise ??= buildReport();
  return reportPromise;
}

async function buildReport(): Promise<AnalyticsReport> {
  const propertyId = getSecret("GA_PROPERTY_ID");
  const credentials = getSecret("GA_CREDENTIALS");
  if (propertyId && credentials) {
    return fetchGa4Report(propertyId, parseCredentials(credentials));
  }
  console.warn("[analytics] GA_PROPERTY_ID or GA_CREDENTIALS not set, using mock data");
  return buildMockReport();
}

// Paths match location.pathname in the built site: leading and trailing slash, no query.
export function normalisePath(path: string): string {
  let p = path.split(/[?#]/)[0] || "/";
  if (!p.startsWith("/")) p = `/${p}`;
  const last = p.split("/").pop() ?? "";
  if (!p.endsWith("/") && !last.includes(".")) p = `${p}/`;
  return p;
}

function dateRange() {
  const end = new Date();
  end.setUTCDate(end.getUTCDate() - 1);
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - (RANGE_DAYS - 1));
  const days: string[] = [];
  for (const d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    days.push(d.toISOString().slice(0, 10));
  }
  return { start: days[0], end: days[days.length - 1], days };
}

function parseCredentials(raw: string): { client_email: string; private_key: string } {
  const json = raw.trim().startsWith("{") ? raw : Buffer.from(raw, "base64").toString("utf8");
  const parsed = JSON.parse(json);
  return { client_email: parsed.client_email, private_key: parsed.private_key };
}

function topN(map: Map<string, number>, n: number): NamedValue[] {
  return [...map.entries()]
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value)
    .slice(0, n);
}

async function fetchGa4Report(
  propertyId: string,
  credentials: { client_email: string; private_key: string },
): Promise<AnalyticsReport> {
  const { BetaAnalyticsDataClient } = await import("@google-analytics/data");
  const client = new BetaAnalyticsDataClient({ credentials });
  const range = dateRange();
  const property = `properties/${propertyId}`;
  const dateRanges = [{ startDate: range.start, endDate: range.end }];

  const run = async (dimensions: string[], metrics: string[], extra: Record<string, unknown> = {}) => {
    const [res] = await client.runReport({
      property,
      dateRanges,
      dimensions: dimensions.map((name) => ({ name })),
      metrics: metrics.map((name) => ({ name })),
      limit: 10000,
      ...extra,
    });
    return res;
  };
  const rowsOf = (res: Awaited<ReturnType<typeof run>>) =>
    (res.rows ?? []).map((row) => ({
      dims: (row.dimensionValues ?? []).map((v) => v.value ?? ""),
      mets: (row.metricValues ?? []).map((v) => Number(v.value ?? 0)),
    }));
  const isoDate = (d: string) => `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;

  const [siteDaily, pageTotals, pageDaily, pageSources, channels, devices] = await Promise.all([
    run(["date"], ["activeUsers", "sessions", "screenPageViews", "userEngagementDuration"], {
      metricAggregations: ["TOTAL"],
    }),
    run(["pagePath"], ["screenPageViews", "activeUsers", "userEngagementDuration", "bounceRate"]),
    run(["pagePath", "date"], ["screenPageViews"], { limit: 100000 }),
    run(["pagePath", "sessionSource"], ["screenPageViews"], { limit: 100000 }),
    run(["sessionDefaultChannelGroup"], ["sessions"]),
    run(["deviceCategory"], ["activeUsers"]),
  ]);

  const dailyByDate = new Map(rowsOf(siteDaily).map((r) => [isoDate(r.dims[0]), r]));
  const daily = range.days.map((date) => {
    const r = dailyByDate.get(date);
    return { date, users: r?.mets[0] ?? 0, views: r?.mets[2] ?? 0 };
  });
  // The TOTAL row de-duplicates users across days; summing daily rows would not.
  const totalsRow = (siteDaily.totals?.[0]?.metricValues ?? []).map((v) => Number(v.value ?? 0));
  const [users = 0, sessions = 0, views = 0, engagement = 0] = totalsRow;

  // GA can report /about and /about/ separately; they merge into one built path.
  const acc = new Map<
    string,
    { views: number; users: number; engagement: number; bounced: number; daily: Map<string, number>; sources: Map<string, number> }
  >();
  const entry = (path: string) => {
    const key = normalisePath(path);
    let e = acc.get(key);
    if (!e) {
      e = { views: 0, users: 0, engagement: 0, bounced: 0, daily: new Map(), sources: new Map() };
      acc.set(key, e);
    }
    return e;
  };
  for (const r of rowsOf(pageTotals)) {
    const e = entry(r.dims[0]);
    const [v, u, eng, bounce] = r.mets;
    e.views += v;
    e.users += u;
    e.engagement += eng;
    e.bounced += bounce * v;
  }
  for (const r of rowsOf(pageDaily)) {
    const e = entry(r.dims[0]);
    const date = isoDate(r.dims[1]);
    e.daily.set(date, (e.daily.get(date) ?? 0) + r.mets[0]);
  }
  for (const r of rowsOf(pageSources)) {
    const e = entry(r.dims[0]);
    e.sources.set(r.dims[1], (e.sources.get(r.dims[1]) ?? 0) + r.mets[0]);
  }

  const pages: Record<string, PageStats> = {};
  for (const [path, e] of acc) {
    pages[path] = {
      views: e.views,
      users: e.users,
      engagementSeconds: e.users ? e.engagement / e.users : 0,
      bounceRate: e.views ? e.bounced / e.views : 0,
      daily: range.days.map((date) => ({ date, views: e.daily.get(date) ?? 0 })),
      sources: topN(e.sources, 5),
    };
  }

  const toMap = (res: Awaited<ReturnType<typeof run>>) =>
    new Map(rowsOf(res).map((r) => [r.dims[0], r.mets[0]] as [string, number]));

  return {
    generatedAt: new Date().toISOString(),
    source: "ga4",
    range: { start: range.start, end: range.end, days: RANGE_DAYS },
    totals: { users, sessions, views, engagementSeconds: users ? engagement / users : 0 },
    daily,
    pages,
    channels: topN(toMap(channels), 8),
    devices: topN(toMap(devices), 5),
  };
}

// Deterministic per-path data so the mock is stable between builds.
function seededRandom(seed: string) {
  let h = 2166136261;
  for (const ch of seed) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return ((h ^= h >>> 16) >>> 0) / 4294967296;
  };
}

async function sitePaths(): Promise<string[]> {
  const pages = await getCollection("pages");
  const blog = await getCollection("blog");
  // The glob loader has no entry type for .astro source pages, so they're missing from getCollection.
  const sourcePages = Object.keys(import.meta.glob("../content/pages/**/*.astro")).map((file) =>
    file.replace("../content/pages/", "").replace(/\.astro$/, ""),
  );
  const pageIds = new Set([...pages.map((p) => p.id), ...sourcePages]);
  return [
    ...[...pageIds].map((id) => normalisePath(id.replace(/index$/, ""))),
    ...blog.map((p) => normalisePath(`/blog/${p.id}`)),
  ];
}

async function buildMockReport(): Promise<AnalyticsReport> {
  const range = dateRange();
  const paths = await sitePaths();
  const sourceNames = ["google", "(direct)", "linkedin.com", "newsletter", "bing", "github.com"];
  const pages: Record<string, PageStats> = {};

  for (const [i, path] of paths.entries()) {
    const rand = seededRandom(path);
    const base = path === "/" ? 420 : Math.round(30 + rand() * 160 / (1 + i * 0.15));
    const daily = range.days.map((date) => {
      const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
      const weekend = weekday === 0 || weekday === 6 ? 0.6 : 1;
      return { date, views: Math.round(base * weekend * (0.7 + rand() * 0.6)) };
    });
    const views = daily.reduce((sum, d) => sum + d.views, 0);
    const sources = new Map(sourceNames.map((s, j) => [s, Math.round(views * rand() / (j + 1))]));
    pages[path] = {
      views,
      users: Math.round(views * (0.55 + rand() * 0.25)),
      engagementSeconds: 25 + rand() * 140,
      bounceRate: 0.25 + rand() * 0.45,
      daily,
      sources: topN(sources, 5),
    };
  }

  const all = Object.values(pages);
  const daily = range.days.map((date, d) => {
    const views = all.reduce((sum, p) => sum + p.daily[d].views, 0);
    return { date, views, users: Math.round(views * 0.62) };
  });
  const views = daily.reduce((sum, d) => sum + d.views, 0);
  const users = Math.round(views * 0.41);

  return {
    generatedAt: new Date().toISOString(),
    source: "mock",
    range: { start: range.start, end: range.end, days: RANGE_DAYS },
    totals: {
      users,
      sessions: Math.round(views * 0.58),
      views,
      engagementSeconds: all.reduce((s, p) => s + p.engagementSeconds * p.users, 0) / Math.max(1, all.reduce((s, p) => s + p.users, 0)),
    },
    daily,
    pages,
    channels: [
      { name: "Organic Search", value: Math.round(users * 0.46) },
      { name: "Direct", value: Math.round(users * 0.27) },
      { name: "Referral", value: Math.round(users * 0.12) },
      { name: "Organic Social", value: Math.round(users * 0.09) },
      { name: "Email", value: Math.round(users * 0.06) },
    ],
    devices: [
      { name: "desktop", value: Math.round(users * 0.58) },
      { name: "mobile", value: Math.round(users * 0.38) },
      { name: "tablet", value: Math.round(users * 0.04) },
    ],
  };
}
