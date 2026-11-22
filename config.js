// Set this to your webhook URL. The app sends it a multipart/form-data POST with:
//   file    - the uploaded contract (PDF)
//   message - the user's chat message
// The webhook must reply with JSON: { "response": "...", "citation": ["..."], "reasoning": "..." }
// and must allow cross-origin requests (CORS) from wherever this page is opened.
window.APP_CONFIG = {
  WEBHOOK_URL: "<Your Webhook URL>"
};
