import type { MetadataRoute } from "next";
import {
  RMT_SITE_ALTERNATE_NAME,
  RMT_SITE_DESCRIPTION,
  RMT_SITE_NAME
} from "../lib/site-identity";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: `${RMT_SITE_NAME} — ${RMT_SITE_ALTERNATE_NAME}`,
    short_name: "RMT Launch",
    description: RMT_SITE_DESCRIPTION,
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#060906",
    theme_color: "#060906",
    icons: [
      {
        src: "/brand/rmt-master-logo.png",
        sizes: "1254x1254",
        type: "image/png",
        purpose: "any"
      }
    ]
  };
}
