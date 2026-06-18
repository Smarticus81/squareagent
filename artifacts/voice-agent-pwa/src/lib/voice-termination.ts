export {
  type TerminationKind,
  normalizeVoiceUtterance,
  HARD_SHUTDOWN_PHRASES,
  SOFT_BACK_TO_WAKE_PHRASES,
  STANDALONE_SOFT_PHRASES,
  phraseInText,
  matchesStandalonePhrase,
  type MatchTerminationOptions,
  matchTermination,
  matchWakeWord,
} from "@workspace/voicelab-client/voice-termination";
