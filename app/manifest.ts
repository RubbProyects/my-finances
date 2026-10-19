import type { MetadataRoute } from "next";
import { ICON_BLUE } from "@/lib/icon";

// Data to install the app on the phone (name, icon, full screen)
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Mi cartera",
    short_name: "Mi cartera",
    description: "Mi dinero: cuentas, inversiones, gastos y proyección",
    lang: "es",
    start_url: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: ICON_BLUE,
    icons: [
      { src: "/icon", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon", sizes: "512x512", type: "image/png", purpose: "maskable" },
      { src: "/apple-icon", sizes: "180x180", type: "image/png" },
    ],
  };
}
