let _kittyProtocolActive = false;

export function setKittyProtocolActive(active: boolean): void {
  _kittyProtocolActive = active;
}

export function isKittyProtocolActive(): boolean {
  return _kittyProtocolActive;
}

// ---------------------------------------------------------------------------
// Type-safe key identifiers
// ---------------------------------------------------------------------------

type Letter = "a"|"b"|"c"|"d"|"e"|"f"|"g"|"h"|"i"|"j"|"k"|"l"|"m"|"n"|"o"|"p"|"q"|"r"|"s"|"t"|"u"|"v"|"w"|"x"|"y"|"z";
type Digit = "0"|"1"|"2"|"3"|"4"|"5"|"6"|"7"|"8"|"9";
type SymbolKey = "`"|"-"|"="|"["|"]"|"\\"|";"|"'"|","|"."|"/"|"!"|"@"|"#"|"$"|"%"|"^"|"&"|"*"|"("|")"|"_"|"+"|"|"|"~"|"{"|"}"|":"|"<"|">"|"?";
type SpecialKey = "escape"|"esc"|"enter"|"return"|"tab"|"space"|"backspace"|"delete"|"insert"|"clear"|"home"|"end"|"pageUp"|"pageDown"|"up"|"down"|"left"|"right"|"f1"|"f2"|"f3"|"f4"|"f5"|"f6"|"f7"|"f8"|"f9"|"f10"|"f11"|"f12";
type BaseKey = Letter | Digit | SymbolKey | SpecialKey;

export type KeyId =
  | BaseKey
  | `ctrl+${BaseKey}`
  | `shift+${BaseKey}`
  | `alt+${BaseKey}`
  | `ctrl+shift+${BaseKey}`
  | `shift+ctrl+${BaseKey}`
  | `ctrl+alt+${BaseKey}`
  | `alt+ctrl+${BaseKey}`
  | `shift+alt+${BaseKey}`
  | `alt+shift+${BaseKey}`;

export const Key = {
  escape: "escape" as const,
  esc: "esc" as const,
  enter: "enter" as const,
  return: "return" as const,
  tab: "tab" as const,
  space: "space" as const,
  backspace: "backspace" as const,
  delete: "delete" as const,
  insert: "insert" as const,
  clear: "clear" as const,
  home: "home" as const,
  end: "end" as const,
  pageUp: "pageUp" as const,
  pageDown: "pageDown" as const,
  up: "up" as const,
  down: "down" as const,
  left: "left" as const,
  right: "right" as const,
  f1: "f1" as const, f2: "f2" as const, f3: "f3" as const,
  f4: "f4" as const, f5: "f5" as const, f6: "f6" as const,
  f7: "f7" as const, f8: "f8" as const, f9: "f9" as const,
  f10: "f10" as const, f11: "f11" as const, f12: "f12" as const,

  // Symbol keys
  backtick: "`" as const, hyphen: "-" as const, equals: "=" as const,
  leftbracket: "[" as const, rightbracket: "]" as const, backslash: "\\" as const,
  semicolon: ";" as const, quote: "'" as const, comma: "," as const,
  period: "." as const, slash: "/" as const,

  ctrl: <K extends BaseKey>(key: K): `ctrl+${K}` => `ctrl+${key}`,
  shift: <K extends BaseKey>(key: K): `shift+${K}` => `shift+${key}`,
  alt: <K extends BaseKey>(key: K): `alt+${K}` => `alt+${key}`,
  ctrlShift: <K extends BaseKey>(key: K): `ctrl+shift+${K}` => `ctrl+shift+${key}`,
  shiftCtrl: <K extends BaseKey>(key: K): `shift+ctrl+${K}` => `shift+ctrl+${key}`,
  ctrlAlt: <K extends BaseKey>(key: K): `ctrl+alt+${K}` => `ctrl+alt+${key}`,
  altCtrl: <K extends BaseKey>(key: K): `alt+ctrl+${K}` => `alt+ctrl+${key}`,
  shiftAlt: <K extends BaseKey>(key: K): `shift+alt+${K}` => `shift+alt+${key}`,
  altShift: <K extends BaseKey>(key: K): `alt+shift+${K}` => `alt+shift+${key}`,
} as const;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MODIFIERS = { shift: 1, alt: 2, ctrl: 4 } as const;
const LOCK_MASK = 64 + 128;

