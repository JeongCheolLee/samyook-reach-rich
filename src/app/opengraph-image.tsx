import { ImageResponse } from "next/og";

export const runtime = "edge";
export const alt = "REACH RICH - 삼육 투자 모임";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          background: "linear-gradient(135deg, #0a0a0a 0%, #1a1a2e 50%, #0a0a0a 100%)",
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: "sans-serif",
        }}
      >
        <div
          style={{
            fontSize: 120,
            marginBottom: 10,
          }}
        >
          💰
        </div>
        <div
          style={{
            fontSize: 72,
            fontWeight: 900,
            color: "#ffffff",
            letterSpacing: "-2px",
          }}
        >
          REACH RICH
        </div>
        <div
          style={{
            fontSize: 32,
            color: "#16a34a",
            marginTop: 8,
            fontWeight: 600,
          }}
        >
          삼육, 올해엔 어디로 갈 것인가?
        </div>
        <div
          style={{
            fontSize: 24,
            color: "#94a3b8",
            marginTop: 12,
          }}
        >
          아니 가긴 가나..?
        </div>
        <div
          style={{
            display: "flex",
            gap: 16,
            marginTop: 40,
            fontSize: 36,
          }}
        >
          {["🐻", "🐯", "🦊", "🐺", "🦁", "🐧", "🐶", "🐱", "🐼"].map(
            (icon, i) => (
              <span key={i}>{icon}</span>
            )
          )}
        </div>
      </div>
    ),
    { ...size }
  );
}
