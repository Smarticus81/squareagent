import { useEffect, useRef } from "react";

/**
 * Keeps the screen on while `active` is true using the Screen Wake Lock API.
 * Re-acquires the lock when the tab regains visibility (browsers release it
 * automatically when the tab is hidden). Falls back silently on unsupported
 * browsers or when the OS denies the request (e.g. low battery).
 */
export function useWakeLock(active: boolean): void {
  const lockRef = useRef<WakeLockSentinel | null>(null);
  const activeRef = useRef(active);
  activeRef.current = active;

  useEffect(() => {
    if (!("wakeLock" in navigator)) return;

    async function acquire() {
      if (lockRef.current) return;
      try {
        lockRef.current = await navigator.wakeLock.request("screen");
        lockRef.current.addEventListener("release", () => {
          lockRef.current = null;
        });
      } catch {
        lockRef.current = null;
      }
    }

    function release() {
      lockRef.current?.release().catch(() => {});
      lockRef.current = null;
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
}
