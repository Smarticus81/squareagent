import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Linking,
  SafeAreaView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { StatusBar } from "expo-status-bar";
import { activateKeepAwakeAsync, deactivateKeepAwake } from "expo-keep-awake";
import Constants from "expo-constants";
import { WebView } from "react-native-webview";
import type { WebViewNavigation } from "react-native-webview";

const BRAND_BG = "#FBF7F1";
const BRAND_INK = "#0E1B2C";
const BRAND_ACCENT = "#FF6B47";
const KEEP_AWAKE_TAG = "voycelab-session";

function resolvePwaUrl(): string {
  const fromExtra = (Constants.expoConfig?.extra as { pwaUrl?: string } | undefined)?.pwaUrl;
  const url = (fromExtra && fromExtra.trim().length > 0 ? fromExtra : "https://www.voycelab.com/agent/").trim();
  return url.endsWith("/") ? url : `${url}/`;
}

// Injected after load: mirrors the PWA's data-theme attribute out to the
// native shell so the status bar and chrome follow the in-app theme toggle.
const INJECTED_THEME_SYNC = `
  (function () {
    try {
      var post = function () {
        if (window.ReactNativeWebView) {
          window.ReactNativeWebView.postMessage(JSON.stringify({
            type: 'theme',
            value: document.documentElement.getAttribute('data-theme') || 'light',
          }));
        }
      };
      new MutationObserver(post).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
      post();
    } catch (e) {}
    true;
  })();
`;

// Injected before page scripts run so the embedded PWA behaves like a native
// app: locks zoom, removes long-press callouts, and disables overscroll bounce.
const INJECTED_BEFORE_LOAD = `
  (function () {
    try {
      var meta = document.querySelector('meta[name=viewport]');
      if (!meta) {
        meta = document.createElement('meta');
        meta.setAttribute('name', 'viewport');
        document.head.appendChild(meta);
      }
      meta.setAttribute('content', 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover');
      var style = document.createElement('style');
      style.innerHTML = 'html,body{overscroll-behavior:none;-webkit-touch-callout:none;-webkit-user-select:none;} *{-webkit-tap-highlight-color:transparent;}';
      document.documentElement.appendChild(style);
    } catch (e) {}
    true;
  })();
`;

