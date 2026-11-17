# Contract Review

A simple web app for reviewing a contract with a chat assistant. Upload a PDF on the left, ask questions on the right, and get answers with supporting citations from the contract.

Built with plain HTML, CSS and JavaScript. No frameworks, no npm, no build step.

## Key features

- **PDF upload and preview** — click or drag and drop a PDF; it displays in the left panel so you can read it while you chat.
- **Chat panel** — ask questions about the contract in the right panel. Both panels stay visible side by side and scroll independently.
- **Webhook-powered answers** — your question and the PDF are sent to an n8n webhook. The reply is shown as the answer, with the **citations** (supporting clauses) and a short **reasoning** beneath it.
- **Clear feedback** — typing indicator while waiting, friendly error messages, and a prompt to upload a PDF first if none is loaded.
- **Navy and orange design** — clean, responsive layout that stacks on small screens.

## Run it locally

1. Download or clone this repository:
   ```bash
   git clone https://github.com/anushka2423/contract-review-app.git
   cd contract-review-app
   ```
2. Open `index.html` in your browser (double-click it, or run `open index.html` on macOS).

That's it. If your browser blocks the webhook call when opening the file directly, serve the folder instead:

```bash
python3 -m http.server 8000
```

then visit http://localhost:8000.

## Webhook setup

The webhook URL is set at the top of [app.js](app.js) (`WEBHOOK_URL`). Each request is a `multipart/form-data` POST with two fields:

| Field     | Content                       |
|-----------|-------------------------------|
| `file`    | the uploaded PDF              |
| `message` | the user's chat message       |

The webhook must return JSON in this shape:

```json
{
  "response": "Answer based only on the contract",
  "citation": ["Section 2: exact supporting clause text"],
  "reasoning": "1-2 sentences on how the citations support the answer"
}
```

Notes:

- `citation` is always an array (empty if nothing relevant was found).
- If the contract doesn't contain the answer, `response` is `"This information is not mentioned in the contract."`, `citation` is `[]` and `reasoning` is `""`.
- n8n `webhook-test/...` URLs only work while the workflow is listening. Use the production `/webhook/...` URL once the workflow is active.
- The n8n Webhook node must allow cross-origin requests (CORS) from wherever you open the app.

## Files

- `index.html` — page structure
- `styles.css` — styling
- `app.js` — upload, preview, chat and webhook logic
