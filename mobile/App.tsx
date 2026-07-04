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

  // Venue POS surface: keep the display awake the entire time the app is open.
  useEffect(() => {
    void activateKeepAwakeAsync(KEEP_AWAKE_TAG);
    return () => {
      void deactivateKeepAwake(KEEP_AWAKE_TAG);
    };
  }, []);

  const onShouldStartLoadWithRequest = useCallback(
    (request: WebViewNavigation) => {
      const target = request.url;
      if (target.startsWith("http") && pwaHost && !target.includes(pwaHost)) {
        // Route third-party auth flows (Square OAuth, Clerk, Google) to the
        // system browser so their redirects complete correctly.
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

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar style="dark" />
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
          source={{ uri: pwaUrl }}
          style={styles.web}
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
          allowsAirPlayForMediaPlayback
          applicationNameForUserAgent="VoyceLabApp"
        />
      )}
      {loading && !failed ? (
        <View style={styles.loader} pointerEvents="none">
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
