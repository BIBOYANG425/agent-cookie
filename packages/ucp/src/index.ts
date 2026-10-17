import type { UcpApi, UcpModule, UcpOptions } from "@agent-cookie/contract";
import { createUcpInternal } from "./internal.js";

export function createUcp(opts: UcpOptions): UcpApi {
  return createUcpInternal(opts);
}

export const ucpModule: UcpModule = { createUcp };

export { parseSize, sizeMatches, toSystem } from "./size.js";
export type { Size } from "./size.js";
