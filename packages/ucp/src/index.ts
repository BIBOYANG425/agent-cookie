import type { UcpApi, UcpModule, UcpOptions } from "@agent-cookie/contract";
import { createUcpInternal } from "./internal.js";

export function createUcp(opts: UcpOptions): UcpApi {
  return createUcpInternal(opts);
}

export const ucpModule: UcpModule = { createUcp };
