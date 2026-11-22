(function () {
  "use strict";

  var WEBHOOK_URL = String((window.APP_CONFIG && window.APP_CONFIG.WEBHOOK_URL) || "").trim();
  var REQUEST_TIMEOUT_MS = 120000; // retrieval + answering can be slow

  // Elements
  var contractBody = document.getElementById("contract-body");
  var dropzone = document.getElementById("dropzone");
  var fileInput = document.getElementById("file-input");
  var uploadError = document.getElementById("upload-error");
  var viewer = document.getElementById("pdf-viewer");
  var fileChip = document.getElementById("file-chip");
  var fileNameEl = document.getElementById("file-name");
  var fileSizeEl = document.getElementById("file-size");
  var fileActions = document.getElementById("file-actions");
  var openLink = document.getElementById("open-link");
  var replaceBtn = document.getElementById("replace-file");
  var removeBtn = document.getElementById("remove-file");

  var chatForm = document.getElementById("chat-form");
  var chatInput = document.getElementById("chat-input");
  var sendBtn = document.getElementById("send-button");
  var messages = document.getElementById("messages");
  var emptyState = document.getElementById("empty-state");

  var currentUrl = null;
  var currentFile = null; // the uploaded contract, sent to the webhook with each question
  var busy = false; // true while a webhook request is in flight

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
    // on its own, independent of the chat panel.
    viewer.src = currentUrl;
    viewer.hidden = false;
    dropzone.hidden = true;
    contractBody.classList.add("has-file");

    fileNameEl.textContent = file.name;
    fileChip.title = file.name;
    fileSizeEl.textContent = "· " + formatSize(file.size);
    fileChip.hidden = false;
    openLink.href = currentUrl;
    fileActions.hidden = false;

    // Allow re-selecting the same file later
    fileInput.value = "";
  }

  function clearFile() {
    if (currentUrl) URL.revokeObjectURL(currentUrl);
    currentUrl = null;
    currentFile = null;
    viewer.removeAttribute("src");
    viewer.hidden = true;
    dropzone.hidden = false;
    contractBody.classList.remove("has-file");
    fileChip.hidden = true;
    fileActions.hidden = true;
    fileNameEl.textContent = "";
    fileSizeEl.textContent = "";
    openLink.href = "#";
    fileInput.value = "";
    showError("");
  }

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

  // Drag and drop works on the whole contract panel, including over the viewer
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

  // Stop the browser from navigating to a PDF dropped outside the panel
  window.addEventListener("dragover", function (e) { e.preventDefault(); });
  window.addEventListener("drop", function (e) { e.preventDefault(); });

  replaceBtn.addEventListener("click", openPicker);
  removeBtn.addEventListener("click", clearFile);

  /* ---------- Chat ---------- */

  var BOT_ICON =
    '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
    'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/></svg>';

  function scrollToBottom() {
    messages.scrollTop = messages.scrollHeight;
  }

  function buildMessage(who) {
    var row = document.createElement("div");
    row.className = "message " + who;

    if (who === "bot") {
      var avatar = document.createElement("div");
      avatar.className = "avatar";
      avatar.innerHTML = BOT_ICON; // static markup, no user input
      row.appendChild(avatar);
    }

    var main = document.createElement("div");
    main.className = "message-main";

    var label = document.createElement("span");
    label.className = "message-label";
    label.textContent = who === "user" ? "You" : "Assistant";

    var bubble = document.createElement("div");
    bubble.className = "bubble";

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
    scrollToBottom();
    return m;
  }

  function addTyping() {
    var m = addMessage("", "bot");
    var dots = document.createElement("span");
    dots.className = "typing";
    dots.setAttribute("aria-label", "Assistant is typing");
    for (var i = 0; i < 3; i++) dots.appendChild(document.createElement("span"));
    m.bubble.appendChild(dots);
    return m;
  }

  // Replace a pending bubble's contents with a plain-text message
  function setBubbleText(m, text, variant) {
    m.bubble.textContent = text;
    if (variant) m.bubble.classList.add(variant);
    scrollToBottom();
  }

  // Show the answer, then the supporting citations and reasoning beneath it
  function renderAnswer(m, data) {
    m.bubble.textContent = data.response;

    var extras = document.createElement("div");
    extras.className = "extras";

    if (data.citation.length) {
      var cites = document.createElement("section");
      cites.className = "extra-section";

      var cLabel = document.createElement("h3");
      cLabel.className = "extra-label";
      cLabel.textContent = data.citation.length === 1 ? "Citation" : "Citations";
      cites.appendChild(cLabel);

      data.citation.forEach(function (text) {
        var q = document.createElement("blockquote");
        q.className = "citation";
        q.textContent = text;
        cites.appendChild(q);
      });
      extras.appendChild(cites);
    }

    if (data.reasoning) {
      var why = document.createElement("section");
      why.className = "extra-section";

      var rLabel = document.createElement("h3");
      rLabel.className = "extra-label";
      rLabel.textContent = "Reasoning";
      why.appendChild(rLabel);

      var rText = document.createElement("p");
      rText.className = "reasoning";
      rText.textContent = data.reasoning;
      why.appendChild(rText);
      extras.appendChild(why);
    }

    if (extras.children.length) m.main.appendChild(extras);
    scrollToBottom();
  }

  /* ---------- Webhook ---------- */

  function webhookConfigured() {
    return /^https?:\/\//i.test(WEBHOOK_URL);
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

  // Send the contract and the question together; resolves with the parsed answer
  function askWebhook(file, message) {
    var form = new FormData();
    form.append("file", file, file.name);
    form.append("message", message);

    var controller = new AbortController();
    var timer = setTimeout(function () { controller.abort(); }, REQUEST_TIMEOUT_MS);

    return fetch(WEBHOOK_URL, { method: "POST", body: form, signal: controller.signal })
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
    sendBtn.disabled = busy || chatInput.value.trim() === "";
  }

  function setBusy(value) {
    busy = value;
    chatForm.setAttribute("aria-busy", value ? "true" : "false");
    updateSendState();
  }

  chatInput.addEventListener("input", updateSendState);

  chatForm.addEventListener("submit", function (e) {
    e.preventDefault();
    var text = chatInput.value.trim();
    if (!text || busy) return;

    if (!webhookConfigured()) {
      addMessage(
        "The webhook URL isn't set. Add it to config.js, then reload the page.",
        "bot",
        "error"
      );
      return;
    }

    if (!currentFile) {
      // Keep the typed question so it can be sent once a contract is uploaded
      addMessage("Please upload a contract first, then ask your question.", "bot", "notice");
      dropzone.focus();
      return;
    }

    addMessage(text, "user");
    chatInput.value = "";
    setBusy(true);

    var pending = addTyping();
    askWebhook(currentFile, text)
      .then(function (data) {
        pending.bubble.textContent = "";
        renderAnswer(pending, data);
      })
      .catch(function (err) {
        setBubbleText(pending, friendlyError(err), "error");
      })
      .finally(function () {
        setBusy(false);
        chatInput.focus();
      });
  });
})();
