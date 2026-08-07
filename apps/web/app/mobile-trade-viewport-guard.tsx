"use client";

import { useEffect } from "react";

const MOBILE_QUERY = "(max-width: 760px)";
const RAIL_SELECTOR = ".professionalTradeWorkspace .universalTradeRail";

function clearAlignment(rail: HTMLElement | null) {
  rail?.style.removeProperty("transform");
  rail?.style.removeProperty("transition");
  rail?.style.removeProperty("height");
  rail?.style.removeProperty("max-height");
}

/**
 * Chromium and Mobile Safari can resolve a fixed descendant of the market
 * workspace against the workspace's document-height containing block. The
 * trade state opens correctly, but the sheet appears below the visible phone
 * viewport. This guard observes only the rail's open/closed class on mobile
 * and translates the open sheet into the current visual viewport.
 *
 * It never runs on desktop and does not alter routing, quotes, simulation,
 * wallet permissions, transaction data, or trade state.
 */
export function MobileTradeViewportGuard() {
  useEffect(() => {
    const media = window.matchMedia(MOBILE_QUERY);
    if (!media.matches) return;

    let rail: HTMLElement | null = null;
    let railObserver: MutationObserver | null = null;
    let discoveryObserver: MutationObserver | null = null;
    let frame = 0;

    const align = () => {
      frame = 0;
      if (!rail || !rail.classList.contains("mobileOpen")) {
        clearAlignment(rail);
        return;
      }

      rail.style.setProperty("transition", "none", "important");
      rail.style.setProperty("transform", "translate3d(0, 0, 0)", "important");

      window.requestAnimationFrame(() => {
        if (!rail || !rail.classList.contains("mobileOpen")) return;
        const visual = window.visualViewport;
        const viewportTop = visual?.offsetTop ?? 0;
        const viewportHeight = visual?.height ?? window.innerHeight;
        const viewportBottom = viewportTop + viewportHeight;
        const availableHeight = Math.max(320, Math.floor(viewportHeight * 0.94));

        rail.style.setProperty("height", `${availableHeight}px`, "important");
        rail.style.setProperty("max-height", `${availableHeight}px`, "important");

        const rect = rail.getBoundingClientRect();
        let correction = viewportBottom - rect.bottom;
        if (rect.top + correction < viewportTop) {
          correction += viewportTop - (rect.top + correction);
        }
        rail.style.setProperty(
          "transform",
          `translate3d(0, ${correction.toFixed(3)}px, 0)`,
          "important"
        );
      });
    };

    const schedule = () => {
      if (frame) window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(align);
    };

    const bindRail = () => {
      const candidate = document.querySelector<HTMLElement>(RAIL_SELECTOR);
      if (!candidate) return false;
      rail = candidate;
      railObserver = new MutationObserver(schedule);
      railObserver.observe(rail, { attributes: true, attributeFilter: ["class"] });
      schedule();
      return true;
    };

    if (!bindRail()) {
      discoveryObserver = new MutationObserver(() => {
        if (!bindRail()) return;
        discoveryObserver?.disconnect();
        discoveryObserver = null;
      });
      discoveryObserver.observe(document.body, { childList: true, subtree: true });
    }

    window.addEventListener("resize", schedule);
    window.addEventListener("orientationchange", schedule);
    window.visualViewport?.addEventListener("resize", schedule);
    window.visualViewport?.addEventListener("scroll", schedule);

    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      railObserver?.disconnect();
      discoveryObserver?.disconnect();
      window.removeEventListener("resize", schedule);
      window.removeEventListener("orientationchange", schedule);
      window.visualViewport?.removeEventListener("resize", schedule);
      window.visualViewport?.removeEventListener("scroll", schedule);
      clearAlignment(rail);
    };
  }, []);

  return null;
}
