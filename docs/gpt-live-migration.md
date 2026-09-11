# GPT-Live 1 voice migration

VoyceLab uses `gpt-live-1` for the PWA, dashboard demo, server voice relay,
and voice previews. This implements the Live API protocol rather than changing
the model name on a Realtime request.

## Configuration

Reuse the server's existing `OPENAI_API_KEY`. It must have access to GPT-Live 1
and the delegated backend model. `OPENAI_LIVE_BACKEND_MODEL` defaults to
`gpt-5.6-terra`; this model reasons about business tasks and calls commands while
GPT-Live handles listening and speaking. API keys never reach the browser.

The persisted `openai_realtime_webrtc` and `openai_realtime_server_ws` identifiers
remain compatible with saved profiles. Saved native Gemini/Grok profiles resolve
to the OpenAI server relay; unsupported voice names resolve to Marin. Valid
OpenAI and custom voice IDs are retained. No database migration is required.
Text and browser accessibility fallbacks remain available.

## Protocol and behavior

- WebRTC clients submit a complete audio SDP offer to VoyceLab. The server creates
  a session at `/v1/live/sessions` and returns its SDP answer. No ephemeral-token
  or `/v1/realtime/calls` handshake remains in the active browser paths.
- WebSocket sessions send `session.start` and wait for `session.started` before
  forwarding microphone audio. PCM audio is mono, 24 kHz.
- Business instructions and function definitions belong to `delegation.responses`.
  The speech model receives a short persona and delegation policy.
- The shared protocol collects named function calls from `response.event`
  envelopes. It waits for the response to complete, sends each function result,
  and resumes the backend once per batch. Confirmation gates hold their result
  until the user confirms or cancels. Duplicate and stale results are ignored.
- Speech captions and playback are independent of backend response completion.
  Interruption affects speech, not an already-authorized Square operation.
- Live uses continuous full-duplex audio. Realtime VAD, transcription, speed,
  and response-cancellation settings are not sent. Pace becomes an instruction.
- Idle prewarming is disabled: connected time includes silence. Shutdown waits
  up to two seconds for `session.closed`; the relay uses finalized provider
  seconds when available and elapsed time if the transport fails first.

Subscription prices, command authorization, Square integration, and confirmation
policies are preserved. Live session time and backend token usage are separate
provider charges; recheck margins against actual usage before changing prices.

## Verification

Run `pnpm build:railway`, `pnpm --filter @workspace/voicelab-client test`,
`pnpm --filter @workspace/voicelab-core test`, and
`pnpm --filter @workspace/api-server test`.

With the existing deployment credentials available, run the API package's
`check:live-voice-providers` and `check:live-voice-turns` scripts. The first checks
startup and finalization; the second requires audible PCM and final usage.
Then exercise a browser conversation, an interruption, a delegated read-only
command, and a confirmation/cancellation against a sandbox venue. Automated
protocol checks do not establish audible quality or model access on deployment.

## OpenAI documentation

- [Live guide](https://developers.openai.com/api/docs/guides/live)
- [Migration](https://developers.openai.com/api/docs/guides/live-migration)
- [Delegation and commands](https://developers.openai.com/api/docs/guides/live-delegation)
- [Conversation lifecycle](https://developers.openai.com/api/docs/guides/live-conversations)
