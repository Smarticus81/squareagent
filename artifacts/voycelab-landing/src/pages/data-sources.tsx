import { useLayoutEffect } from "react";
import { useLocation } from "wouter";

/**
 * Data Sources -- now merged into the Integrations page (/services).
 * This component redirects for backward compatibility.
 */
export default function DataSources() {
  const [, setLocation] = useLocation();
  useLayoutEffect(() => {
    const search = typeof window !== "undefined" ? window.location.search : "";
    const hash = typeof window !== "undefined" ? window.location.hash : "";
    setLocation(`/services${search}${hash}`, { replace: true });
  }, [setLocation]);
  return null;
}
