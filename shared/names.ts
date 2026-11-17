// Messages greet the recipient by first name only ("Dear Joshua," not "Dear Joshua Pkiror,").
const TITLES = /^(mr|mrs|ms|miss|dr|prof|eng|rev|hon|sir|madam|mama|mzee)\.?$/i;
export function firstName(name: unknown, fallback = "there"): string {
  const words = String(name ?? "").trim().split(/\s+/).filter(Boolean);
  while (words.length > 1 && TITLES.test(words[0])) words.shift();
  const w = words[0] ?? "";
  if (!w) return fallback;
  return w === w.toLowerCase() ? w.charAt(0).toUpperCase() + w.slice(1) : w;
}
