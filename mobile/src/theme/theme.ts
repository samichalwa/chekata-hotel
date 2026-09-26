// Matches The Chekata web app's warm terracotta/hospitality palette
// (derived from client/src/index.css --primary / --background tokens)
export const colors = {
  primary: "#BF4418",
  primaryDark: "#9A3712",
  primaryForeground: "#FCF9F4",
  background: "#F8F4EC",
  surface: "#FFFFFF",
  surfaceAlt: "#F1EBDF",
  border: "#E4DCC9",
  text: "#231B14",
  textMuted: "#6B6152",
  success: "#3F7D45",
  successBg: "#E6F1E6",
  warning: "#B98314",
  warningBg: "#FBF1DC",
  danger: "#B23A2E",
  dangerBg: "#F8E7E4",
  info: "#3B6FA0",
  infoBg: "#E8F0F8",
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
} as const;

export const radius = {
  sm: 8,
  md: 12,
  lg: 16,
  pill: 999,
} as const;

export const typography = {
  h1: { fontSize: 26, fontWeight: "700" as const },
  h2: { fontSize: 20, fontWeight: "700" as const },
  h3: { fontSize: 16, fontWeight: "600" as const },
  body: { fontSize: 15, fontWeight: "400" as const },
  small: { fontSize: 13, fontWeight: "400" as const },
  label: { fontSize: 12, fontWeight: "600" as const },
};
