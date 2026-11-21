import { fileURLToPath } from "node:url";

/** @type {import("next").NextConfig} */
export default {
  poweredByHeader: false,
  outputFileTracingRoot: fileURLToPath(new URL("../../", import.meta.url)),
  async headers() {
    return [{
      source: "/:path*",
      headers: [
        { key: "X-Robots-Tag", value: "noindex, nofollow" },
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "X-Frame-Options", value: "DENY" },
        { key: "Referrer-Policy", value: "no-referrer" },
        { key: "Content-Security-Policy", value: "base-uri 'self'; connect-src 'self'; form-action 'none'; frame-ancestors 'none'; object-src 'none'" },
      ],
    }];
  },
};
