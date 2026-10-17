import { createUcpInternal } from "./internal.js";
import { UcpError } from "./errors.js";
import type {
  UcpAddress,
  UcpApi,
  UcpCompleteResult,
  UcpMessage,
  UcpOffer,
  UcpRunner,
} from "./types.js";

export type { UcpAddress, UcpApi, UcpCompleteResult, UcpMessage, UcpOffer, UcpRunner };
export { UcpError };

export function createUcp(opts?: {
  mode?: "live" | "fixture";
  run?: UcpRunner;
  fixturesDir?: string;
  env?: NodeJS.ProcessEnv;
}): UcpApi {
  return createUcpInternal(opts ?? {}).api;
}
