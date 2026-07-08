import type { ConnectedServiceProvider } from "@workspace/voicelab-core/connected-service";

const mockConnectorEnabled =
  process.env.VOYCELAB_ENABLE_MOCK_CONNECTOR === "true" ||
  process.env.NODE_ENV === "development" ||
  process.env.NODE_ENV === "test";
const genericRestConnectorEnabled = process.env.VOYCELAB_ENABLE_CUSTOM_REST_CONNECTOR === "true";

export function listImplementedProviders(): ConnectedServiceProvider[] {
  const providers: ConnectedServiceProvider[] = ["square"];
  if (mockConnectorEnabled) providers.push("mock");
  if (genericRestConnectorEnabled) providers.push("generic_rest");
  return providers;
}
