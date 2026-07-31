import { useEffect, useRef, useState } from "react";

export type WakeLockStatus = "off" | "active" | "unsupported" | "blocked";

export function isScreenWakeLockSupported(): boolean {
  return typeof navigator !== "undefined" && "wakeLock" in navigator;
}

type KeepAwakeFallback = { stop: () => void };

/**
 * Fallback that keeps the display awake on platforms where the native Screen
 * Wake Lock API is missing or denied (iOS Safari quirks, non-secure-context
 * LAN access, some Android browsers). It plays a tiny muted inline video fed
 * by a canvas capture stream; an actively playing video suppresses the OS
 * screen-sleep timer. Returns null when the browser cannot support it.
 */
function startKeepAwakeVideo(): KeepAwakeFallback | null {
  if (typeof document === "undefined") return null;
  try {
    const canvas = document.createElement("canvas");
    canvas.width = 2;
    canvas.height = 2;
    const context = canvas.getContext("2d");
    if (!context) return null;

    let toggle = false;
    const draw = () => {
      toggle = !toggle;
      context.fillStyle = toggle ? "#000001" : "#000000";
      context.fillRect(0, 0, canvas.width, canvas.height);
    };
    draw();

    const capture = (
      canvas as HTMLCanvasElement & { captureStream?: (frameRate?: number) => MediaStream }
    ).captureStream;
    if (typeof capture !== "function") return null;
    const stream = capture.call(canvas, 1);

    const video = document.createElement("video");
    video.muted = true;
    video.defaultMuted = true;
    video.loop = true;
    video.setAttribute("muted", "");
    video.setAttribute("playsinline", "");
    video.setAttribute("title", "VoyceLab keep-awake");
    video.style.cssText =
      "position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;pointer-events:none;";
    video.srcObject = stream;
    document.body.appendChild(video);

    const redrawTimer = window.setInterval(draw, 1000);
    const play = () => {
      const result = video.play();
      if (result && typeof result.catch === "function") result.catch(() => {});
    };
    play();

    const onVisible = () => {
      if (document.visibilityState === "visible") play();
    };
    document.addEventListener("visibilitychange", onVisible);

    return {
      stop: () => {
        window.clearInterval(redrawTimer);
        document.removeEventListener("visibilitychange", onVisible);
        try {
          video.pause();
        } catch {
          // ignore teardown races
        }
        video.srcObject = null;
        video.remove();
        for (const track of stream.getTracks()) track.stop();
      },
    };
  } catch {
    return null;
  }
}

/**
 * Keeps the screen on while `active` is true. Prefers the native Screen Wake
 * Lock API and re-acquires it when the tab regains visibility (browsers release
 * it automatically when the tab is hidden). When the native lock is unsupported
 * or denied, a video-stream fallback takes over so the display still stays
 * awake during a live session.
 */
export function useWakeLock(active: boolean): WakeLockStatus {
  const lockRef = useRef<WakeLockSentinel | null>(null);
  const fallbackRef = useRef<KeepAwakeFallback | null>(null);
  const activeRef = useRef(active);
  const retryTimerRef = useRef<number | null>(null);
  const retryAttemptRef = useRef(0);
  const [status, setStatus] = useState<WakeLockStatus>("off");
  activeRef.current = active;

  useEffect(() => {
    let cancelled = false;

    function clearRetry() {
      if (retryTimerRef.current !== null) {
        window.clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }
    }

    function scheduleRetry(acquire: () => Promise<void>) {
      if (cancelled || !activeRef.current || document.visibilityState !== "visible" || retryTimerRef.current !== null) return;
      const delay = Math.min(30_000, 1_000 * 2 ** retryAttemptRef.current);
      retryAttemptRef.current += 1;
      retryTimerRef.current = window.setTimeout(() => {
        retryTimerRef.current = null;
        void acquire();
      }, delay);
    }

    function stopFallback() {
      fallbackRef.current?.stop();
      fallbackRef.current = null;
    }

    function engageFallback() {
      if (!fallbackRef.current) fallbackRef.current = startKeepAwakeVideo();
      if (fallbackRef.current) {
        setStatus("active");
      } else {
        setStatus(isScreenWakeLockSupported() ? "blocked" : "unsupported");
      }
    }

    if (!active) {
      clearRetry();
      retryAttemptRef.current = 0;
      stopFallback();
      lockRef.current?.release().catch(() => {});
      lockRef.current = null;
      setStatus("off");
      return () => {
        cancelled = true;
      };
    }

    async function acquire() {
      if (cancelled || !activeRef.current || document.visibilityState !== "visible") return;
      if (lockRef.current) return;
      if (!isScreenWakeLockSupported()) {
        engageFallback();
        return;
      }
      try {
        clearRetry();
        lockRef.current = await navigator.wakeLock.request("screen");
        if (cancelled || !activeRef.current) {
          lockRef.current.release().catch(() => {});
          lockRef.current = null;
          return;
        }
        retryAttemptRef.current = 0;
        stopFallback();
        setStatus("active");
        lockRef.current.addEventListener("release", () => {
          lockRef.current = null;
          if (activeRef.current && document.visibilityState === "visible") {
            engageFallback();
            scheduleRetry(acquire);
          }
        });
      } catch {
        if (cancelled) return;
        lockRef.current = null;
        engageFallback();
        scheduleRetry(acquire);
      }
    }

    function reacquireIfVisible() {
      if (document.visibilityState === "visible" && activeRef.current) {
        void acquire();
      }
    }

    acquire();
    document.addEventListener("visibilitychange", reacquireIfVisible);
    window.addEventListener("focus", reacquireIfVisible);
    window.addEventListener("pageshow", reacquireIfVisible);

    return () => {
      cancelled = true;
      clearRetry();
      stopFallback();
      lockRef.current?.release().catch(() => {});
      lockRef.current = null;
      document.removeEventListener("visibilitychange", reacquireIfVisible);
      window.removeEventListener("focus", reacquireIfVisible);
      window.removeEventListener("pageshow", reacquireIfVisible);
    };
  }, [active]);

  return status;
}
