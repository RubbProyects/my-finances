// The app icon drawing: blue background with three rising white bars.
// Used by app/icon.tsx and app/apple-icon.tsx to generate the PNG images.
// The bars sit in the middle so they aren't cut when the phone rounds the icon.

export const ICON_BLUE = "#2a78d6";

export function IconDrawing({ side }: { side: number }) {
  const width = side * 0.14;
  const gap = side * 0.07;
  const heights = [0.26, 0.4, 0.56];
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "flex-end",
        justifyContent: "center",
        gap,
        paddingBottom: side * 0.24,
        background: ICON_BLUE,
      }}
    >
      {heights.map((h, i) => (
        <div
          key={i}
          style={{
            width,
            height: side * h,
            background: "white",
            borderRadius: width * 0.3,
          }}
        />
      ))}
    </div>
  );
}
