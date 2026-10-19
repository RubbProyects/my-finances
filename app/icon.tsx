import { ImageResponse } from "next/og";
import { IconDrawing } from "@/lib/icon";

// App icon (browser tab and Android)
export const size = { width: 512, height: 512 };
export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(<IconDrawing side={512} />, size);
}
