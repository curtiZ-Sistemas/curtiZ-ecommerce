import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "curti Z — Painel interno",
    short_name: "curti Z Painel",
    start_url: "/",
    display: "standalone",
    background_color: "#f8f7f6",
    theme_color: "#7e1c13",
    icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml" }]
  };
}
