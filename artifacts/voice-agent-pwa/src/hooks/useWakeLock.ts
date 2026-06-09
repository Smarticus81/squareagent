import { useEffect, useRef, useState } from "react";

export type WakeLockStatus = "off" | "active" | "unsupported" | "blocked";

/**
 * Keeps the screen on while `active` is true using the Screen Wake Lock API.
 * Re-acquires the lock when the tab regains visibility (browsers release it
 * automatically when the tab is hidden). Falls back silently on unsupported
 * browsers or when the OS denies the request (e.g. low battery).
 */
export function useWakeLock(active: boolean): WakeLockStatus {
  const lockRef = useRef<WakeLockSentinel | null>(null);
  const activeRef = useRef(active);
  const [status, setStatus] = useState<WakeLockStatus>("off");
  activeRef.current = active;

  useEffect(() => {
    if (!active) {
      setStatus("off");
    }

    if (!("wakeLock" in navigator)) {
      setStatus(active ? "unsupported" : "off");
      return;
    }

    async function acquire() {
      if (lockRef.current) return;
      try {
        lockRef.current = await navigator.wakeLock.request("screen");
        setStatus("active");
        lockRef.current.addEventListener("release", () => {
          lockRef.current = null;
          if (activeRef.current && document.visibilityState === "visible") {
            setStatus("blocked");
          } else if (activeRef.current) {
            setStatus("off");
          }
        });
      } catch {
        lockRef.current = null;
        setStatus(activeRef.current ? "blocked" : "off");
      }
    }

    function release() {
      lockRef.current?.release().catch(() => {});
      lockRef.current = null;
      if (!activeRef.current) setStatus("off");
    }

    function onVisibilityChange() {
      if (document.visibilityState === "visible" && activeRef.current) {
        acquire();
      }
    }

    if (active) {
      acquire();
      document.addEventListener("visibilitychange", onVisibilityChange);
    } else {
      release();
    }

    return () => {
      release();
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [active]);

  return status;
}
