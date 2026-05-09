/**
 * NativeVoiceBridge
 *
 * Hidden WebView used on iOS/Android to run the **WebSocket + Web Audio**
 * voice pipeline for providers other than `openai_realtime_webrtc`.
 *
 * The relay endpoints (`/api/realtime`, `/api/realtime/hume`,
 * `/api/realtime/deepgram-agent`, `/api/realtime/modular`) expect PCM16 mono
 * 24 kHz audio chunks framed exactly the way the web build sends them. Gemini
 * Live expects PCM16 mono 16 kHz, so this bridge switches capture rate based on
 * the relay URL. Rather than re-implementing PCM
 * capture and streaming playback in raw React Native, we host the existing
 * web pipeline inside a `<WebView>` and bridge JSON events both ways via
 * `postMessage`. This is the lowest-risk way to let native EAS builds honor
 * a venue's configured pipeline (Gemini, Deepgram, Hume, modular, …).
 *
 * Bridge protocol
 *   RN  → WebView (`postMessage`):
 *     { type: "connect", wsUrl }
 *     { type: "context_update", payload }
 *     { type: "interrupt" }
 *     { type: "disconnect" }
 *   WebView → RN (`window.ReactNativeWebView.postMessage`):
 *     { type: "ready" }
 *     { type: "ws_open" }
 *     { type: "ws_close", code?, reason?, wasClean? }
 *     { type: "ws_event", event }      ← raw realtime event JSON from upstream
 *     { type: "ws_error", message }
 *     { type: "log", message }
 */
import React, {
  forwardRef,
  useCallback,
  useImperativeHandle,
  useRef,
} from "react";
import { Platform, StyleSheet, View } from "react-native";
import { WebView, WebViewMessageEvent } from "react-native-webview";

export type BridgeOutgoing =
  | { type: "ready" }
  | { type: "ws_open" }
  | { type: "ws_close"; code?: number; reason?: string; wasClean?: boolean }
  | { type: "ws_event"; event: unknown }
  | { type: "ws_error"; message: string }
  | { type: "log"; message: string };

export interface NativeVoiceBridgeHandle {
  /** Open the WS to the given relay URL and begin streaming mic audio. */
  connect: (wsUrl: string) => void;
  /** Forward an arbitrary JSON message into the WS (e.g. x.context_update). */
  sendContext: (payload: unknown) => void;
  /** Cancel the current response (`response.cancel`). */
  interrupt: () => void;
  /** Tear down WS + audio capture. */
  disconnect: () => void;
}

interface Props {
  active: boolean;
  onMessage: (msg: BridgeOutgoing) => void;
}

