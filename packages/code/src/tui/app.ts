import {
  type CliRenderer,
  Box,
} from "@opentui/core";
import type { SpectraConfig } from "../services/config.js";
import type { ContextResult } from "../services/context.js";
import type { Message } from "@singularity-ai/spectra-ai";
import { createHomeView } from "./views/home.js";
import { createChatView } from "./views/chat.js";
import { createCommandPalette } from "./components/command-palette.js";
import { SessionStore } from "../services/session-store.js";
import type { SessionData } from "../services/session-store.js";

export type Route = "home" | "chat";

export interface AppState {
  route: Route;
  messages: Message[];
  session: SessionData | null;
  config: SpectraConfig;
  context: ContextResult;
  inputValue: string;
  paletteOpen: boolean;
  selectedAgent: string;
  selectedModel: string;
  tokenUsage: { input: number; output: number };
}

const PRINTABLE_SINGLE = new Set([
  "a","b","c","d","e","f","g","h","i","j","k","l","m",
  "n","o","p","q","r","s","t","u","v","w","x","y","z",
  "A","B","C","D","E","F","G","H","I","J","K","L","M",
  "N","O","P","Q","R","S","T","U","V","W","X","Y","Z",
  "0","1","2","3","4","5","6","7","8","9",
  "`","-","=","[","]","\\",";","'",",",".","/",
  "~","!","@","#","$","%","^","&","*","(",")","_","+",
  "{","}","|",":","\"","<",">","?",
]);

export class SpectraTuiApp {
  renderer: CliRenderer;
  state: AppState;
  sessionStore: SessionStore;
  private treeRoot: any | null = null;

  constructor(renderer: CliRenderer, config: SpectraConfig, context: ContextResult) {
    this.renderer = renderer;
    this.sessionStore = new SessionStore();
    this.state = {
      route: "home",
      messages: [],
      session: null,
      config,
      context,
      inputValue: "",
      paletteOpen: false,
      selectedAgent: "build",
      selectedModel: config.model || "anthropic/claude-sonnet-4-20250514",
      tokenUsage: { input: 0, output: 0 },
    };

    this.renderer.keyInput.on("keypress", this.handleKeypress.bind(this));
  }

  initialize(): void {
    this.rebuild();
  }

  navigate(route: Route): void {
    this.state.route = route;
    this.rebuild();
  }

  private handleKeypress(key: { name: string; ctrl: boolean; meta: boolean; shift: boolean }): void {
    if (key.ctrl && key.name === "c") return;
    if (key.ctrl && key.name === "p") {
      this.state.paletteOpen = !this.state.paletteOpen;
      this.rebuild();
      return;
    }

    if (this.state.paletteOpen) {
      if (key.name === "escape") {
        this.state.paletteOpen = false;
        this.rebuild();
      }
      return;
    }

    if (key.name === "return") {
      const text = this.state.inputValue;
      if (text.trim()) {
        this.sendMessage(text);
      }
      return;
    }

    if (key.name === "backspace") {
      this.state.inputValue = this.state.inputValue.slice(0, -1);
      this.rebuild();
      return;
    }

    if (key.name === "escape") {
      if (this.state.route === "chat") {
        this.navigate("home");
      }
      return;
    }

    if (key.name === "space") {
      this.state.inputValue += " ";
      this.rebuild();
      return;
    }

    if (key.name === "tab") {
      this.state.inputValue += "  ";
      this.rebuild();
      return;
    }

    if (PRINTABLE_SINGLE.has(key.name)) {
      this.state.inputValue += key.name;
      this.rebuild();
      return;
    }
  }

  async sendMessage(text: string): Promise<void> {
    if (!text.trim()) return;

    const userMessage: Message = {
      role: "user",
      content: text,
      timestamp: Date.now(),
    };

    this.state.messages.push(userMessage);
    this.state.inputValue = "";

    if (!this.state.session) {
      this.state.session = this.sessionStore.create({
        agent: this.state.selectedAgent,
        model: this.state.selectedModel,
        directory: process.cwd(),
      });
    }
    this.sessionStore.addMessage(this.state.session.id, userMessage);

    if (this.state.route !== "chat") {
      this.state.route = "chat";
    }

    this.rebuild();
  }

  rebuild(): void {
    if (this.treeRoot) {
      this.treeRoot.remove();
      this.treeRoot = null;
    }

    if (this.state.paletteOpen) {
      this.renderer.root.add(createCommandPalette(this));
      return;
    }

    const view = this.state.route === "home"
      ? createHomeView(this)
      : createChatView(this);

    this.renderer.root.add(view);
  }

  update(): void {
    this.rebuild();
  }
}
