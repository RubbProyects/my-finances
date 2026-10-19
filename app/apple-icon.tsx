import { ImageResponse } from "next/og";
import { IconDrawing } from "@/lib/icon";

// Icon for the iPhone home screen
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(<IconDrawing side={180} />, size);
}
