// Webhook URLs for the two backend workflows.
//
// INGEST_WEBHOOK_URL: receives the PDF once, right after upload.
//   multipart/form-data POST with a single binary field named "data".
//   Any 2xx response means the contract is indexed.
//
// CHAT_WEBHOOK_URL: receives just the user's question, once per chat turn.
//   multipart/form-data POST with a single field named "message".
//   Must reply with JSON: { "response": "...", "citation": ["..."], "reasoning": "..." }
//
// Both must allow cross-origin requests (CORS) from wherever this page is opened.
window.APP_CONFIG = {
  INGEST_WEBHOOK_URL: "https://anushka0501.app.n8n.cloud/webhook-test/b4b6d279-c2f0-4092-a2d5-9c874ec013d3",
  CHAT_WEBHOOK_URL: "https://anushka0501.app.n8n.cloud/webhook-test/b4b6d279-c2f0-4092-a2d5-9c874ec013d3"
};
