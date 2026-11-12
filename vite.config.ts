import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { readFileSync } from "node:fs";
import process from "node:process";
import pkg from "./package.json" with { type: "json" };
const host = process.env.TAURI_DEV_HOST;

// The browser version runs cross-origin isolated, as public-web/_headers sets it in production.
const isolated = { "Cross-Origin-Opener-Policy": "same-origin", "Cross-Origin-Embedder-Policy": "require-corp" };

// onnxruntime-web references its 27 MB wasm, over Cloudflare Pages' 25 MiB limit. The page loads the pinned copy from jsDelivr instead.
const dropOrtWasm = {
  name: "drop-ort-wasm",
  generateBundle(_: unknown, bundle: Record<string, unknown>) {
    for (const file of Object.keys(bundle)) if (/ort-wasm[^/]*\.wasm$/.test(file)) delete bundle[file];
  },
};

const SITE = "https://tlansclaib.marcwieland.name/";
const TITLE = "wavetyper Lite: transcribe audio in your browser, nothing uploaded";
const DESCRIPTION =
  "Transcribe audio and video to text or subtitles in your browser, in about 100 languages. Free, no sign-up, and the recording never leaves your computer.";

const tokens = readFileSync("src/styles/tokens.css", "utf8");
const surface = (block: string) => /--surface: (#[0-9a-f]{6});/.exec(block)?.[1] ?? "";
const SURFACE = { light: surface(tokens.split("@media")[0]), dark: surface(tokens.split(':root[data-theme="dark"]')[1] ?? "") };

const webHead = {
  name: "web-head",
  transformIndexHtml(html: string) {
    const meta = (attrs: Record<string, string>) => ({ tag: "meta", attrs, injectTo: "head" as const });
    const link = (attrs: Record<string, string>) => ({ tag: "link", attrs, injectTo: "head" as const });
    const app = {
      "@context": "https://schema.org",
      "@type": "WebApplication",
      name: "wavetyper Lite",
      url: SITE,
      description: DESCRIPTION,
      applicationCategory: "MultimediaApplication",
      operatingSystem: "Any",
      browserRequirements: "A desktop browser with WebGPU and shader-f16, such as a recent Chrome",
      isAccessibleForFree: true,
      offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
      author: { "@type": "Person", name: "Marc Wieland", url: "https://marcwieland.name" },
      sameAs: "https://github.com/mawiswiss/tlansclaib",
    };
    return {
      html: html.replace(/<title>.*<\/title>/, `<title>${TITLE}</title>`),
      tags: [
        meta({ name: "description", content: DESCRIPTION }),
        meta({ name: "robots", content: "index, follow" }),
        meta({ name: "theme-color", media: "(prefers-color-scheme: light)", content: SURFACE.light }),
        meta({ name: "theme-color", media: "(prefers-color-scheme: dark)", content: SURFACE.dark }),
        link({ rel: "canonical", href: SITE }),
        link({ rel: "icon", href: "/favicon.ico", sizes: "32x32" }),
        link({ rel: "icon", href: "/favicon.svg", type: "image/svg+xml" }),
        link({ rel: "apple-touch-icon", href: "/apple-touch-icon.png" }),
        meta({ property: "og:type", content: "website" }),
        meta({ property: "og:site_name", content: "wavetyper" }),
        meta({ property: "og:locale", content: "en_US" }),
        meta({ property: "og:url", content: SITE }),
        meta({ property: "og:title", content: TITLE }),
        meta({ property: "og:description", content: DESCRIPTION }),
        meta({ property: "og:image", content: `${SITE}og-image.png` }),
        meta({ property: "og:image:width", content: "1200" }),
        meta({ property: "og:image:height", content: "630" }),
        meta({ property: "og:image:alt", content: "Audio to text. In your browser. A transcript with speakers, timecodes and a waveform in wavetyper Lite." }),
        meta({ name: "twitter:card", content: "summary_large_image" }),
        meta({ name: "twitter:image", content: `${SITE}og-image.png` }),
        { tag: "script", attrs: { type: "application/ld+json" }, children: JSON.stringify(app), injectTo: "head" as const },
      ],
    };
  },
};

// https://vite.dev/config/
export default defineConfig(({ mode }) => ({
  plugins: mode === "web" ? [react(), dropOrtWasm, webHead] : [react()],
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  // The Tauri CLI sets TAURI_ENV_PLATFORM to ios or android for a phone build.
  envPrefix: ["VITE_", "TAURI_ENV_"],
  worker: { format: "es" as const },
  ...(mode === "web"
    ? {
        publicDir: "public-web",
        build: { outDir: "dist-web" },
        server: { port: 1432, strictPort: true, headers: isolated },
        preview: { port: 1433, strictPort: true, headers: isolated },
      }
    : {
        // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
        //
        // 1. prevent Vite from obscuring rust errors
        clearScreen: false,
        // 2. tauri expects a fixed port, fail if that port is not available
        server: {
          port: 1420,
          strictPort: true,
          host: host || false,
          hmr: host
            ? {
                protocol: "ws",
                host,
                port: 1421,
              }
            : undefined,
          watch: {
            // 3. tell Vite to ignore watching `src-tauri`
            ignored: ["**/src-tauri/**"],
          },
        },
      }),
}));
