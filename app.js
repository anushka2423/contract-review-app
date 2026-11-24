(function () {
  "use strict";

  var CONFIG = window.APP_CONFIG || {};
  var INGEST_WEBHOOK_URL = String(CONFIG.INGEST_WEBHOOK_URL || "").trim(); // takes the PDF once, after upload
  var CHAT_WEBHOOK_URL = String(CONFIG.CHAT_WEBHOOK_URL || "").trim(); // takes just the message, per turn
  var REQUEST_TIMEOUT_MS = 120000; // retrieval + answering can be slow
  var INGEST_TIMEOUT_MS = 300000; // splitting and embedding a long contract can be slower still

  // Elements
  var layout = document.getElementById("layout");
  var viewBtns = document.querySelectorAll(".view-btn");
  var crumb = document.getElementById("crumb");
  var crumbDoc = document.getElementById("crumb-doc");

  var contractBody = document.getElementById("contract-body");
  var emptyDoc = document.getElementById("empty-doc");
  var dropzone = document.getElementById("dropzone");
  var fileInput = document.getElementById("file-input");
  var uploadError = document.getElementById("upload-error");
  var viewer = document.getElementById("pdf-viewer");
  var viewFallback = document.getElementById("viewer-fallback");
  var fallbackLink = document.getElementById("fallback-link");
  var fileNameEl = document.getElementById("file-name");
  var fileSizeEl = document.getElementById("file-size");
  var fileActions = document.getElementById("file-actions");
  var openLink = document.getElementById("open-link");
  var replaceBtn = document.getElementById("replace-file");
  var removeBtn = document.getElementById("remove-file");
  var docBadge = document.getElementById("doc-badge");
  var docProgress = document.getElementById("doc-progress");

  var chatForm = document.getElementById("chat-form");
  var chatInput = document.getElementById("chat-input");
  var composerBox = document.getElementById("composer-box");
  var sendBtn = document.getElementById("send-button");
  var messages = document.getElementById("messages");
  var emptyState = document.getElementById("empty-state");
  var emptyTitle = document.getElementById("empty-title");
  var emptySub = document.getElementById("empty-sub");
  var suggestions = document.getElementById("suggestions");
  var jumpBtn = document.getElementById("jump-latest");
  var assistantBadge = document.getElementById("assistant-badge");

  var ingestStatus = document.getElementById("ingest-status");
  var ingestText = document.getElementById("ingest-text");
  var ingestRetry = document.getElementById("ingest-retry");

  var currentUrl = null;
  var currentFile = null; // the uploaded contract (kept so a failed ingestion can be retried)
  var busy = false; // true while a chat request is in flight
  var contractReady = false; // true once the ingestion webhook has accepted the contract
  var ingestController = null; // aborts an ingestion that is still running
  var ingestToken = 0; // lets a late response from a replaced upload be ignored
  var ingestState = ""; // "", "loading", "ready" or "error" (what the UI shows)

  /* ---------- Small helpers ---------- */

  function el(tag, className) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    return node;
  }

  // Static icon markup only; never built from user or AI text
  function icon(path, size) {
    var span = el("span", "icon");
    span.setAttribute("aria-hidden", "true");
    span.innerHTML =
      '<svg width="' + size + '" height="' + size + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
      'stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">' + path + "</svg>";
    return span;
  }

  var ICONS = {
    chevron: '<path d="m6 9 6 6 6-6"/>',
    copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h9"/>',
    check: '<path d="m5 12 5 5 9-10"/>',
    sparkle: '<path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/>'
  };

  // tone: "" (hidden), "info", "success", "danger" or "neutral"
  function setBadge(node, tone, text, busyDot) {
    node.hidden = !tone;
    node.className = "badge" + (tone ? " badge-" + tone : "") + (busyDot ? " is-busy" : "");
    node.textContent = text || "";
  }

  function setView(view) {
    layout.setAttribute("data-view", view);
    viewBtns.forEach(function (btn) {
      btn.setAttribute("aria-pressed", String(btn.getAttribute("data-view") === view));
    });
  }

  viewBtns.forEach(function (btn) {
    btn.addEventListener("click", function () {
      setView(btn.getAttribute("data-view"));
    });
  });

  /* ---------- Contract upload and preview ---------- */

  function showError(msg) {
    uploadError.textContent = msg;
    uploadError.hidden = !msg;
  }

  function isPdf(file) {
    return file.type === "application/pdf" || /\.pdf$/i.test(file.name);
  }

  function formatSize(bytes) {
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1024 * 1024) return Math.round(bytes / 1024) + " KB";
    return (bytes / (1024 * 1024)).toFixed(1) + " MB";
  }

  function loadFile(file) {
    if (!file) return;
    if (!isPdf(file)) {
      showError("That file isn't a PDF. Please choose a .pdf file.");
      return;
    }
    showError("");

    if (currentUrl) URL.revokeObjectURL(currentUrl);
    currentUrl = URL.createObjectURL(file);
    currentFile = file;

    // The browser's built-in PDF viewer renders inside the iframe and scrolls
    // on its own, independent of the assistant pane.
    viewer.src = currentUrl;
    viewer.hidden = false;
    emptyDoc.hidden = true;
    contractBody.classList.add("has-file");

    fileNameEl.textContent = file.name;
    fileNameEl.title = file.name;
    fileSizeEl.textContent = "PDF · " + formatSize(file.size);
    crumbDoc.textContent = file.name;
    crumbDoc.title = file.name;
    crumb.hidden = false;
    openLink.href = currentUrl;
    fallbackLink.href = currentUrl;
    viewFallback.hidden = false;
    fileActions.hidden = false;

    // Allow re-selecting the same file later
    fileInput.value = "";

    // Index the contract right away; chat stays disabled until this succeeds
    ingestContract(file);
  }

  function clearFile() {
    cancelIngestion();
    setIngestStatus("");
    if (currentUrl) URL.revokeObjectURL(currentUrl);
    currentUrl = null;
    currentFile = null;
    viewer.removeAttribute("src");
    viewer.hidden = true;
    viewFallback.hidden = true;
    emptyDoc.hidden = false;
    contractBody.classList.remove("has-file");
    fileActions.hidden = true;
    fileNameEl.textContent = "No contract loaded";
    fileNameEl.removeAttribute("title");
    fileSizeEl.textContent = "PDF files only";
    crumb.hidden = true;
    crumbDoc.textContent = "";
    openLink.href = "#";
    fallbackLink.href = "#";
    fileInput.value = "";
    showError("");
  }

  /* ---------- Ingestion (once per upload) ---------- */

  function isUrl(value) {
    return /^https?:\/\//i.test(value);
  }

  // state: "" (hidden), "loading", "ready" or "error"
  function setIngestStatus(state, text) {
    ingestState = state;
    var failed = state === "error";
    ingestStatus.hidden = !failed;
    ingestText.textContent = failed ? text || "" : "";
    ingestRetry.hidden = !failed;
    docProgress.hidden = state !== "loading";

    if (state === "loading") setBadge(docBadge, "info", "Indexing…", true);
    else if (state === "ready") setBadge(docBadge, "success", "Indexed");
    else if (failed) setBadge(docBadge, "danger", "Failed");
    else setBadge(docBadge, "");

    updateAssistantStatus();
    updateEmptyState();
  }

  // The assistant badge always reflects real state
  function updateAssistantStatus() {
    if (busy) setBadge(assistantBadge, "info", "Thinking…", true);
    else if (contractReady) setBadge(assistantBadge, "success", "Ready");
    else if (ingestController) setBadge(assistantBadge, "info", "Indexing…", true);
    else if (ingestState === "error") setBadge(assistantBadge, "danger", "Not indexed");
    else setBadge(assistantBadge, "neutral", "No contract");
  }

  // The empty thread teaches the next step; suggestions appear once a contract is ready
  function updateEmptyState() {
    if (!emptyState) return;
    suggestions.hidden = !contractReady;
    if (contractReady) {
      emptyTitle.textContent = "Ask about this contract";
      emptySub.textContent = "Pick a suggestion or type your own question.";
    } else if (ingestController) {
      emptyTitle.textContent = "Indexing your contract…";
      emptySub.textContent = "You can ask questions as soon as it finishes.";
    } else if (ingestState === "error") {
      emptyTitle.textContent = "Contract not indexed";
      emptySub.textContent = "Retry indexing, or upload the file again.";
    } else {
      emptyTitle.textContent = "Upload a contract to begin";
      emptySub.textContent = "Add a PDF on the left. Once it's indexed, ask questions here.";
    }
  }

  // The chat input is only usable once the current contract has been indexed
  function updateChatAvailability() {
    chatInput.disabled = !contractReady;
    composerBox.classList.toggle("is-disabled", !contractReady);
    chatInput.placeholder = contractReady
      ? "Type a question…"
      : ingestController
        ? "Indexing contract…"
        : "Upload a contract to start asking questions";
    updateSendState();
    updateAssistantStatus();
    updateEmptyState();
  }

  function cancelIngestion() {
    ingestToken++; // any response still on its way is now stale
    if (ingestController) ingestController.abort();
    ingestController = null;
    contractReady = false;
    updateChatAvailability();
  }

  function ingestErrorMessage(err) {
    var reason;
    if (err && err.name === "AbortError") {
      reason = "Indexing timed out.";
    } else if (err instanceof TypeError) {
      // fetch rejects with TypeError on network failures and blocked CORS requests
      reason = "Couldn't reach the indexing service. Check your connection and the webhook's CORS settings.";
    } else {
      reason = (err && err.message) || "Something went wrong while indexing.";
    }
    return reason + " Retry, or upload the contract again.";
  }

  // POST the PDF as binary form-data (field "data"); resolves when it's accepted
  function ingestContract(file) {
    cancelIngestion();
    var token = ingestToken;

    if (!isUrl(INGEST_WEBHOOK_URL)) {
      setIngestStatus("error", "The ingestion webhook URL isn't set. Add it to config.js, then reload the page.");
      return;
    }

    setIngestStatus("loading", "Indexing contract…");

    var form = new FormData();
    form.append("data", file, file.name);

    var controller = new AbortController();
    ingestController = controller;
    updateChatAvailability();
    var timer = setTimeout(function () { controller.abort(); }, INGEST_TIMEOUT_MS);

    fetch(INGEST_WEBHOOK_URL, { method: "POST", body: form, signal: controller.signal })
      .then(function (res) {
        if (!res.ok) throw new Error("The indexing service responded with an error (HTTP " + res.status + ").");
        if (token !== ingestToken) return; // replaced or removed while indexing
        contractReady = true;
        setIngestStatus("ready", "Contract indexed. You can ask questions now.");
      })
      .catch(function (err) {
        if (token !== ingestToken) return;
        setIngestStatus("error", ingestErrorMessage(err));
      })
      .finally(function () {
        clearTimeout(timer);
        if (token !== ingestToken) return;
        ingestController = null;
        updateChatAvailability();
        if (contractReady) chatInput.focus();
      });
  }

  ingestRetry.addEventListener("click", function () {
    if (currentFile) ingestContract(currentFile);
  });

  function openPicker() {
    fileInput.click();
  }

  dropzone.addEventListener("click", openPicker);

  dropzone.addEventListener("keydown", function (e) {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      openPicker();
    }
  });

  fileInput.addEventListener("change", function () {
    loadFile(fileInput.files[0]);
  });

  // Drag and drop works on the whole document pane, including over the viewer
  var dragDepth = 0;
  var contractPanel = contractBody.parentElement;

  contractPanel.addEventListener("dragenter", function (e) {
    e.preventDefault();
    dragDepth++;
    dropzone.classList.add("dragover");
  });

  contractPanel.addEventListener("dragover", function (e) {
    e.preventDefault();
  });

  contractPanel.addEventListener("dragleave", function () {
    dragDepth = Math.max(0, dragDepth - 1);
    if (dragDepth === 0) dropzone.classList.remove("dragover");
  });

  contractPanel.addEventListener("drop", function (e) {
    e.preventDefault();
    dragDepth = 0;
    dropzone.classList.remove("dragover");
    var file = e.dataTransfer.files[0];
    // Ignore non-PDF drops while a contract is showing so it isn't replaced
    // by an error state the user can't see.
    if (file && (isPdf(file) || viewer.hidden)) loadFile(file);
  });

  // Stop the browser from navigating to a PDF dropped outside the pane
  window.addEventListener("dragover", function (e) { e.preventDefault(); });
  window.addEventListener("drop", function (e) { e.preventDefault(); });

  replaceBtn.addEventListener("click", openPicker);
  removeBtn.addEventListener("click", clearFile);

  /* ---------- Chat ---------- */

  function nearBottom() {
    return messages.scrollHeight - messages.scrollTop - messages.clientHeight < 80;
  }

  // Follow new content only if the reader was already at the bottom;
  // otherwise leave their place alone and offer a way back.
  function settle(stick) {
    if (stick) {
      messages.scrollTop = messages.scrollHeight;
      jumpBtn.hidden = true;
    } else {
      jumpBtn.hidden = false;
    }
  }

  messages.addEventListener("scroll", function () {
    if (nearBottom()) jumpBtn.hidden = true;
  });

  jumpBtn.addEventListener("click", function () {
    settle(true);
  });

  function buildMessage(who) {
    var row = el("div", "message " + who);

    if (who === "bot") {
      var avatar = el("div", "avatar");
      avatar.appendChild(icon(ICONS.sparkle, 16));
      row.appendChild(avatar);
    }

    var main = el("div", "message-main");

    var label = el("span", "message-label");
    label.textContent = who === "user" ? "You" : "Assistant";

    var bubble = el("div", "bubble");

    main.appendChild(label);
    main.appendChild(bubble);
    row.appendChild(main);
    return { row: row, main: main, bubble: bubble };
  }

  function addMessage(text, who, variant) {
    if (emptyState) {
      emptyState.remove();
      emptyState = null;
    }
    var m = buildMessage(who);
    if (variant) m.bubble.classList.add(variant);
    m.bubble.textContent = text; // textContent: user input is never parsed as HTML
    messages.appendChild(m.row);
    settle(true);
    return m;
  }

  // Answer-shaped placeholder while the request is in flight
  function showTyping(m) {
    m.bubble.className = "bubble";
    m.bubble.textContent = "";
    var wrap = el("span", "typing");
    wrap.setAttribute("role", "status");
    var dots = el("span", "typing-dots");
    for (var i = 0; i < 3; i++) dots.appendChild(el("span"));
    var label = el("span", "typing-label");
    label.textContent = "Searching the contract…";
    wrap.appendChild(dots);
    wrap.appendChild(label);
    m.bubble.appendChild(wrap);
  }

  function addTyping() {
    var m = addMessage("", "bot");
    showTyping(m);
    return m;
  }

  // An error block inside the thread, with a Retry that re-sends the same question
  function renderError(m, message, onRetry) {
    var stick = nearBottom();
    m.bubble.className = "bubble error";
    m.bubble.textContent = "";
    var text = el("span", "error-text");
    text.textContent = message;
    m.bubble.appendChild(text);
    var retry = el("button", "btn btn-secondary btn-sm");
    retry.type = "button";
    retry.textContent = "Retry";
    retry.addEventListener("click", onRetry);
    m.bubble.appendChild(retry);
    settle(stick);
  }

  // Cited page numbers are read only from explicit "page N" / "p. N" text in a citation
  function parsePage(text) {
    var match = /\b(?:page|pg\.?|p\.)\s*(\d{1,4})\b/i.exec(text);
    return match ? parseInt(match[1], 10) : null;
  }

  // Changing only the #fragment doesn't move the browser's PDF viewer, so reload it at the page
  function goToPage(page) {
    if (!currentUrl) return;
    setView("document");
    var url = currentUrl;
    viewer.removeAttribute("src");
    setTimeout(function () {
      if (currentUrl === url) viewer.src = url + "#page=" + page;
    }, 50);
  }

  var sourceCounter = 0;

  // Compact, expandable evidence rows. A page jump is offered only when the
  // citation names a page and the contract it came from is still loaded.
  function buildSources(list) {
    var section = el("section", "sources");
    var heading = el("h3", "overline");
    heading.textContent = "Sources (" + list.length + ")";
    section.appendChild(heading);

    var urlAtRender = currentUrl;
    var startOpen = list.length <= 2;

    list.forEach(function (text, i) {
      var page = parsePage(text);
      var bodyId = "source-body-" + ++sourceCounter;

      var item = el("div", "source");
      var row = el("button", "source-row");
      row.type = "button";
      row.setAttribute("aria-expanded", String(startOpen));
      row.setAttribute("aria-controls", bodyId);

      var index = el("span", "source-index");
      index.textContent = String(i + 1);
      var preview = el("span", "source-preview");
      preview.textContent = text;
      var label = el("span", "source-label");
      label.textContent = "Source " + (i + 1);
      row.appendChild(index);
      row.appendChild(preview);
      row.appendChild(label);

      if (page) {
        var badge = el("span", "badge badge-neutral");
        badge.textContent = "p. " + page;
        row.appendChild(badge);
      }
      row.appendChild(icon(ICONS.chevron, 16));

      var body = el("div", "source-body");
      body.id = bodyId;
      body.hidden = !startOpen;
      var quote = el("blockquote", "source-quote");
      quote.textContent = text;
      body.appendChild(quote);

      if (page && urlAtRender) {
        var go = el("button", "btn btn-secondary btn-sm");
        go.type = "button";
        go.textContent = "Go to page " + page;
        go.addEventListener("click", function () {
          if (currentUrl !== urlAtRender) {
            go.disabled = true;
            go.title = "This answer refers to a contract that was replaced";
            return;
          }
          goToPage(page);
        });
        body.appendChild(go);
      }

      row.addEventListener("click", function () {
        var open = row.getAttribute("aria-expanded") !== "true";
        row.setAttribute("aria-expanded", String(open));
        body.hidden = !open;
      });

      item.appendChild(row);
      item.appendChild(body);
      section.appendChild(item);
    });
    return section;
  }

  // Reasoning is collapsed, subordinate, and labelled as the model's
  function buildReasoning(text) {
    var details = el("details", "reasoning-block");
    var summary = el("summary");
    summary.appendChild(document.createTextNode("Model reasoning"));
    summary.appendChild(icon(ICONS.chevron, 16));
    var p = el("p", "reasoning");
    p.textContent = text;
    details.appendChild(summary);
    details.appendChild(p);
    return details;
  }

  // Copy is purely client-side, and only offered where the browser allows it
  function buildActions(text) {
    if (!navigator.clipboard || !navigator.clipboard.writeText) return null;
    var actions = el("div", "message-actions");
    var copy = el("button", "icon-btn");
    copy.type = "button";
    copy.setAttribute("aria-label", "Copy answer");
    copy.title = "Copy answer";
    copy.appendChild(icon(ICONS.copy, 16));
    copy.addEventListener("click", function () {
      navigator.clipboard.writeText(text).then(function () {
        copy.textContent = "";
        copy.appendChild(icon(ICONS.check, 16));
        setTimeout(function () {
          copy.textContent = "";
          copy.appendChild(icon(ICONS.copy, 16));
        }, 1500);
      });
    });
    actions.appendChild(copy);
    return actions;
  }

  // Answer first, then sources and reasoning as separate blocks; each appears only if returned
  function renderAnswer(m, data) {
    var stick = nearBottom();
    m.bubble.className = "bubble";
    m.bubble.textContent = data.response;

    var extras = el("div", "extras");
    if (data.citation.length) extras.appendChild(buildSources(data.citation));
    if (data.reasoning) extras.appendChild(buildReasoning(data.reasoning));
    if (extras.children.length) m.main.appendChild(extras);

    var actions = buildActions(data.response);
    if (actions) m.main.appendChild(actions);
    settle(stick);
  }

  /* ---------- Webhook ---------- */

  function webhookConfigured() {
    return isUrl(CHAT_WEBHOOK_URL);
  }

  // Validate and normalise the webhook's JSON:
  // { response: string, citation: string[], reasoning: string }
  function parseAnswer(text) {
    var data;
    try {
      data = JSON.parse(text);
    } catch (err) {
      throw new Error("The service didn't return valid JSON.");
    }
    if (Array.isArray(data)) data = data[0]; // some automation tools wrap the result in an array
    if (!data || typeof data !== "object" || typeof data.response !== "string") {
      throw new Error("The service's reply was missing a \"response\" field.");
    }
    var citation = Array.isArray(data.citation)
      ? data.citation
          .filter(function (c) { return c !== null && c !== undefined && String(c).trim() !== ""; })
          .map(String)
      : [];
    return {
      response: data.response,
      citation: citation,
      reasoning: typeof data.reasoning === "string" ? data.reasoning : ""
    };
  }

  // Send just the question (the contract was indexed at upload); resolves with the parsed answer
  function askWebhook(message) {
    var form = new FormData();
    form.append("message", message);

    var controller = new AbortController();
    var timer = setTimeout(function () { controller.abort(); }, REQUEST_TIMEOUT_MS);

    return fetch(CHAT_WEBHOOK_URL, { method: "POST", body: form, signal: controller.signal })
      .then(function (res) {
        if (!res.ok) throw new Error("The service responded with an error (HTTP " + res.status + ").");
        return res.text();
      })
      .then(parseAnswer)
      .finally(function () { clearTimeout(timer); });
  }

  function friendlyError(err) {
    if (err && err.name === "AbortError") {
      return "The request timed out. Please try again.";
    }
    if (err instanceof TypeError) {
      // fetch rejects with TypeError on network failures and blocked CORS requests
      return "Couldn't reach the review service. Check your connection and the webhook's CORS settings, then try again.";
    }
    return (err && err.message) || "Something went wrong. Please try again.";
  }

  /* ---------- Sending ---------- */

  function updateSendState() {
    sendBtn.disabled = busy || !contractReady || chatInput.value.trim() === "";
  }

  function setBusy(value) {
    busy = value;
    chatForm.setAttribute("aria-busy", value ? "true" : "false");
    updateSendState();
    updateAssistantStatus();
  }

  function autoGrow() {
    chatInput.style.height = "auto";
    chatInput.style.height = chatInput.scrollHeight + "px";
  }

  // Runs one question through the chat webhook; `block` is reused when retrying
  function runQuestion(text, block) {
    setBusy(true);
    var pending = block || addTyping();
    if (block) showTyping(pending);

    askWebhook(text)
      .then(function (data) {
        renderAnswer(pending, data);
      })
      .catch(function (err) {
        renderError(pending, friendlyError(err), function () {
          if (busy || !contractReady) return;
          runQuestion(text, pending);
        });
      })
      .finally(function () {
        setBusy(false);
        chatInput.focus();
      });
  }

  // The single send path: typed questions and suggestion chips both come through here.
  // Returns true when the question was accepted.
  function sendQuestion(raw) {
    var text = raw.trim();
    // Chat is disabled until the contract is indexed; this is a safety net
    if (!text || busy || !contractReady) return false;

    if (!webhookConfigured()) {
      addMessage(
        "The chat webhook URL isn't set. Add it to config.js, then reload the page.",
        "bot",
        "error"
      );
      return false;
    }

    addMessage(text, "user");
    runQuestion(text);
    return true;
  }

  chatInput.addEventListener("input", function () {
    updateSendState();
    autoGrow();
  });

  // Enter sends, Shift+Enter inserts a new line
  chatInput.addEventListener("keydown", function (e) {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      if (!sendBtn.disabled) chatForm.requestSubmit();
    }
  });

  chatForm.addEventListener("submit", function (e) {
    e.preventDefault();
    if (sendQuestion(chatInput.value)) {
      chatInput.value = "";
      autoGrow();
      updateSendState();
    }
  });

  suggestions.addEventListener("click", function (e) {
    var chip = e.target.closest(".suggestion");
    if (chip) sendQuestion(chip.textContent);
  });

  updateChatAvailability();
})();
