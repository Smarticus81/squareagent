/** Wait for the complete SDP required by the Live HTTP handshake. */
export async function createLiveOffer(pc: RTCPeerConnection): Promise<string> {
  await pc.setLocalDescription(await pc.createOffer());
  if (pc.iceGatheringState !== "complete") await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => { cleanup(); reject(new Error("Voice connection timed out gathering network candidates")); }, 10000);
    const check = () => { if (pc.iceGatheringState === "complete") { cleanup(); resolve(); } };
    const cleanup = () => { clearTimeout(timer); pc.removeEventListener("icegatheringstatechange", check); };
    pc.addEventListener("icegatheringstatechange", check);
    check();
  });
  if (!pc.localDescription?.sdp) throw new Error("Voice connection did not produce an SDP offer");
  return pc.localDescription.sdp;
}

/** Observe actual remote audio energy; Live has no spoken-response-done event. */
export function observeLivePlayback(stream: MediaStream, onSpeaking: (speaking: boolean) => void): () => void {
  const context = new AudioContext();
  void context.resume();
  const source = context.createMediaStreamSource(stream);
  const analyser = context.createAnalyser();
  analyser.fftSize = 512;
  source.connect(analyser);
  const samples = new Float32Array(analyser.fftSize);
  let lastAudio = 0;
  let wasSpeaking = false;
  const timer = setInterval(() => {
    analyser.getFloatTimeDomainData(samples);
    const energy = Math.sqrt(samples.reduce((sum, value) => sum + value * value, 0) / samples.length);
    if (energy > 0.008) lastAudio = Date.now();
    const speaking = Date.now() - lastAudio < 300;
    if (speaking !== wasSpeaking) { wasSpeaking = speaking; onSpeaking(speaking); }
  }, 60);
  return () => { clearInterval(timer); source.disconnect(); void context.close(); };
}

export function closeLiveChannel(channel: RTCDataChannel | null): Promise<void> {
  if (channel?.readyState !== "open") return Promise.resolve();
  return new Promise(resolve => {
    const finish = () => { clearTimeout(timer); channel.removeEventListener("message", onMessage); channel.removeEventListener("close", finish); resolve(); };
    const onMessage = (message: MessageEvent) => { try { if (JSON.parse(message.data).type === "session.closed") finish(); } catch {} };
    const timer = setTimeout(finish, 2000);
    channel.addEventListener("message", onMessage);
    channel.addEventListener("close", finish);
    channel.send(JSON.stringify({ type: "session.close" }));
  });
}
