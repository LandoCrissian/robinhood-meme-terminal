"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";

const MOBILE_QUERY = "(max-width: 760px)";
const WORKSPACE_SELECTOR = ".professionalTradeWorkspace";
const RAIL_SELECTOR = `${WORKSPACE_SELECTOR} .universalTradeRail`;
const BACKDROP_SELECTOR = `${WORKSPACE_SELECTOR} .universalTradeSheetBackdrop`;

function clearAlignment(rail: HTMLElement | null, backdrop: HTMLElement | null) {
  rail?.style.removeProperty("transform");
  rail?.style.removeProperty("transition");
  rail?.style.removeProperty("height");
  rail?.style.removeProperty("max-height");
  backdrop?.style.removeProperty("transform");
  backdrop?.style.removeProperty("height");
}

/**
 * Mobile WebKit and Chromium can resolve a fixed child of the market workspace
 * against the workspace's document-height containing block. The React state is
 * correct, but the open rail then renders below the visible phone viewport.
 *
 * Align only after an explicit workspace action or visual-viewport change. This
 * avoids a document-wide mutation observer and does not move React-owned DOM.
 */
export function MobileTradeViewportAligner() {
  const pathname = usePathname();

  useEffect(() => {
    const media = window.matchMedia(MOBILE_QUERY);
    let frame = 0;
    let followUpFrame = 0;
    let discoveryFrame = 0;
    let discoveryAttempts = 0;
    let rail: HTMLElement | null = null;
    let backdrop: HTMLElement | null = null;

    const discover = () => {
      rail = document.querySelector<HTMLElement>(RAIL_SELECTOR);
      backdrop = document.querySelector<HTMLElement>(BACKDROP_SELECTOR);
      if ((rail && backdrop) || discoveryAttempts >= 180) return;
      discoveryAttempts += 1;
      discoveryFrame = window.requestAnimationFrame(discover);
    };

    const align = () => {
      frame = 0;
      rail ??= document.querySelector<HTMLElement>(RAIL_SELECTOR);
      backdrop ??= document.querySelector<HTMLElement>(BACKDROP_SELECTOR);
      if (!rail || !backdrop || !media.matches || !rail.classList.contains("mobileOpen")) {
        clearAlignment(rail, backdrop);
        return;
      }

      const visualViewport = window.visualViewport;
      const viewportTop = visualViewport?.offsetTop ?? 0;
      const viewportHeight = visualViewport?.height ?? window.innerHeight;
      const targetTop = viewportTop + Math.max(0, viewportHeight * 0.06);

      // Measure the CSS-open position before applying the corrective offset.
      rail.style.setProperty("transition", "none", "important");
      rail.style.setProperty("transform", "translate3d(0, 0, 0)", "important");
      backdrop.style.setProperty("transform", "translate3d(0, 0, 0)", "important");

      const railRect = rail.getBoundingClientRect();
      const backdropRect = backdrop.getBoundingClientRect();
      const railOffset = targetTop - railRect.top;
      const backdropOffset = viewportTop - backdropRect.top;

      rail.style.setProperty(
        "transform",
        `translate3d(0, ${railOffset.toFixed(3)}px, 0)`,
        "important"
      );
      rail.style.setProperty(
        "height",
        `${Math.max(320, Math.floor(viewportHeight * 0.94))}px`,
        "important"
      );
      rail.style.setProperty(
        "max-height",
        `${Math.max(320, Math.floor(viewportHeight * 0.94))}px`,
        "important"
      );
      backdrop.style.setProperty(
        "transform",
        `translate3d(0, ${backdropOffset.toFixed(3)}px, 0)`,
        "important"
      );
      backdrop.style.setProperty("height", `${Math.ceil(viewportHeight)}px`, "important");
    };

    const schedule = () => {
      if (frame) window.cancelAnimationFrame(frame);
      if (followUpFrame) window.cancelAnimationFrame(followUpFrame);
      frame = window.requestAnimationFrame(() => {
        // React applies mobileOpen during the first commit after the click.
        followUpFrame = window.requestAnimationFrame(align);
      });
    };

    const handleWorkspaceAction = (event: Event) => {
      const target = event.target;
      if (!(target instanceof Element) || !target.closest(WORKSPACE_SELECTOR)) return;
      schedule();
    };

    discover();
    document.addEventListener("click", handleWorkspaceAction, true);
    document.addEventListener("pointerup", handleWorkspaceAction, true);
    media.addEventListener("change", schedule);
    window.addEventListener("resize", schedule);
    window.addEventListener("orientationchange", schedule);
    window.visualViewport?.addEventListener("resize", schedule);
    window.visualViewport?.addEventListener("scroll", schedule);
    schedule();

    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      if (followUpFrame) window.cancelAnimationFrame(followUpFrame);
      if (discoveryFrame) window.cancelAnimationFrame(discoveryFrame);
      document.removeEventListener("click", handleWorkspaceAction, true);
      document.removeEventListener("pointerup", handleWorkspaceAction, true);
      media.removeEventListener("change", schedule);
      window.removeEventListener("resize", schedule);
      window.removeEventListener("orientationchange", schedule);
      window.visualViewport?.removeEventListener("resize", schedule);
      window.visualViewport?.removeEventListener("scroll", schedule);
      clearAlignment(rail, backdrop);
    };
  }, [pathname]);

  return null;
}
