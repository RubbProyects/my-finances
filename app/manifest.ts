import type { MetadataRoute } from "next";
import { APP_DESCRIPTION, APP_NAME, DEMO } from "@/lib/demo";
import { ICON_BLUE } from "@/lib/icon";

// Data to install the app on the phone (name, icon, full screen)
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: APP_NAME,
    short_name: APP_NAME,
    description: APP_DESCRIPTION,
    lang: DEMO ? "en" : "es",
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
