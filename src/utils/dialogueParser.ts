import type { DialogueLine, DialogueRole, ParseScriptOptions } from "../types";

const PREFIX_REGEX =
  /^\s*(?:[【(\x5b]([^\s】)\x5d]{1,15})[】)\x5d]|([^\s:：【(\x5b]{1,15})[:：])\s*(.*)$/;

/**
 * Parses raw script text into dialogue lines assigned to specific roles.
 */
export function parseScript(
  rawText: string,
  roles: DialogueRole[],
  options: ParseScriptOptions = {},
): DialogueLine[] {
  if (!rawText.trim() || roles.length === 0) {
    return [];
  }

  const { mode = "prefix", defaultRoleId, pauseMs = 300 } = options;
  const fallbackRoleId = defaultRoleId || roles.find((r) => r.isDefault)?.id || roles[0]?.id || "";

  // Map role name (lowercase) -> role.id
  const nameToId = new Map<string, string>();
  for (const role of roles) {
    nameToId.set(role.name.trim().toLowerCase(), role.id);
  }

  if (mode === "prefix") {
    const rawLines = rawText.split(/\r?\n/);
    const parsedLines: DialogueLine[] = [];

    for (const rawLine of rawLines) {
      const trimmed = rawLine.trim();
      if (!trimmed) {
        continue;
      }

      const match = trimmed.match(PREFIX_REGEX);
      if (match) {
        const speakerName = (match[1] || match[2] || "").trim();
        const content = (match[3] || "").trim();
        const matchedRoleId =
          nameToId.get(speakerName.toLowerCase()) ||
          roles.find((r) => r.name.includes(speakerName) || speakerName.includes(r.name))?.id ||
          fallbackRoleId;

        if (content) {
          parsedLines.push({
            id: crypto.randomUUID(),
            roleId: matchedRoleId,
            text: content,
            pauseAfterMs: pauseMs,
          });
        }
      } else {
        // Line without explicit prefix, assign to default narrator
        parsedLines.push({
          id: crypto.randomUUID(),
          roleId: fallbackRoleId,
          text: trimmed,
          pauseAfterMs: pauseMs,
        });
      }
    }

    return parsedLines;
  }

  // mode === 'quotes': split novel text by quotes into narrative and dialogue
  return parseQuotedNovelText(rawText, roles, fallbackRoleId, pauseMs);
}

/**
 * Extracts dialogue inside quotes and narrative outside quotes.
 */
function parseQuotedNovelText(
  rawText: string,
  roles: DialogueRole[],
  fallbackRoleId: string,
  pauseMs: number,
): DialogueLine[] {
  const lines: DialogueLine[] = [];
  const nonNarratorRoles = roles.filter((r) => !r.isDefault);
  let speakerIndex = 0;

  // Regex matching quotes: “...” or "..." or 「...」
  const quoteRegex = /([“"「『][^”"」』]+[”"」』])/g;
  const paragraphs = rawText.split(/\r?\n/);

  for (const para of paragraphs) {
    const trimmed = para.trim();
    if (!trimmed) {
      continue;
    }

    const segments = trimmed.split(quoteRegex);
    for (const seg of segments) {
      const segTrimmed = seg.trim();
      if (!segTrimmed) {
        continue;
      }

      const isQuoted =
        (segTrimmed.startsWith("“") && segTrimmed.endsWith("”")) ||
        (segTrimmed.startsWith('"') && segTrimmed.endsWith('"')) ||
        (segTrimmed.startsWith("「") && segTrimmed.endsWith("」")) ||
        (segTrimmed.startsWith("『") && segTrimmed.endsWith("』"));

      if (isQuoted) {
        // Dialogue quote: assign to next non-narrator role
        const roleId =
          nonNarratorRoles.length > 0
            ? nonNarratorRoles[speakerIndex % nonNarratorRoles.length].id
            : fallbackRoleId;
        speakerIndex += 1;

        lines.push({
          id: crypto.randomUUID(),
          roleId,
          text: segTrimmed,
          pauseAfterMs: pauseMs,
        });
      } else {
        // Narrative sentence outside quotes: assign to narrator
        lines.push({
          id: crypto.randomUUID(),
          roleId: fallbackRoleId,
          text: segTrimmed,
          pauseAfterMs: pauseMs,
        });
      }
    }
  }

  return lines;
}

/**
 * Formats dialogue lines back to formatted script text.
 */
export function formatScript(lines: DialogueLine[], roles: DialogueRole[]): string {
  const roleMap = new Map<string, string>();
  for (const role of roles) {
    roleMap.set(role.id, role.name);
  }

  return lines
    .map((line) => {
      const roleName = roleMap.get(line.roleId) || "未知角色";
      return `${roleName}：${line.text}`;
    })
    .join("\n");
}
