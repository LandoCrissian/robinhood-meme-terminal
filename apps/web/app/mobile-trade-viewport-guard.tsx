"use client";

import { useEffect } from "react";

const MOBILE_QUERY = "(max-width: 760px)";
const RAIL_SELECTOR = ".professionalTradeWorkspace .universalTradeRail";
const BACKDROP_SELECTOR = ".professionalTradeWorkspace .universalTradeSheetBackdrop";

function clearViewportAlignment(rail: HTMLElement | null, backdrop: HTMLElement | null) {
  rail?.style.removeProperty("transform");
  rail?.style.removeProperty("transition");
  rail?.style.removeProperty("max-height");
  backdrop?.style.removeProperty("transform");
  backdrop?.style.removeProperty("height");
}

/**
 * Some mobile WebKit/Chromium layouts treat a fixed descendant of the market
 * grid as fixed to the grid's document-height containing block. The resulting
 * sheet opens correctly in state, but appears hundreds of pixels below the
 * visible phone viewport. Align the open rail to the visual viewport after
 * layout, and keep it aligned while the browser chrome or keyboard resizes.
 *
 * This does not alter trade state, routing, quoting, simulation, or wallet
 * behavior. It only corrects the rendered coordinate system of the mobile
 * execution surface.
 */
export function MobileTradeViewportGuard() {
  useEffect(() => {
    const media = window.matchMedia(MOBILE_QUERY);
    let frame = 0;

    const align = () => {
      frame = 0;
      const rail = document.querySelector<HTMLElement>(RAIL_SELECTOR);
      const backdrop = document.querySelector<HTMLElement>(BACKDROP_SELECTOR);
      if (!rail || !media.matches || !rail.classList.contains("mobileOpen")) {
        clearViewportAlignment(rail, backdrop);
        return;
      }

      // Measure the unadjusted open position. Disabling the slide transition
      // prevents an intermediate animation frame from contaminating the offset.
      rail.style.setProperty("transition", "none", "important");
      rail.style.removeProperty("transform");
      backdrop?.style.removeProperty("transform");

      window.requestAnimationFrame(() => {
        const visualViewport = window.visualViewport;
        const viewportTop = visualViewport?.offsetTop ?? 0;
        const viewportHeight = visualViewport?.height ?? window.innerHeight;
        const viewportBottom = viewportTop + viewportHeight;
        const railRect = rail.getBoundingClientRect();
        const railOffset = viewportBottom - railRect.bottom;

        rail.style.setProperty(
          "transform",
          `translate3d(0, ${railOffset.toFixed(3)}px, 0)`,
          "important"
        );
        rail.style.setProperty(
          "max-height",
          `${Math.max(320, Math.floor(viewportHeight * 0.94))}px`,
          "important"
        );

        if (backdrop) {
          const backdropRect = backdrop.getBoundingClientRect();
          const backdropOffset = viewportTop - backdropRect.top;
          backdrop.style.setProperty(
            "transform",
            `translate3d(0, ${backdropOffset.toFixed(3)}px, 0)`,
            "important"
          );
          backdrop.style.setProperty("height", `${Math.ceil(viewportHeight)}px`, "important");
        }
      });
    };

    const schedule = () => {
      if (frame) window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(align);
    };

    const observer = new MutationObserver(schedule);
    observer.observe(document.body, {
      subtree: true,
      attributes: true,
      attributeFilter: ["class"]
    });
    media.addEventListener("change", schedule);
    window.addEventListener("resize", schedule);
    window.addEventListener("orientationchange", schedule);
    window.visualViewport?.addEventListener("resize", schedule);
    window.visualViewport?.addEventListener("scroll", schedule);
    schedule();

    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      observer.disconnect();
      media.removeEventListener("change", schedule);
      window.removeEventListener("resize", schedule);
      window.removeEventListener("orientationchange", schedule);
      window.visualViewport?.removeEventListener("resize", schedule);
      window.visualViewport?.removeEventListener("scroll", schedule);
      clearViewportAlignment(
        document.querySelector<HTMLElement>(RAIL_SELECTOR),
        document.querySelector<HTMLElement>(BACKDROP_SELECTOR)
      );
    };
  }, []);

  return null;
}
