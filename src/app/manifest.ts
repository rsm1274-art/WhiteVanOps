import type { MetadataRoute } from "next";

// Web app manifest — lets field techs install /field as an app on their phone
// (scan the QR code from the dashboard, then "Add to Home Screen").
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "White Van Ops — Field",
    short_name: "WVO Field",
    description: "Field operations module for technicians",
    start_url: "/field",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#18181b",
    theme_color: "#18181b",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
