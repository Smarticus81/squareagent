import { useEffect, useRef, useState } from "react";

export type WakeLockStatus = "off" | "active" | "unsupported" | "blocked";

export function isScreenWakeLockSupported(): boolean {
  return typeof navigator !== "undefined" && "wakeLock" in navigator;
}

/**
 * Keeps the screen on while `active` is true using the Screen Wake Lock API.
 * Re-acquires the lock when the tab regains visibility (browsers release it
 * automatically when the tab is hidden). Falls back silently on unsupported
 * browsers or when the OS denies the request (e.g. low battery).
 */
export function useWakeLock(active: boolean): WakeLockStatus {
  const lockRef = useRef<WakeLockSentinel | null>(null);
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

    if (!active) {
      clearRetry();
      retryAttemptRef.current = 0;
      setStatus("off");
    }

    if (!isScreenWakeLockSupported()) {
      setStatus(active ? "unsupported" : "off");
      return;
    }

    async function acquire() {
      if (cancelled || !activeRef.current || document.visibilityState !== "visible") return;
      if (lockRef.current) return;
      try {
        clearRetry();
        lockRef.current = await navigator.wakeLock.request("screen");
        if (cancelled || !activeRef.current) {
          lockRef.current.release().catch(() => {});
          lockRef.current = null;
          return;
        }
        retryAttemptRef.current = 0;
        setStatus("active");
        lockRef.current.addEventListener("release", () => {
          lockRef.current = null;
          if (activeRef.current && document.visibilityState === "visible") {
            setStatus("blocked");
            scheduleRetry(acquire);
          } else if (activeRef.current) {
            setStatus("off");
          }
        });
      } catch {
        if (cancelled) return;
        lockRef.current = null;
        setStatus(activeRef.current ? "blocked" : "off");
        scheduleRetry(acquire);
      }
    }

    function release() {
      clearRetry();
      lockRef.current?.release().catch(() => {});
      lockRef.current = null;
      if (!activeRef.current) setStatus("off");
    }

    function reacquireIfVisible() {
      if (document.visibilityState === "visible" && activeRef.current) {
        void acquire();
      }
    }

    if (active) {
      acquire();
      document.addEventListener("visibilitychange", reacquireIfVisible);
      window.addEventListener("focus", reacquireIfVisible);
      window.addEventListener("pageshow", reacquireIfVisible);
    } else {
      release();
    }

    return () => {
      cancelled = true;
      release();
      document.removeEventListener("visibilitychange", reacquireIfVisible);
      window.removeEventListener("focus", reacquireIfVisible);
      window.removeEventListener("pageshow", reacquireIfVisible);
    };
  }, [active]);

  return status;
}