const CODEPOINTS = {
  escape: 27, tab: 9, enter: 13, space: 32, backspace: 127, kpEnter: 57414,
} as const;

const ARROW_CODEPOINTS = { up: -1, down: -2, right: -3, left: -4 } as const;
const FUNCTIONAL_CODEPOINTS = { delete: -10, insert: -11, pageUp: -12, pageDown: -13, home: -14, end: -15 } as const;

const LEGACY_KEY_SEQUENCES: Record<string, string[]> = {
  up: ["\x1b[A", "\x1bOA"],
  down: ["\x1b[B", "\x1bOB"],
  right: ["\x1b[C", "\x1bOC"],
  left: ["\x1b[D", "\x1bOD"],
  home: ["\x1b[H", "\x1bOH", "\x1b[1~", "\x1b[7~"],
  end: ["\x1b[F", "\x1bOF", "\x1b[4~", "\x1b[8~"],
  insert: ["\x1b[2~"],
  delete: ["\x1b[3~"],
  pageUp: ["\x1b[5~"],
  pageDown: ["\x1b[6~"],
  f1: ["\x1bOP", "\x1b[11~"], f2: ["\x1bOQ", "\x1b[12~"],
  f3: ["\x1bOR", "\x1b[13~"], f4: ["\x1bOS", "\x1b[14~"],
  f5: ["\x1b[15~"], f6: ["\x1b[17~"], f7: ["\x1b[18~"],
  f8: ["\x1b[19~"], f9: ["\x1b[20~"], f10: ["\x1b[21~"],
  f11: ["\x1b[23~"], f12: ["\x1b[24~"],
};

const LEGACY_SEQUENCE_KEY_IDS: Record<string, KeyId> = {
  "\x1bOA": "up", "\x1bOB": "down", "\x1bOC": "right", "\x1bOD": "left",
  "\x1bOH": "home", "\x1bOF": "end",
  "\x1b[A": "up", "\x1b[B": "down", "\x1b[C": "right", "\x1b[D": "left",
  "\x1b[H": "home", "\x1b[F": "end",
  "\x1b[1~": "home", "\x1b[2~": "insert", "\x1b[3~": "delete",
  "\x1b[4~": "end", "\x1b[5~": "pageUp", "\x1b[6~": "pageDown",
  "\x1b[7~": "home", "\x1b[8~": "end",
  "\x1bOP": "f1", "\x1bOQ": "f2", "\x1bOR": "f3", "\x1bOS": "f4",
  "\x1b[11~": "f1", "\x1b[12~": "f2", "\x1b[13~": "f3", "\x1b[14~": "f4",
  "\x1b[15~": "f5", "\x1b[17~": "f6", "\x1b[18~": "f7",
  "\x1b[19~": "f8", "\x1b[20~": "f9", "\x1b[21~": "f10",
  "\x1b[23~": "f11", "\x1b[24~": "f12",
  // Modified keys (legacy)
  "\x1b[a": "shift+up", "\x1b[b": "shift+down", "\x1b[c": "shift+right", "\x1b[d": "shift+left",
  "\x1b[7$": "shift+home", "\x1b[8$": "shift+end",
  "\x1bOa": "ctrl+up", "\x1bOb": "ctrl+down", "\x1bOc": "ctrl+right", "\x1bOd": "ctrl+left",
  "\x1b[7^": "ctrl+home", "\x1b[8^": "ctrl+end",
  "\x1bb": "alt+left", "\x1bf": "alt+right", "\x1bp": "alt+up", "\x1bn": "alt+down",
};

// ---------------------------------------------------------------------------
// Kitty protocol parsing
// ---------------------------------------------------------------------------

interface ParsedKittySequence {
  codepoint: number;
  shiftedKey?: number;
  baseLayoutKey?: number;
  modifier: number;
  eventType: "press" | "repeat" | "release";
}

let _lastEventType: "press" | "repeat" | "release" = "press";

export function isKeyRelease(data: string): boolean {
  if (data.includes("\x1b[200~")) return false;
  if (data.includes(":3u") || data.includes(":3~") || data.includes(":3A") || data.includes(":3B")
    || data.includes(":3C") || data.includes(":3D") || data.includes(":3H") || data.includes(":3F")) {
    return true;
  }
  return false;
}

