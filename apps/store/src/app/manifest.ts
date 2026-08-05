import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "curti Z — Loja Oficial",
    short_name: "curti Z",
    description: "Loja online curti Z",
    start_url: "/",
    display: "standalone",
    background_color: "#fff7f5",
    theme_color: "#7e1c13",
    icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml" }]
  };
}
