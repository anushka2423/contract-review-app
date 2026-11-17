(function () {
  var WEBHOOK_URL = "https://anushka0501.app.n8n.cloud/webhook-test/03ce9381-ba1e-4010-924f-ad69084ca0a3";
  var NOT_FOUND = "This information is not mentioned in the contract.";

  var $ = function (id) { return document.getElementById(id); };
  var dropzone = $("dropzone");
  var fileInput = $("file-input");
  var viewer = $("viewer");
  var pdfFrame = $("pdf-frame");
  var fileBar = $("file-bar");
  var fileName = $("file-name");
  var fileSize = $("file-size");
  var replaceBtn = $("replace-btn");
  var uploadError = $("upload-error");
  var messages = $("messages");
  var chatForm = $("chat-form");
  var chatInput = $("chat-input");
  var sendBtn = $("send-btn");

  var currentUrl = null;
  var currentFile = null;
  var busy = false;

  function formatSize(bytes) {
    if (bytes < 1024 * 1024) return Math.max(1, Math.round(bytes / 1024)) + " KB";
    return (bytes / (1024 * 1024)).toFixed(1) + " MB";
  }

  function showError(msg) {
    uploadError.textContent = msg;
    uploadError.hidden = !msg;
  }

  function loadFile(file) {
    if (!file) return;
    var isPdf = file.type === "application/pdf" || /\.pdf$/i.test(file.name);
    if (!isPdf) {
      showError("That doesn't look like a PDF. Please choose a .pdf file.");
      return;
    }
    showError("");
    if (currentUrl) URL.revokeObjectURL(currentUrl);
    currentUrl = URL.createObjectURL(file);
    currentFile = file;
    // The browser's PDF viewer renders inside the iframe and scrolls independently of the chat.
    pdfFrame.src = currentUrl;
    fileName.textContent = file.name;
    fileSize.textContent = "PDF · " + formatSize(file.size);
    dropzone.hidden = true;
    viewer.hidden = false;
    fileBar.hidden = false;
    replaceBtn.hidden = false;
    addMessage("Loaded “" + file.name + "”. What would you like to know?", "bot");
  }

  dropzone.addEventListener("click", function () { fileInput.click(); });
  dropzone.addEventListener("keydown", function (e) {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      fileInput.click();
    }
  });
  replaceBtn.addEventListener("click", function () { fileInput.click(); });
  fileInput.addEventListener("change", function () {
    loadFile(fileInput.files[0]);
    fileInput.value = "";
  });

  ["dragenter", "dragover"].forEach(function (ev) {
    dropzone.addEventListener(ev, function (e) {
      e.preventDefault();
      dropzone.classList.add("dragover");
    });
  });
  ["dragleave", "drop"].forEach(function (ev) {
    dropzone.addEventListener(ev, function (e) {
      e.preventDefault();
      dropzone.classList.remove("dragover");
    });
  });
  dropzone.addEventListener("drop", function (e) {
    loadFile(e.dataTransfer.files[0]);
  });

  // Dropping a file anywhere else on the page shouldn't navigate away to the PDF.
  window.addEventListener("dragover", function (e) { e.preventDefault(); });
  window.addEventListener("drop", function (e) {
    e.preventDefault();
    if (e.target !== dropzone && !dropzone.contains(e.target)) {
      loadFile(e.dataTransfer.files[0]);
    }
  });

  function addMessage(text, who) {
    var div = document.createElement("div");
    div.className = "msg " + who;
    div.textContent = text;
    messages.appendChild(div);
    messages.scrollTop = messages.scrollHeight;
    return div;
  }

  function addTyping() {
    var div = document.createElement("div");
    div.className = "msg bot typing";
    div.setAttribute("aria-label", "Assistant is typing");
    div.innerHTML = "<span></span><span></span><span></span>";
    messages.appendChild(div);
    messages.scrollTop = messages.scrollHeight;
    return div;
  }

  function updateSend() {
    sendBtn.disabled = busy || !chatInput.value.trim();
  }
  chatInput.addEventListener("input", updateSend);

  // Normalise whatever n8n returns into {response, citation[], reasoning}.
  function parseReply(raw) {
    var data = raw;
    if (typeof data === "string") {
      var s = data.trim();
      // Tolerate stray code fences even though the contract says there are none.
      s = s.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
      data = JSON.parse(s);
    }
    if (Array.isArray(data)) data = data[0]; // n8n often wraps items in an array
    if (data && typeof data.output === "string") return parseReply(data.output);
    if (data && data.output && typeof data.output === "object") data = data.output;
    if (!data || typeof data.response !== "string") {
      throw new Error("Unexpected response shape");
    }
    return {
      response: data.response,
      citation: Array.isArray(data.citation) ? data.citation.filter(function (c) { return typeof c === "string" && c; }) : [],
      reasoning: typeof data.reasoning === "string" ? data.reasoning : ""
    };
  }

  function addAnswer(reply) {
    var div = document.createElement("div");
    div.className = "msg bot answer";

    var main = document.createElement("div");
    main.textContent = reply.response;
    div.appendChild(main);

    if (reply.citation.length) {
      var label = document.createElement("div");
      label.className = "answer-label";
      label.textContent = "Citations";
      div.appendChild(label);
      reply.citation.forEach(function (c) {
        var q = document.createElement("blockquote");
        q.className = "citation";
        q.textContent = c;
        div.appendChild(q);
      });
    }

    if (reply.reasoning) {
      var rl = document.createElement("div");
      rl.className = "answer-label";
      rl.textContent = "Reasoning";
      div.appendChild(rl);
      var r = document.createElement("div");
      r.className = "reasoning";
      r.textContent = reply.reasoning;
      div.appendChild(r);
    }

    messages.appendChild(div);
    messages.scrollTop = messages.scrollHeight;
  }

  function addNotice(text) {
    var div = addMessage(text, "bot");
    div.classList.add("notice");
  }

  chatForm.addEventListener("submit", function (e) {
    e.preventDefault();
    var text = chatInput.value.trim();
    if (!text || busy) return;

    addMessage(text, "user");
    chatInput.value = "";

    if (!currentFile) {
      updateSend();
      addNotice("Please upload a PDF contract first so I can answer from it.");
      return;
    }

    busy = true;
    updateSend();
    var typing = addTyping();

    var form = new FormData();
    form.append("file", currentFile, currentFile.name);
    form.append("message", text);

    fetch(WEBHOOK_URL, { method: "POST", body: form })
      .then(function (res) {
        if (!res.ok) throw new Error("HTTP " + res.status);
        return res.text();
      })
      .then(function (body) {
        typing.remove();
        addAnswer(parseReply(body));
      })
      .catch(function (err) {
        typing.remove();
        console.error("Webhook error:", err);
        addNotice("Sorry, I couldn't get an answer from the contract service. Please try again.");
      })
      .then(function () {
        busy = false;
        updateSend();
        chatInput.focus();
      });
  });
})();