function parseKittySequence(data: string): ParsedKittySequence | null {
  // CSI u format: \x1b[<codepoint>[;<mod>][:<event>]u
  const csiUMatch = data.match(/^\x1b\[(\d+)(?::(\d*))?(?::(\d+))?(?:;(\d+))?(?::(\d+))?u$/);
  if (csiUMatch) {
    const codepoint = parseInt(csiUMatch[1]!, 10);
    const shiftedKey = csiUMatch[2] && csiUMatch[2].length > 0 ? parseInt(csiUMatch[2], 10) : undefined;
    const baseLayoutKey = csiUMatch[3] ? parseInt(csiUMatch[3], 10) : undefined;
    const modValue = csiUMatch[4] ? parseInt(csiUMatch[4], 10) : 1;
    const eventTypeStr = csiUMatch[5];
    const eventType = eventTypeStr === "2" ? "repeat" : eventTypeStr === "3" ? "release" : "press";
    _lastEventType = eventType;
    return { codepoint, shiftedKey, baseLayoutKey, modifier: modValue - 1, eventType };
  }

  // Arrow with modifier: \x1b[1;<mod>[ABCD]
  const arrowMatch = data.match(/^\x1b\[1;(\d+)(?::(\d+))?([ABCD])$/);
  if (arrowMatch) {
    const modValue = parseInt(arrowMatch[1]!, 10);
    const eventTypeStr = arrowMatch[2];
    const eventType = eventTypeStr === "2" ? "repeat" : eventTypeStr === "3" ? "release" : "press";
    const arrowCodes: Record<string, number> = { A: -1, B: -2, C: -3, D: -4 };
    _lastEventType = eventType;
    return { codepoint: arrowCodes[arrowMatch[3]!]!, modifier: modValue - 1, eventType };
  }

  // Functional: \x1b[<num>[;<mod>][:<event>]~
  const funcMatch = data.match(/^\x1b\[(\d+)(?:;(\d+))?(?::(\d+))?~$/);
  if (funcMatch) {
    const keyNum = parseInt(funcMatch[1]!, 10);
    const modValue = funcMatch[2] ? parseInt(funcMatch[2], 10) : 1;
    const eventTypeStr = funcMatch[3];
    const eventType = eventTypeStr === "2" ? "repeat" : eventTypeStr === "3" ? "release" : "press";
    const funcCodes: Record<number, number> = {
      2: FUNCTIONAL_CODEPOINTS.insert, 3: FUNCTIONAL_CODEPOINTS.delete,
      5: FUNCTIONAL_CODEPOINTS.pageUp, 6: FUNCTIONAL_CODEPOINTS.pageDown,
      7: FUNCTIONAL_CODEPOINTS.home, 8: FUNCTIONAL_CODEPOINTS.end,
    };
    if (funcCodes[keyNum] !== undefined) {
      _lastEventType = eventType;
      return { codepoint: funcCodes[keyNum]!, modifier: modValue - 1, eventType };
    }
  }

  // Home/End with modifier: \x1b[1;<mod>[HF]
  const homeEndMatch = data.match(/^\x1b\[1;(\d+)(?::(\d+))?([HF])$/);
  if (homeEndMatch) {
    const modValue = parseInt(homeEndMatch[1]!, 10);
    const eventTypeStr = homeEndMatch[2];
    const eventType = eventTypeStr === "2" ? "repeat" : eventTypeStr === "3" ? "release" : "press";
    const codepoint = homeEndMatch[3] === "H" ? FUNCTIONAL_CODEPOINTS.home : FUNCTIONAL_CODEPOINTS.end;
    _lastEventType = eventType;
    return { codepoint, modifier: modValue - 1, eventType };
  }

  return null;
}

function matchesKittySequence(data: string, expectedCodepoint: number, expectedModifier: number): boolean {
  const parsed = parseKittySequence(data);
  if (!parsed) return false;
  const actualMod = parsed.modifier & ~LOCK_MASK;
  const expectedMod = expectedModifier & ~LOCK_MASK;
  if (actualMod !== expectedMod) return false;

  // Normalize numpad keys
  const KITTY_FUNCTIONAL_KEY_EQUIVALENTS = new Map<number, number>([
    [57414, 13], // KP_ENTER -> ENTER
  ]);

  function normalize(cp: number): number {
    return KITTY_FUNCTIONAL_KEY_EQUIVALENTS.get(cp) ?? cp;
  }

  if (normalize(parsed.codepoint) === normalize(expectedCodepoint)) return true;

  // Base layout key fallback for non-Latin layouts
  if (parsed.baseLayoutKey !== undefined && parsed.baseLayoutKey === expectedCodepoint) {
    const cp = normalize(parsed.codepoint);
    const isLatinLetter = cp >= 97 && cp <= 122;
    const SYMBOL_KEYS = new Set(["`","-","=","[","]","\\",";","'",",",".","/","!","@","#","$","%","^","&","*","(",")","_","+","|","~","{","}",":","<",">","?"]);
    if (!isLatinLetter && !SYMBOL_KEYS.has(String.fromCharCode(cp))) return true;
  }

  return false;
}

// ---------------------------------------------------------------------------
// Generic key matching
// ---------------------------------------------------------------------------

function parseKeyId(keyId: string): { key: string; ctrl: boolean; shift: boolean; alt: boolean } | null {
  const parts = keyId.toLowerCase().split("+");
  const key = parts[parts.length - 1];
  if (!key) return null;
  return {
    key,
    ctrl: parts.includes("ctrl"),
    shift: parts.includes("shift"),
    alt: parts.includes("alt"),
  };
}

function rawCtrlChar(key: string): string | null {
  const char = key.toLowerCase();
  const code = char.charCodeAt(0);
  if ((code >= 97 && code <= 122) || char === "[" || char === "\\" || char === "]" || char === "_") {
    return String.fromCharCode(code & 0x1f);
  }
  if (char === "-") return String.fromCharCode(31);
  return null;
}

function isDigitKey(key: string): boolean {
  return key >= "0" && key <= "9";
}

function isWindowsTerminalSession(): boolean {
  return Boolean(process.env.WT_SESSION) && !process.env.SSH_CONNECTION && !process.env.SSH_CLIENT && !process.env.SSH_TTY;
}

function matchesRawBackspace(data: string, expectedModifier: number): boolean {
  if (data === "\x7f") return expectedModifier === 0;
  if (data !== "\x08") return false;
  return isWindowsTerminalSession() ? expectedModifier === MODIFIERS.ctrl : expectedModifier === 0;
}

const SYMBOL_KEYS_SET = new Set(["`","-","=","[","]","\\",";","'",",",".","/","!","@","#","$","%","^","&","*","(",")","_","+","|","~","{","}",":","<",">","?"]);

export function matchesKey(data: string, keyId: KeyId): boolean {
  const parsed = parseKeyId(keyId);
  if (!parsed) return false;

  const { key, ctrl, shift, alt } = parsed;
  let modifier = 0;
  if (shift) modifier |= MODIFIERS.shift;
  if (alt) modifier |= MODIFIERS.alt;
  if (ctrl) modifier |= MODIFIERS.ctrl;

  // Special keys
  switch (key) {
    case "escape": case "esc":
      if (modifier !== 0) return false;
      return data === "\x1b" || matchesKittySequence(data, CODEPOINTS.escape, 0);

    case "space":
      if (!_kittyProtocolActive) {
        if (ctrl && !alt && !shift && data === "\x00") return true;
        if (alt && !ctrl && !shift && data === "\x1b ") return true;
      }
      if (modifier === 0) {
        return data === " " || matchesKittySequence(data, CODEPOINTS.space, 0);
      }
      return matchesKittySequence(data, CODEPOINTS.space, modifier);

    case "tab":
      if (shift && !ctrl && !alt) {
        return data === "\x1b[Z" || matchesKittySequence(data, CODEPOINTS.tab, MODIFIERS.shift);
      }
      if (modifier === 0) {
        return data === "\t" || matchesKittySequence(data, CODEPOINTS.tab, 0);
      }
      return matchesKittySequence(data, CODEPOINTS.tab, modifier);

    case "enter": case "return":
      if (alt && !ctrl && !shift) {
        if (matchesKittySequence(data, CODEPOINTS.enter, MODIFIERS.alt)) return true;
        if (!_kittyProtocolActive) return data === "\x1b\r";
        return false;
      }
      if (shift && !ctrl && !alt) {
        return matchesKittySequence(data, CODEPOINTS.enter, MODIFIERS.shift);
      }
      if (modifier === 0) {
        return data === "\r" || (!_kittyProtocolActive && data === "\n") || data === "\x1bOM"
          || matchesKittySequence(data, CODEPOINTS.enter, 0)
          || matchesKittySequence(data, CODEPOINTS.kpEnter, 0);
      }
      return matchesKittySequence(data, CODEPOINTS.enter, modifier)
        || matchesKittySequence(data, CODEPOINTS.kpEnter, modifier);

    case "backspace":
      if (alt && !ctrl && !shift) {
        if (data === "\x1b\x7f" || data === "\x1b\b") return true;
        return matchesKittySequence(data, CODEPOINTS.backspace, MODIFIERS.alt);
      }
      if (ctrl && !alt && !shift) {
        if (matchesRawBackspace(data, MODIFIERS.ctrl)) return true;
        return matchesKittySequence(data, CODEPOINTS.backspace, MODIFIERS.ctrl);
      }
      if (modifier === 0) {
        return matchesRawBackspace(data, 0) || matchesKittySequence(data, CODEPOINTS.backspace, 0);
      }
      return matchesKittySequence(data, CODEPOINTS.backspace, modifier);

    case "insert":
      if (modifier === 0) {
        return matchesLegacySequence(data, LEGACY_KEY_SEQUENCES.insert) || matchesKittySequence(data, FUNCTIONAL_CODEPOINTS.insert, 0);
      }
      return matchesKittySequence(data, FUNCTIONAL_CODEPOINTS.insert, modifier);

    case "delete":
      if (modifier === 0) {
        return matchesLegacySequence(data, LEGACY_KEY_SEQUENCES.delete) || matchesKittySequence(data, FUNCTIONAL_CODEPOINTS.delete, 0);
      }
      return matchesKittySequence(data, FUNCTIONAL_CODEPOINTS.delete, modifier);

    case "home":
      if (modifier === 0) {
        return matchesLegacySequence(data, LEGACY_KEY_SEQUENCES.home) || matchesKittySequence(data, FUNCTIONAL_CODEPOINTS.home, 0);
      }
      return matchesKittySequence(data, FUNCTIONAL_CODEPOINTS.home, modifier);

    case "end":
      if (modifier === 0) {
        return matchesLegacySequence(data, LEGACY_KEY_SEQUENCES.end) || matchesKittySequence(data, FUNCTIONAL_CODEPOINTS.end, 0);
      }
      return matchesKittySequence(data, FUNCTIONAL_CODEPOINTS.end, modifier);

    case "pageup":
      if (modifier === 0) {
        return matchesLegacySequence(data, LEGACY_KEY_SEQUENCES.pageUp) || matchesKittySequence(data, FUNCTIONAL_CODEPOINTS.pageUp, 0);
      }
      return matchesKittySequence(data, FUNCTIONAL_CODEPOINTS.pageUp, modifier);

    case "pagedown":
      if (modifier === 0) {
        return matchesLegacySequence(data, LEGACY_KEY_SEQUENCES.pageDown) || matchesKittySequence(data, FUNCTIONAL_CODEPOINTS.pageDown, 0);
      }
      return matchesKittySequence(data, FUNCTIONAL_CODEPOINTS.pageDown, modifier);

    case "up":
      if (alt && !ctrl && !shift) {
        return data === "\x1bp" || matchesKittySequence(data, ARROW_CODEPOINTS.up, MODIFIERS.alt);
      }
      if (modifier === 0) {
        return matchesLegacySequence(data, LEGACY_KEY_SEQUENCES.up) || matchesKittySequence(data, ARROW_CODEPOINTS.up, 0);
      }
      return matchesKittySequence(data, ARROW_CODEPOINTS.up, modifier);

    case "down":
      if (alt && !ctrl && !shift) {
        return data === "\x1bn" || matchesKittySequence(data, ARROW_CODEPOINTS.down, MODIFIERS.alt);
      }
      if (modifier === 0) {
        return matchesLegacySequence(data, LEGACY_KEY_SEQUENCES.down) || matchesKittySequence(data, ARROW_CODEPOINTS.down, 0);
      }
      return matchesKittySequence(data, ARROW_CODEPOINTS.down, modifier);

    case "left":
      if (alt && !ctrl && !shift) {
        return data === "\x1bb" || matchesKittySequence(data, ARROW_CODEPOINTS.left, MODIFIERS.alt);
      }
      if (modifier === 0) {
        return matchesLegacySequence(data, LEGACY_KEY_SEQUENCES.left) || matchesKittySequence(data, ARROW_CODEPOINTS.left, 0);
      }
      return matchesKittySequence(data, ARROW_CODEPOINTS.left, modifier);

    case "right":
      if (alt && !ctrl && !shift) {
        return data === "\x1bf" || matchesKittySequence(data, ARROW_CODEPOINTS.right, MODIFIERS.alt);
      }
      if (modifier === 0) {
        return matchesLegacySequence(data, LEGACY_KEY_SEQUENCES.right) || matchesKittySequence(data, ARROW_CODEPOINTS.right, 0);
      }
      return matchesKittySequence(data, ARROW_CODEPOINTS.right, modifier);

    case "f1": case "f2": case "f3": case "f4": case "f5": case "f6":
    case "f7": case "f8": case "f9": case "f10": case "f11": case "f12":
      if (modifier !== 0) return false;
      return matchesLegacySequence(data, LEGACY_KEY_SEQUENCES[key]);
  }

  // Letter/digit/symbol keys
  if (key.length === 1 && ((key >= "a" && key <= "z") || isDigitKey(key) || SYMBOL_KEYS_SET.has(key))) {
    const codepoint = key.charCodeAt(0);
    const rawCtrl = rawCtrlChar(key);
    const isLetter = key >= "a" && key <= "z";

    if (ctrl && alt && !shift && !_kittyProtocolActive && rawCtrl) {
      return data === `\x1b${rawCtrl}`;
    }

    if (alt && !ctrl && !shift && !_kittyProtocolActive && (isLetter || isDigitKey(key))) {
      if (data === `\x1b${key}`) return true;
    }

    if (ctrl && !shift && !alt) {
      if (rawCtrl && data === rawCtrl) return true;
      return matchesKittySequence(data, codepoint, MODIFIERS.ctrl);
    }

    if (ctrl && shift && !alt) {
      return matchesKittySequence(data, codepoint, MODIFIERS.shift + MODIFIERS.ctrl);
    }

    if (shift && !ctrl && !alt) {
      if (isLetter && data === key.toUpperCase()) return true;
      return matchesKittySequence(data, codepoint, MODIFIERS.shift);
    }

    // Alt-shift
    if (alt && shift && !ctrl) {
      return matchesKittySequence(data, codepoint, MODIFIERS.shift + MODIFIERS.alt);
    }

    if (modifier !== 0) {
      return matchesKittySequence(data, codepoint, modifier);
    }

    return data === key || matchesKittySequence(data, codepoint, 0);
  }

  return false;
}

function matchesLegacySequence(data: string, sequences: string[]): boolean {
  return sequences.includes(data);
}

// ---------------------------------------------------------------------------
// parseKey
// ---------------------------------------------------------------------------

export function parseKey(data: string): string | undefined {
  const kitty = parseKittySequence(data);
  if (kitty) {
    const normalized = normalizeForParsing(kitty.codepoint);
    let keyName: string | undefined;
    if (normalized === CODEPOINTS.escape) keyName = "escape";
    else if (normalized === CODEPOINTS.tab) keyName = "tab";
    else if (normalized === CODEPOINTS.enter || normalized === CODEPOINTS.kpEnter) keyName = "enter";
    else if (normalized === CODEPOINTS.space) keyName = "space";
    else if (normalized === CODEPOINTS.backspace) keyName = "backspace";
    else if (normalized === FUNCTIONAL_CODEPOINTS.delete) keyName = "delete";
    else if (normalized === FUNCTIONAL_CODEPOINTS.insert) keyName = "insert";
    else if (normalized === FUNCTIONAL_CODEPOINTS.home) keyName = "home";
    else if (normalized === FUNCTIONAL_CODEPOINTS.end) keyName = "end";
    else if (normalized === FUNCTIONAL_CODEPOINTS.pageUp) keyName = "pageUp";
    else if (normalized === FUNCTIONAL_CODEPOINTS.pageDown) keyName = "pageDown";
    else if (normalized === ARROW_CODEPOINTS.up) keyName = "up";
    else if (normalized === ARROW_CODEPOINTS.down) keyName = "down";
    else if (normalized === ARROW_CODEPOINTS.left) keyName = "left";
    else if (normalized === ARROW_CODEPOINTS.right) keyName = "right";
    else if (normalized >= 48 && normalized <= 57) keyName = String.fromCharCode(normalized);
    else if (normalized >= 97 && normalized <= 122) keyName = String.fromCharCode(normalized);
    else if (SYMBOL_KEYS_SET.has(String.fromCharCode(normalized))) keyName = String.fromCharCode(normalized);

    if (!keyName) return undefined;
    return formatKeyNameWithModifiers(keyName, kitty.modifier);
  }

  // Legacy
  const legacy = LEGACY_SEQUENCE_KEY_IDS[data];
  if (legacy) return legacy;

  if (data === "\x1b") return "escape";
  if (data === "\x1c") return "ctrl+\\";
  if (data === "\x1d") return "ctrl+]";
  if (data === "\x1f") return "ctrl+-";
  if (data === "\t") return "tab";
  if (data === "\r" || (!_kittyProtocolActive && data === "\n")) return "enter";
  if (data === "\x00") return "ctrl+space";
  if (data === " ") return "space";
  if (data === "\x7f") return "backspace";
  if (data === "\x1b[Z") return "shift+tab";
  if (!_kittyProtocolActive && data === "\x1b\r") return "alt+enter";
  if (!_kittyProtocolActive && data === "\x1b ") return "alt+space";
  if (data === "\x1b\x7f" || data === "\x1b\b") return "alt+backspace";
  if (!_kittyProtocolActive && data === "\x1bB") return "alt+left";
  if (!_kittyProtocolActive && data === "\x1bF") return "alt+right";

  if (!_kittyProtocolActive && data.length === 2 && data[0] === "\x1b") {
    const code = data.charCodeAt(1);
    if (code >= 1 && code <= 26) return `ctrl+alt+${String.fromCharCode(code + 96)}`;
    if ((code >= 97 && code <= 122) || (code >= 48 && code <= 57)) return `alt+${String.fromCharCode(code)}`;
  }

  if (data.length === 1) {
    const code = data.charCodeAt(0);
    if (code >= 1 && code <= 26) return `ctrl+${String.fromCharCode(code + 96)}`;
    if (code >= 32 && code <= 126) return data;
  }

  return undefined;
}

function normalizeForParsing(codepoint: number): number {
  const KITTY_FUNCTIONAL_KEY_EQUIVALENTS = new Map<number, number>([[57414, 13]]);
  return KITTY_FUNCTIONAL_KEY_EQUIVALENTS.get(codepoint) ?? codepoint;
}

function formatKeyNameWithModifiers(keyName: string, modifier: number): string | undefined {
  const mods: string[] = [];
  const effectiveMod = modifier & ~LOCK_MASK;
  if (effectiveMod & MODIFIERS.shift) mods.push("shift");
  if (effectiveMod & MODIFIERS.ctrl) mods.push("ctrl");
  if (effectiveMod & MODIFIERS.alt) mods.push("alt");
  return mods.length > 0 ? `${mods.join("+")}+${keyName}` : keyName;
}

// ---------------------------------------------------------------------------
// Kitty CSI-u Printable Decoding
// ---------------------------------------------------------------------------

/**
 * Decode a Kitty CSI-u sequence into a printable character, if applicable.
 * When Kitty keyboard protocol flag 1 is active, terminals send CSI-u
 * sequences for all keys including plain printable characters.
 */
export function decodeKittyPrintable(data: string): string | undefined {
  const match = data.match(/^\x1b\[(\d+)(?::(\d*))?(?::(\d+))?(?:;(\d+))?(?::(\d+))?u$/);
  if (!match) return undefined;

  const codepoint = Number.parseInt(match[1] ?? "", 10);
  if (!Number.isFinite(codepoint)) return undefined;

  const shiftedKey = match[2] && match[2].length > 0 ? Number.parseInt(match[2], 10) : undefined;
  const modValue = match[4] ? Number.parseInt(match[4], 10) : 1;
  const modifier = Number.isFinite(modValue) ? modValue - 1 : 0;

  // Reject Ctrl, Alt, Super modifiers
  if ((modifier & ~(MODIFIERS.shift | LOCK_MASK)) !== 0) return undefined;
  if (modifier & (MODIFIERS.alt | MODIFIERS.ctrl)) return undefined;

  let effectiveCodepoint = codepoint;
  if (modifier & MODIFIERS.shift && typeof shiftedKey === "number") {
    effectiveCodepoint = shiftedKey;
  }
  effectiveCodepoint = normalizeForParsing(effectiveCodepoint);
  if (!Number.isFinite(effectiveCodepoint) || effectiveCodepoint < 32) return undefined;

  try {
    return String.fromCodePoint(effectiveCodepoint);
  } catch {
    return undefined;
  }
}
