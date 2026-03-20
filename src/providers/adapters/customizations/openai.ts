/**
 * OpenAI provider protocol.
 *
 * Extends the default protocol with OpenAI-specific differences:
 * - Uses `max_completion_tokens` instead of `max_tokens` (required by newer models).
 */

import type { ChatRequest } from "../../../shared/types";
import type { ProviderProtocol } from "../provider-protocol";
import { defaultProtocol } from "./default";

function buildRequestBody(request: ChatRequest): Record<string, unknown> {
  const body = defaultProtocol.buildRequestBody(request);
  // OpenAI's newer models (o1, o3, gpt-4.1, gpt-5.x) require max_completion_tokens.
  // It's backwards-compatible with older models, so we always use it.
  if ("max_tokens" in body) {
    body.max_completion_tokens = body.max_tokens;
    delete body.max_tokens;
  }
  return body;
}

export const openaiProtocol: ProviderProtocol = {
  ...defaultProtocol,
  buildRequestBody,
};