// ── HTML hosted inside the WebView ────────────────────────────────────────────
// Plain ES2017 — kept self-contained, no bundler. Mirrors the logic in
// VoiceAgentContext's web path (connectWebSocket / startWebAudioStream /
// scheduleWebAudioChunk). Communicates with the host via `RNPost(msg)`.
const BRIDGE_HTML = `<!doctype html>
<html><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no"/>
<title>VoyceLab native bridge</title>
</head>
<body style="margin:0;background:#000;color:#fff;font-family:system-ui;">
<script>
(function(){
  function RNPost(o){
    try { window.ReactNativeWebView.postMessage(JSON.stringify(o)); } catch (e) {}
  }
  function log(m){ RNPost({ type: "log", message: String(m) }); }

  var ws = null;
  var audioCtx = null;
  var mediaStream = null;
  var workletNode = null;
  var nextPlayTime = 0;
  var running = false;
  // captureRate = wire-format rate the relay expects (16k Gemini, 24k OpenAI/
  // Hume/Deepgram/modular). The actual AudioContext runs at the device-native
  // rate (typically 48k on iOS) because iOS WKWebView throws if you try to
  // pin a non-native rate. We resample mic frames to captureRate before
  // sending and resample inbound playback FROM playbackRate TO ctxRate.
  var captureRate = 24000;
  var playbackRate = 24000;
  var ctxRate = 0;

  // base64 helpers
  function abToB64(buf){
    var bytes = new Uint8Array(buf);
    var CHUNK = 0x8000;
    var bin = "";
    for (var i = 0; i < bytes.length; i += CHUNK) {
      bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
    }
    return btoa(bin);
  }
  function b64ToBytes(b64){
    var bin = atob(b64);
    var out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  // Linear-resample a Float32 PCM buffer.
  function resampleFloat32(input, srcRate, dstRate){
    if (!srcRate || !dstRate || srcRate === dstRate) return input;
    var ratio = srcRate / dstRate;
    var outLen = Math.max(1, Math.floor(input.length / ratio));
    var out = new Float32Array(outLen);
    for (var i = 0; i < outLen; i++) {
      var srcIdx = i * ratio;
      var i0 = Math.floor(srcIdx);
      var i1 = Math.min(i0 + 1, input.length - 1);
      var w = srcIdx - i0;
      out[i] = input[i0] * (1 - w) + input[i1] * w;
    }
    return out;
  }
  function f32ToPcm16B64(f32){
    var pcm = new Int16Array(f32.length);
    for (var i = 0; i < f32.length; i++) {
      var s = Math.max(-1, Math.min(1, f32[i]));
      pcm[i] = s < 0 ? Math.max(-32768, s * 32768) : Math.min(32767, s * 32767);
    }
    return abToB64(pcm.buffer);
  }
  function schedulePlayback(b64){
    if (!audioCtx) return;
    var bytes = b64ToBytes(b64);
    var i16 = new Int16Array(bytes.buffer, bytes.byteOffset, (bytes.length / 2) | 0);
    var f32 = new Float32Array(i16.length);
    for (var i = 0; i < i16.length; i++) f32[i] = i16[i] / 32768;
    var rate = ctxRate || audioCtx.sampleRate || 24000;
    var resampled = resampleFloat32(f32, playbackRate, rate);
    var buf = audioCtx.createBuffer(1, resampled.length, rate);
    buf.getChannelData(0).set(resampled);
    var src = audioCtx.createBufferSource();
    src.buffer = buf;
    src.connect(audioCtx.destination);
    var now = audioCtx.currentTime;
    var start = Math.max(now, nextPlayTime);
    src.start(start);
    nextPlayTime = start + buf.duration;
  }

  // Worklet captures Float32 frames at the device rate; main thread
  // resamples + PCM16-encodes before pushing to the WS so the worklet can
  // be reused across providers without rebuild.
  var WORKLET_SRC = ""
    + "class PcmProcessor extends AudioWorkletProcessor{"
    + "constructor(options){super();var opts=(options&&options.processorOptions)||{};this._frameSize=opts.frameSize||2048;this._buf=new Float32Array(this._frameSize);this._pos=0;this._active=true;"
    + "this.port.onmessage=(e)=>{if(e.data==='stop')this._active=false;};}"
    + "process(inputs){if(!this._active)return false;"
    + "var ch=inputs[0]&&inputs[0][0];if(!ch)return true;"
    + "for(var i=0;i<ch.length;i++){this._buf[this._pos++]=ch[i];"
    + "if(this._pos>=this._frameSize){"
    + "this.port.postMessage(this._buf.buffer,[this._buf.buffer]);"
    + "this._buf=new Float32Array(this._frameSize);this._pos=0;}}return true;}}"
    + "registerProcessor('pcm-processor',PcmProcessor);";

  function startCapture(){
    // Don't pass sampleRate to getUserMedia - iOS Safari ignores it and
    // some Android stacks throw OverconstrainedError. Accept whatever the
    // device gives us and resample in JS.
    return navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true }
    }).then(function(stream){
      mediaStream = stream;
      var src = audioCtx.createMediaStreamSource(stream);
      var blob = new Blob([WORKLET_SRC], { type: "application/javascript" });
      var url = URL.createObjectURL(blob);
      var workletFrame = 2048;
      return audioCtx.audioWorklet.addModule(url).then(function(){
        URL.revokeObjectURL(url);
        var w = new AudioWorkletNode(audioCtx, "pcm-processor", { processorOptions: { frameSize: workletFrame } });
        workletNode = w;
        w.port.onmessage = function(e){
          if (!ws || ws.readyState !== 1) return;
          var f32 = new Float32Array(e.data);
          var resampled = resampleFloat32(f32, ctxRate, captureRate);
          var b64 = f32ToPcm16B64(resampled);
          ws.send(JSON.stringify({ type: "input_audio_buffer.append", audio: b64, sample_rate: captureRate }));
        };
        src.connect(w);
        // Connect worklet through a muted gain so it keeps running without
        // looping mic into the speakers.
        var sink = audioCtx.createGain();
        sink.gain.value = 0;
        w.connect(sink);
        sink.connect(audioCtx.destination);
        log("audio worklet streaming ctx=" + ctxRate + "Hz wire=" + captureRate + "Hz");
      }).catch(function(err){
        log("worklet failed, using ScriptProcessor: " + (err && err.message));
        var p = audioCtx.createScriptProcessor(2048, 1, 1);
        p.onaudioprocess = function(e){
          if (!ws || ws.readyState !== 1) return;
          var f32 = e.inputBuffer.getChannelData(0);
          var resampled = resampleFloat32(f32, ctxRate, captureRate);
          var b64 = f32ToPcm16B64(resampled);
          ws.send(JSON.stringify({ type: "input_audio_buffer.append", audio: b64, sample_rate: captureRate }));
        };
        src.connect(p);
        var sink = audioCtx.createGain();
        sink.gain.value = 0;
        p.connect(sink);
        sink.connect(audioCtx.destination);
      });
    });
  }

  function stopCapture(){
    try { if (workletNode) { workletNode.port.postMessage("stop"); workletNode.disconnect(); } } catch(e){}
    workletNode = null;
    if (mediaStream) {
      try { mediaStream.getTracks().forEach(function(t){ t.stop(); }); } catch(e){}
    }
    mediaStream = null;
    if (audioCtx) {
      try { audioCtx.close(); } catch(e){}
    }
    audioCtx = null;
    nextPlayTime = 0;
  }

  function doConnect(wsUrl){
    if (running) return;
    running = true;
    var isGemini = String(wsUrl || "").indexOf("/api/realtime/gemini") >= 0;
    captureRate = isGemini ? 16000 : 24000;
    playbackRate = 24000; // both relays emit 24k PCM back to the client
    try {
      // CRITICAL: do NOT pass sampleRate to AudioContext on iOS — WKWebView
      // throws if the requested rate doesn't match the hardware. Use the
      // device-native rate and resample in JS.
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      ctxRate = audioCtx.sampleRate;
      log("AudioContext opened at " + ctxRate + "Hz (wire=" + captureRate + "Hz)");
    } catch (e) {
      RNPost({ type: "ws_error", message: "AudioContext failed: " + (e && e.message) });
      running = false;
      return;
    }

    audioCtx.resume().catch(function(){});

    try { ws = new WebSocket(wsUrl); }
    catch (e) {
      RNPost({ type: "ws_error", message: "WS construct failed: " + (e && e.message) });
      running = false;
      return;
    }

    ws.onopen = function(){
      RNPost({ type: "ws_open" });
      startCapture().catch(function(err){
        RNPost({ type: "ws_error", message: "Mic failed: " + (err && err.message) });
      });
    };
    ws.onmessage = function(e){
      var data = e.data;
      var ev = null;
      try { ev = JSON.parse(typeof data === "string" ? data : ""); } catch (_) { return; }
      if (!ev) return;
      if (ev.type === "response.audio.delta") {
        var chunk = ev.delta || "";
        if (chunk) schedulePlayback(chunk);
      } else if (ev.type === "response.done") {
        nextPlayTime = 0;
      }
      RNPost({ type: "ws_event", event: ev });
    };
    ws.onerror = function(){
      RNPost({ type: "ws_error", message: "WebSocket error" });
    };
    ws.onclose = function(e){
      RNPost({ type: "ws_close", code: e && e.code, reason: (e && e.reason) || "", wasClean: !!(e && e.wasClean) });
      stopCapture();
      running = false;
    };
  }

  function doDisconnect(){
    running = false;
    try { if (ws && ws.readyState === 1) ws.close(); } catch(e){}
    ws = null;
    stopCapture();
  }

  function doInterrupt(){
    if (ws && ws.readyState === 1) {
      try { ws.send(JSON.stringify({ type: "response.cancel" })); } catch(e){}
    }
    nextPlayTime = 0;
  }

  function doSendContext(payload){
    if (ws && ws.readyState === 1) {
      try { ws.send(JSON.stringify(payload)); } catch(e){ log("send ctx failed " + e.message); }
    }
  }

  function onHostMessage(raw){
    var msg = null;
    try { msg = JSON.parse(raw); } catch(_) { return; }
    if (!msg || !msg.type) return;
    switch (msg.type) {
      case "connect":      doConnect(String(msg.wsUrl || "")); break;
      case "disconnect":   doDisconnect(); break;
      case "interrupt":    doInterrupt(); break;
      case "context_update": doSendContext(msg.payload); break;
    }
  }

  // Both Android and iOS RNWebView dispatch host messages here:
  document.addEventListener("message", function(e){ onHostMessage(e.data); });
  window.addEventListener("message", function(e){ onHostMessage(e.data); });

  RNPost({ type: "ready" });
})();
</script>
</body></html>`;

