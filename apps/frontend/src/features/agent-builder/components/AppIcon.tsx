/**
 * Third-party brand logos are not reused (no verified license). Each app gets a
 * neutral monogram tile in its approximate brand hue instead.
 */
const HUES: Record<string, string> = {
  zendesk: "#03363d", notion: "#111", gong: "#8a3ffc", clickup: "#7b68ee", metabase: "#509ee3", slack: "#4a154b",
  claude: "#d97757", gpt: "#10a37f", github: "#24292f", vercel: "#000", figma: "#a259ff", chromatic: "#fc521f",
  storybook: "#ff4785", maze: "#222", miro: "#e6b800", framer: "#0055ff", gitlab: "#fc6d26", bitbucket: "#2684ff",
  gmail: "#ea4335", calendar: "#4285f4", memory: "#0f766e", zroute: "#4338ca", console: "#1f6feb", message: "#334155",
};

export function AppIcon({ app, size = 16 }: { app: string; size?: number }) {
  const bg = HUES[app] ?? "#888";
  return (
    <span
      aria-hidden
      style={{ width: size, height: size, borderRadius: 4, background: bg, color: "#fff", fontSize: size * 0.56, fontWeight: 600, display: "inline-grid", placeItems: "center", flex: "none", lineHeight: 1 }}
    >
      {app[0]?.toUpperCase()}
    </span>
  );
}
