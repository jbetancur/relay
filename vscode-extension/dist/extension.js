"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/extension.ts
var extension_exports = {};
__export(extension_exports, {
  activate: () => activate,
  deactivate: () => deactivate
});
module.exports = __toCommonJS(extension_exports);
var vscode3 = __toESM(require("vscode"));

// src/config.ts
var vscode = __toESM(require("vscode"));
function readConfig() {
  const cfg = vscode.workspace.getConfiguration("relay");
  return {
    baseUrl: (cfg.get("baseUrl") ?? "http://localhost:8080").replace(/\/$/, ""),
    connectionId: cfg.get("connectionId") ?? "",
    showRoutingReason: cfg.get("showRoutingReason") ?? true
  };
}
async function setToken(secrets) {
  const token = await vscode.window.showInputBox({
    title: "Relay: Set Auth Token",
    prompt: "Enter your Relay backend auth token (leave blank to clear)",
    password: true,
    ignoreFocusOut: true
  });
  if (token === void 0) {
    return;
  }
  if (token === "") {
    await secrets.delete("relay.token");
    vscode.window.showInformationMessage("Relay: auth token cleared");
  } else {
    await secrets.store("relay.token", token);
    vscode.window.showInformationMessage("Relay: auth token saved");
  }
}
async function getToken(secrets) {
  return await secrets.get("relay.token") ?? "";
}

// src/relayClient.ts
var RelayClient = class {
  constructor(baseUrl, token, defaultConnectionId) {
    this.baseUrl = baseUrl;
    this.token = token;
    this.defaultConnectionId = defaultConnectionId;
  }
  headers(connectionId) {
    const h = { "Content-Type": "application/json" };
    if (this.token) {
      h["Authorization"] = `Bearer ${this.token}`;
    }
    const connId = connectionId ?? this.defaultConnectionId;
    if (connId) {
      h["X-Relay-Connection-ID"] = connId;
    }
    return h;
  }
  async route(req) {
    const resp = await fetch(`${this.baseUrl}/api/route`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(req)
    });
    if (!resp.ok) {
      const body = await resp.text();
      throw new Error(`Relay /api/route ${resp.status}: ${body}`);
    }
    return resp.json();
  }
  // Streams content chunks from /api/v1/chat/completions (OpenAI-compatible SSE).
  // Yields each text delta as it arrives. Stops on [DONE] or cancellation.
  async *chatCompletionsStream(model, connectionId, messages, cancelToken) {
    const controller = new AbortController();
    const dispose = cancelToken.onCancellationRequested(() => controller.abort());
    let resp;
    try {
      resp = await fetch(`${this.baseUrl}/api/v1/chat/completions`, {
        method: "POST",
        headers: this.headers(connectionId),
        body: JSON.stringify({ model, messages, stream: true }),
        signal: controller.signal
      });
    } catch (err) {
      dispose.dispose();
      if (err.name === "AbortError") return;
      throw err;
    }
    if (!resp.ok) {
      dispose.dispose();
      const body = await resp.text();
      throw new Error(`Relay /api/v1/chat/completions ${resp.status}: ${body}`);
    }
    try {
      yield* this.parseSSE(resp, controller);
    } finally {
      dispose.dispose();
    }
  }
  async *parseSSE(resp, controller) {
    if (!resp.body) return;
    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const data = line.slice(6).trim();
          if (data === "[DONE]") return;
          try {
            const parsed = JSON.parse(data);
            const chunk = parsed.choices?.[0]?.delta?.content;
            if (chunk) yield chunk;
          } catch {
          }
        }
      }
    } finally {
      reader.releaseLock();
      controller.abort();
    }
  }
};

// src/router.ts
var vscode2 = __toESM(require("vscode"));
var DIFF_LANGUAGES = /* @__PURE__ */ new Set(["diff", "patch", "git-commit", "git-rebase"]);
function gatherContext(editor, prompt) {
  const selection = editor?.selection;
  const selText = editor && selection && !selection.isEmpty ? editor.document.getText(selection) : "";
  const language = editor?.document.languageId ?? "";
  const fileCount = vscode2.window.tabGroups.all.flatMap((g) => g.tabs).filter((t) => t.input instanceof vscode2.TabInputText).length;
  const hasDiff = DIFF_LANGUAGES.has(language) || /^[-+]{3} /m.test(selText.slice(0, 500));
  const selectionBlock = selText.length > 0 ? `\`\`\`${language}
${selText.slice(0, 8e3)}
\`\`\`` : "";
  const charCount = prompt.length + selText.length;
  return {
    hints: {
      fileCount,
      selectionLen: selText.length,
      language,
      hasDiff
    },
    selectionBlock
  };
}
function buildMessages(prompt, ctx) {
  const messages = [];
  if (ctx.selectionBlock) {
    messages.push({
      role: "system",
      content: `The user is working in a ${ctx.hints.language || "code"} file. Their selected code:

${ctx.selectionBlock}`
    });
  }
  messages.push({ role: "user", content: prompt });
  return messages;
}

// src/extension.ts
function activate(context) {
  context.subscriptions.push(
    vscode3.commands.registerCommand(
      "relay.setToken",
      () => setToken(context.secrets)
    )
  );
  const participant = vscode3.chat.createChatParticipant(
    "relay.chat",
    makeHandler(context)
  );
  participant.iconPath = new vscode3.ThemeIcon("rocket");
  context.subscriptions.push(participant);
}
function deactivate() {
}
function makeHandler(context) {
  return async (request, _chatCtx, stream, token) => {
    const cfg = readConfig();
    const authToken = await getToken(context.secrets);
    const client = new RelayClient(cfg.baseUrl, authToken, cfg.connectionId);
    const editor = vscode3.window.activeTextEditor;
    const ctx = gatherContext(editor, request.prompt);
    stream.progress("Routing to best model\u2026");
    let decision;
    try {
      decision = await client.route({
        task: request.prompt,
        hints: ctx.hints
      });
    } catch (err) {
      stream.markdown(
        `> **Relay error:** ${err instanceof Error ? err.message : String(err)}

> Is the backend running at \`${cfg.baseUrl}\`? Run **Relay: Set Auth Token** if auth is needed.`
      );
      return;
    }
    if (cfg.showRoutingReason) {
      const tierIcon = { local: "\u{1F7E2}", mid: "\u{1F7E1}", frontier: "\u{1F534}" }[decision.tier] ?? "\u26AA";
      const classifier = decision.classifierUsed ? " *(classifier)*" : "";
      stream.markdown(
        `*${tierIcon} \`${decision.model}\` \u2014 ${decision.reason}${classifier}*

`
      );
    }
    if (token.isCancellationRequested) return;
    const messages = buildMessages(request.prompt, ctx);
    try {
      for await (const chunk of client.chatCompletionsStream(
        decision.model,
        decision.connectionId,
        messages,
        token
      )) {
        stream.markdown(chunk);
      }
    } catch (err) {
      if (err.name !== "AbortError") {
        stream.markdown(
          `

> **Stream error:** ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }
    return {
      metadata: { model: decision.model, tier: decision.tier }
    };
  };
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  activate,
  deactivate
});
//# sourceMappingURL=extension.js.map
