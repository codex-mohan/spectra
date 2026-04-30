import { defineConfig } from "vitepress";

export default defineConfig({
  title: "Spectra",
  description: "Minimal, ultra-fast, multi-language AI agent framework",
  lastUpdated: true,
  cleanUrls: true,
  themeConfig: {
    logo: { light: "/logo.svg", dark: "/logo.svg" },
    nav: [
      { text: "Guide", link: "/guide/getting-started" },
      { text: "API", link: "/api/agent" },
    ],
    sidebar: {
      "/guide/": [
        {
          text: "Guide",
          items: [
            { text: "Getting Started", link: "/guide/getting-started" },
            { text: "Agent", link: "/guide/agent" },
            { text: "Tools", link: "/guide/tools" },
            { text: "Providers", link: "/guide/providers" },
            { text: "Events", link: "/guide/events" },
          ],
        },
      ],
      "/api/": [
        {
          text: "TypeScript API",
          items: [
            { text: "Agent", link: "/api/agent" },
            { text: "Tools", link: "/api/tools" },
            { text: "Events", link: "/api/events" },
            { text: "Providers", link: "/api/providers" },
          ],
        },
        {
          text: "Rust API",
          items: [
            { text: "Overview", link: "/api/rust" },
          ],
        },
      ],
    },
    socialLinks: [
      { icon: "github", link: "https://github.com/codex-mohan/spectra" },
    ],
    footer: {
      message: "Released under the MIT License.",
      copyright: "Copyright 2026-present Spectra",
    },
  },
});
