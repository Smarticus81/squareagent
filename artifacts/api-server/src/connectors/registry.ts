import type {
  ConnectedServiceAdapter,
  ConnectedServiceProvider,
  ServiceConnection,
} from "@workspace/voicelab-core/connected-service";
import { CONNECTED_SERVICE_PROVIDERS } from "@workspace/voicelab-core/connected-service";
import { SquareAdapter } from "./square/adapter";
import { MockAdapter } from "./mock/adapter";
import { GenericRestAdapter } from "./generic-rest/adapter";

const mockConnectorEnabled =
  process.env.VOYCELAB_ENABLE_MOCK_CONNECTOR === "true" ||
  process.env.NODE_ENV === "development" ||
  process.env.NODE_ENV === "test";
const genericRestConnectorEnabled = process.env.VOYCELAB_ENABLE_CUSTOM_REST_CONNECTOR === "true";

const adapters: Partial<Record<ConnectedServiceProvider, ConnectedServiceAdapter>> = {
  square: new SquareAdapter(),
};

if (mockConnectorEnabled) {
  adapters.mock = new MockAdapter();
}

if (genericRestConnectorEnabled) {
  adapters.generic_rest = new GenericRestAdapter();
}

export class ConnectedServiceUnavailableError extends Error {
  readonly provider: ConnectedServiceProvider;
  constructor(provider: ConnectedServiceProvider) {
    const meta = CONNECTED_SERVICE_PROVIDERS[provider];
    super(
      `Connected service "${meta.displayName}" (${provider}) is ${meta.status}: ${meta.notes ?? "no adapter implemented"}`,
    );
    this.name = "ConnectedServiceUnavailableError";
    this.provider = provider;
  }
}

export function getConnectedServiceAdapter(
  provider: ConnectedServiceProvider,
): ConnectedServiceAdapter {
  const adapter = adapters[provider];
  if (!adapter) throw new ConnectedServiceUnavailableError(provider);
  return adapter;
}

export function getConnectedServiceAdapterFor(
  connection: ServiceConnection,
): ConnectedServiceAdapter {
  return getConnectedServiceAdapter(connection.provider);
}

export function listImplementedProviders(): ConnectedServiceProvider[] {
  return Object.keys(adapters) as ConnectedServiceProvider[];
}
