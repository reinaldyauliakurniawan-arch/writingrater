import "server-only";

export function serverEnv() {
  return {
    adminEmails: (process.env.ADMIN_EMAILS ?? "")
      .split(",")
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean),
    settingsEncryptionKey: process.env.SETTINGS_ENCRYPTION_KEY ?? "",
    uploadDir: process.env.UPLOAD_DIR || "storage/uploads",
    llmProvider: process.env.LLM_PROVIDER ?? "",
    llmModel: process.env.LLM_MODEL ?? "",
    llmApiKey: process.env.LLM_API_KEY ?? "",
    llmBaseUrl: process.env.LLM_BASE_URL ?? "",
    llmMock: process.env.LLM_MOCK === "true",
  };
}

export function isAdminEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  return serverEnv().adminEmails.includes(email.toLowerCase());
}
