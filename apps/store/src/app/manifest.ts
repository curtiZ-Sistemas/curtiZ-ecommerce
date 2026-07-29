import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Curtiz — Loja Oficial",
    short_name: "Curtiz",
    description: "Loja online Curtiz",
    start_url: "/",
    display: "standalone",
    background_color: "#fff7f5",
    theme_color: "#7e1c13",
    icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml" }]
  };
}
