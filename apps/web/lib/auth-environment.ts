const EMBEDDED_BROWSER_TOKENS = [
  "BytedanceWebview",
  "ChatGPT",
  "Discord",
  "FBAN",
  "FBAV",
  "GSA/",
  "Instagram",
  "Line/",
  "LinkedInApp",
  "OpenAI",
  "Reddit",
  "Snapchat",
  "TikTok",
  "Twitter"
];

export function isEmbeddedAuthBrowser(userAgent: string) {
  const normalized = userAgent.trim();
  if (!normalized) return false;
  const lowercase = normalized.toLowerCase();
  if (EMBEDDED_BROWSER_TOKENS.some((token) => lowercase.includes(token.toLowerCase()))) return true;

  const androidWebView = /\bwv\b/i.test(normalized)
    || (/Android/i.test(normalized) && /Version\/[\d.]+.*Chrome\//i.test(normalized));
  if (androidWebView) return true;

  const iosDevice = /iPhone|iPad|iPod/i.test(normalized);
  const recognizedIosBrowser = /Safari|CriOS|FxiOS|EdgiOS|OPiOS/i.test(normalized);
  return iosDevice && /AppleWebKit/i.test(normalized) && !recognizedIosBrowser;
}
