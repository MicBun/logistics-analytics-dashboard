import { ImageResponse } from "next/og";

export const alt = "Logistics Analytics — AI-powered logistics dashboard";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          height: "100%",
          width: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          background:
            "linear-gradient(135deg, #4f46e5 0%, #6366f1 45%, #0ea5e9 100%)",
          color: "white",
        }}
      >
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            textAlign: "center",
            padding: "80px",
          }}
        >
          {/* Ascending-bars brand glyph */}
          <div
            style={{
              display: "flex",
              alignItems: "flex-end",
              gap: 10,
              width: 120,
              height: 120,
              background: "rgba(255, 255, 255, 0.18)",
              borderRadius: 24,
              padding: 22,
              marginBottom: 40,
            }}
          >
            <div style={{ display: "flex", width: 18, height: "40%", background: "white", borderRadius: 4 }} />
            <div style={{ display: "flex", width: 18, height: "65%", background: "white", borderRadius: 4 }} />
            <div style={{ display: "flex", width: 18, height: "100%", background: "white", borderRadius: 4 }} />
          </div>

          <div style={{ display: "flex", fontSize: 68, fontWeight: "bold", marginBottom: 18 }}>
            Logistics Analytics
          </div>
          <div style={{ display: "flex", fontSize: 32, opacity: 0.92, marginBottom: 30 }}>
            AI that routes, never invents numbers
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 14,
              fontSize: 24,
              background: "rgba(255, 255, 255, 0.15)",
              padding: "14px 30px",
              borderRadius: 50,
              border: "1px solid rgba(255, 255, 255, 0.25)",
            }}
          >
            <div style={{ display: "flex", width: 10, height: 10, borderRadius: 5, background: "#fbbf24" }} />
            Demo · real Claude tool-use over a sample dataset
          </div>
        </div>

        <div
          style={{
            position: "absolute",
            bottom: 40,
            right: 60,
            fontSize: 24,
            opacity: 0.85,
          }}
        >
          logistics.micbun.com
        </div>
      </div>
    ),
    { ...size }
  );
}