export const NativeVoiceBridge = forwardRef<NativeVoiceBridgeHandle, Props>(
  function NativeVoiceBridge({ active, onMessage }, ref) {
    const wvRef = useRef<WebView>(null);

    const send = useCallback((msg: object) => {
      const json = JSON.stringify(msg);
      // postMessage from RN → WebView using injectJavaScript so it works on
      // both iOS and Android consistently. The WebView then dispatches a
      // synthetic `message` event we listen for.
      wvRef.current?.injectJavaScript(
        `(function(){var m=${JSON.stringify(json)};` +
          `var ev=new MessageEvent("message",{data:m});` +
          `document.dispatchEvent(ev);window.dispatchEvent(ev);})();true;`,
      );
    }, []);

    useImperativeHandle(
      ref,
      () => ({
        connect: (wsUrl: string) => send({ type: "connect", wsUrl }),
        disconnect: () => send({ type: "disconnect" }),
        interrupt: () => send({ type: "interrupt" }),
        sendContext: (payload: unknown) => send({ type: "context_update", payload }),
      }),
      [send],
    );

    const handleMessage = useCallback(
      (e: WebViewMessageEvent) => {
        let parsed: BridgeOutgoing | null = null;
        try { parsed = JSON.parse(e.nativeEvent.data) as BridgeOutgoing; } catch { return; }
        if (parsed) onMessage(parsed);
      },
      [onMessage],
    );

    if (!active) return null;

    // The WebView must remain mounted (not just `display:none`) while a
    // session is live so the JS audio context keeps running. We keep it
    // 1×1 and absolute-positioned so it never affects layout. A non-zero
    // size is required on iOS for `getUserMedia` and audio to keep
    // working in the background of the native UI.
    return (
      <View style={styles.host} pointerEvents="none">
        <WebView
          ref={wvRef}
          source={{ html: BRIDGE_HTML, baseUrl: "https://localhost/" }}
          originWhitelist={["*"]}
          javaScriptEnabled
          domStorageEnabled
          allowsInlineMediaPlayback
          mediaPlaybackRequiresUserAction={false}
          // iOS 15+: silently grant mic permission inside the WebView.
          // Android: grant mic permission requests automatically. The
          // `onPermissionRequest` prop isn't in the public type but is
          // honored at runtime by react-native-webview's Android impl.
          {...({
            ...(Platform.OS === "ios" ? { mediaCapturePermissionGrantType: "grant" } : {}),
            onPermissionRequest: (event: any) => {
              try { event?.grant?.(event?.resources ?? []); } catch {}
            },
          } as any)}
          onMessage={handleMessage}
          style={styles.webview}
          mixedContentMode="always"
          setSupportMultipleWindows={false}
          androidLayerType="hardware"
        />
      </View>
    );
  },
);

const styles = StyleSheet.create({
  host: {
    position: "absolute",
    width: 1,
    height: 1,
    opacity: 0,
    left: -10,
    top: -10,
  },
  webview: { flex: 1, backgroundColor: "transparent" },
});
