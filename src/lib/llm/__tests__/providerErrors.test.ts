import { describe, expect, it } from "vitest";
import { APICallError } from "ai";
import { providerErrorCode } from "../providerErrors";

function apiError(statusCode: number, message: string, responseBody?: string) {
  return new APICallError({ message, url: "https://api.example.com", requestBodyValues: {}, statusCode, responseBody });
}

describe("providerErrorCode", () => {
  it("429 / 402 = kuota habis", () => {
    expect(providerErrorCode(apiError(429, "Too Many Requests"))).toBe("LLM_QUOTA_EXCEEDED");
    expect(providerErrorCode(apiError(402, "Insufficient Balance"))).toBe("LLM_QUOTA_EXCEEDED");
  });

  it("pesan kuota/kredit dengan status lain tetap terdeteksi", () => {
    const anthropic = apiError(400, "Your credit balance is too low to access the Anthropic API.");
    expect(providerErrorCode(anthropic)).toBe("LLM_QUOTA_EXCEEDED");
    const google = apiError(500, "error", '{"error":{"status":"RESOURCE_EXHAUSTED"}}');
    expect(providerErrorCode(google)).toBe("LLM_QUOTA_EXCEEDED");
  });

  it("401 / 403 / key tidak valid = key ditolak", () => {
    expect(providerErrorCode(apiError(401, "invalid x-api-key"))).toBe("LLM_KEY_INVALID");
    expect(providerErrorCode(apiError(403, "Forbidden"))).toBe("LLM_KEY_INVALID");
    expect(providerErrorCode(apiError(400, "API key not valid. Please pass a valid API key."))).toBe("LLM_KEY_INVALID");
  });

  it("error lain tetap di-retry seperti biasa", () => {
    expect(providerErrorCode(apiError(500, "Internal Server Error"))).toBeNull();
    expect(providerErrorCode(apiError(400, "maximum context length exceeded"))).toBeNull();
    expect(providerErrorCode(new Error("validation: bad output"))).toBeNull();
  });
});
