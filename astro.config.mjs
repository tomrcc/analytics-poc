import { defineConfig, envField } from "astro/config";
import react from "@astrojs/react";
import editableRegions from "@cloudcannon/editable-regions/astro-integration";
import mdx from "@astrojs/mdx";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  site: "https://tiny-jackal.cloudvent.net/",
  integrations: [react(), editableRegions(), mdx()],
  image: {
    // SVG sources are passed through the image pipeline by the component globs.
    // Disabled by default since Astro 6.3; our SVGs are local, trusted assets.
    dangerouslyProcessSVG: true,
  },
  compressHTML: true,
  env: {
    schema: {
      // Set only on the production site, so staging traffic never reaches GA.
      GA_MEASUREMENT_ID: envField.string({ context: "server", access: "public", optional: true }),
      // Set only on the staging site. Without ANALYTICS_ENABLED no analytics output is built.
      ANALYTICS_ENABLED: envField.boolean({ context: "server", access: "public", default: false }),
      GA_PROPERTY_ID: envField.string({ context: "server", access: "secret", optional: true }),
      // Service account JSON, raw or base64.
      GA_CREDENTIALS: envField.string({ context: "server", access: "secret", optional: true }),
    },
  },
  vite: {
    plugins: [tailwindcss()],
  },
});
