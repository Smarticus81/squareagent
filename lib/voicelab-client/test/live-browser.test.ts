import { afterEach, expect, it, vi } from "vitest";
import { closeLiveChannel, createLiveOffer } from "../src/live-browser";

afterEach(() => vi.useRealTimers());

it("waits for ICE candidates and returns the complete local SDP", async () => {
  const peer = Object.assign(new EventTarget(), {
    iceGatheringState: "gathering",
    localDescription: { sdp: "incomplete" },
    createOffer: async () => ({ type: "offer", sdp: "incomplete" }),
    setLocalDescription: async () => {},
  });
  let resolved = false;
  const offer = createLiveOffer(peer as unknown as RTCPeerConnection).then(sdp => { resolved = true; return sdp; });
  await Promise.resolve();
  await Promise.resolve();
  expect(resolved).toBe(false);
  peer.localDescription = { sdp: "complete-with-candidates" };
  peer.iceGatheringState = "complete";
  peer.dispatchEvent(new Event("icegatheringstatechange"));
  expect(await offer).toBe("complete-with-candidates");
});

it("listens for finalization before sending close, even for an immediate reply", async () => {
  const channel = Object.assign(new EventTarget(), {
    readyState: "open",
    send: vi.fn((raw: string) => {
      expect(JSON.parse(raw)).toEqual({ type: "session.close" });
      channel.dispatchEvent(new MessageEvent("message", { data: JSON.stringify({ type: "session.closed", usage: { seconds: 12 } }) }));
    }),
  });
  await closeLiveChannel(channel as unknown as RTCDataChannel);
  expect(channel.send).toHaveBeenCalledTimes(1);
});

it("bounds graceful shutdown when finalization is missing", async () => {
  vi.useFakeTimers();
  const channel = Object.assign(new EventTarget(), { readyState: "open", send: vi.fn() });
  let closed = false;
  const closing = closeLiveChannel(channel as unknown as RTCDataChannel).then(() => { closed = true; });
  await vi.advanceTimersByTimeAsync(1999);
  expect(closed).toBe(false);
  await vi.advanceTimersByTimeAsync(1);
  await closing;
  expect(closed).toBe(true);
});