export default function App() {
  const pwaUrl = useMemo(resolvePwaUrl, []);
  const pwaHost = useMemo(() => {
    try {
      return new URL(pwaUrl).host;
    } catch {
      return "";
    }
  }, [pwaUrl]);
  const webRef = useRef<WebView>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [webUrl, setWebUrl] = useState(pwaUrl);
  const [theme, setTheme] = useState<"light" | "dark">("light");

  // Venue POS surface: keep the display awake the entire time the app is open.
  useEffect(() => {
    void activateKeepAwakeAsync(KEEP_AWAKE_TAG);
    return () => {
      void deactivateKeepAwake(KEEP_AWAKE_TAG);
    };
  }, []);

  // Map an incoming deep link (voycelab:// scheme or a universal link into
  // /agent/) onto the embedded PWA, preserving launch params like
  // ?code=…&agentProfileId=… minted by the dashboard's "Open assistant".
  const toWebUrl = useCallback(
    (link: string | null): string | null => {
      if (!link) return null;
      const [base, query = ""] = link.split("?");
      const isScheme = base.startsWith("voycelab://");
      const isAgentLink = pwaHost && base.startsWith("http") && base.includes(`${pwaHost}/agent`);
      if (!isScheme && !isAgentLink) return null;
      return query ? `${pwaUrl}?${query}` : pwaUrl;
    },
    [pwaUrl, pwaHost],
  );

  useEffect(() => {
    void Linking.getInitialURL().then((link) => {
      const mapped = toWebUrl(link);
      if (mapped) setWebUrl(mapped);
    });
    const sub = Linking.addEventListener("url", ({ url }) => {
      const mapped = toWebUrl(url);
      if (mapped) {
        setFailed(false);
        setWebUrl(mapped);
        setReloadKey((k) => k + 1);
      }
    });
    return () => sub.remove();
  }, [toWebUrl]);

  const onShouldStartLoadWithRequest = useCallback(
    (request: WebViewNavigation) => {
      const target = request.url;
      if (target.startsWith("http") && pwaHost && !target.includes(pwaHost)) {
        // Square OAuth must stay inside the WebView: its redirect chain ends
        // back on our host, which a system-browser detour can never deliver
        // into this app's session.
        if (/(^https:\/\/)([\w-]+\.)*squareup(sandbox)?\.com\//i.test(target)) {
          return true;
        }
        // Route other third-party auth flows (Clerk, Google) to the system
        // browser — several of them refuse to run embedded.
        if (/oauth|auth|accounts|login|checkout|billing/i.test(target)) {
          void Linking.openURL(target);
          return false;
        }
      }
      return true;
    },
    [pwaHost],
  );

  const reload = useCallback(() => {
    setFailed(false);
    setLoading(true);
    setReloadKey((k) => k + 1);
  }, []);

  const chromeBg = theme === "dark" ? "#07080A" : BRAND_BG;

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: chromeBg }]}>
      <StatusBar style={theme === "dark" ? "light" : "dark"} />
      {failed ? (
        <View style={styles.center}>
          <Text style={styles.title}>VoyceLab</Text>
          <Text style={styles.message}>Couldn't reach the assistant. Check your connection and try again.</Text>
          <TouchableOpacity style={styles.button} onPress={reload} accessibilityRole="button">
            <Text style={styles.buttonText}>Retry</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <WebView
          key={reloadKey}
          ref={webRef}
          source={{ uri: webUrl }}
          style={[styles.web, { backgroundColor: chromeBg }]}
          originWhitelist={["*"]}
          javaScriptEnabled
          domStorageEnabled
          sharedCookiesEnabled
          thirdPartyCookiesEnabled
          allowsInlineMediaPlayback
          mediaPlaybackRequiresUserAction={false}
          mediaCapturePermissionGrantType="grant"
          allowsProtectedMedia
          allowsBackForwardNavigationGestures
          pullToRefreshEnabled={false}
          bounces={false}
          keyboardDisplayRequiresUserAction={false}
          setSupportMultipleWindows={false}
          injectedJavaScriptBeforeContentLoaded={INJECTED_BEFORE_LOAD}
          injectedJavaScript={INJECTED_THEME_SYNC}
          onMessage={(e) => {
            try {
              const msg = JSON.parse(e.nativeEvent.data) as { type?: string; value?: string };
              if (msg?.type === "theme") setTheme(msg.value === "dark" ? "dark" : "light");
            } catch {
              // ignore unrecognized messages
            }
          }}
          onShouldStartLoadWithRequest={onShouldStartLoadWithRequest}
          onLoadStart={() => setLoading(true)}
          onLoadEnd={() => setLoading(false)}
          onError={() => {
            setLoading(false);
            setFailed(true);
          }}
          onHttpError={(e) => {
            if (e.nativeEvent.statusCode >= 500) {
              setLoading(false);
              setFailed(true);
            }
          }}
          onContentProcessDidTerminate={() => {
            // iOS reclaims the WKWebView content process under memory pressure
            // (routine for an always-on venue screen) — without this the app is
            // left showing a dead white view until force-quit.
            reload();
          }}
          onRenderProcessGone={() => {
            reload();
          }}
          allowsAirPlayForMediaPlayback
          applicationNameForUserAgent="VoyceLabApp"
        />
      )}
      {loading && !failed ? (
        <View style={[styles.loader, { backgroundColor: chromeBg }]} pointerEvents="none">
          <ActivityIndicator size="large" color={BRAND_ACCENT} />
        </View>
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: BRAND_BG },
  web: { flex: 1, backgroundColor: BRAND_BG },
  loader: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: BRAND_BG,
  },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 32, backgroundColor: BRAND_BG },
  title: { fontSize: 28, fontWeight: "800", color: BRAND_INK, marginBottom: 12 },
  message: { fontSize: 16, color: BRAND_INK, textAlign: "center", opacity: 0.8, marginBottom: 24 },
  button: { backgroundColor: BRAND_ACCENT, paddingHorizontal: 28, paddingVertical: 14, borderRadius: 14 },
  buttonText: { color: "#fff", fontSize: 16, fontWeight: "700" },
});
