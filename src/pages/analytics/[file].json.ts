import type { APIRoute } from "astro";
import { getAnalyticsReport, isAnalyticsEnabled } from "../../lib/analytics";

// Emits /analytics/pages.json for the editor pop-up; nothing on builds without analytics.
export function getStaticPaths() {
  return isAnalyticsEnabled() ? [{ params: { file: "pages" } }] : [];
}

export const GET: APIRoute = async () => {
  const { generatedAt, source, range, pages } = await getAnalyticsReport();
  return new Response(JSON.stringify({ generatedAt, source, range, pages }), {
    headers: { "Content-Type": "application/json" },
  });
};
