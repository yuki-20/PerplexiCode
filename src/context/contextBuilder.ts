import { FileReader } from './fileReader';

const SYSTEM_PROMPT = `You are PerplexiCode, an expert AI coding assistant integrated into Visual Studio Code.

Guidelines:
- Provide clear, concise, and accurate answers.
- Use fenced code blocks with the correct language identifier.
- Cite sources when referencing documentation, APIs, or external resources.
- If unsure, say so rather than guessing.
- Prefer modern, idiomatic patterns and best practices.
- When changing code, focus on the exact files and contents that should change.`;

const AGENT_PROMPT = `When the user is asking you to create or modify files, return each full file in its own fenced code block with a path marker in the fence info string.
Use this exact pattern:
\`\`\`ts path=src/example.ts
// full file contents
\`\`\`

Rules:
- Include the entire file content, not a diff.
- One file per fenced block.
- Use relative workspace paths when possible.
- Do not omit unchanged lines with ellipses.`;

interface ChatMessage {
  role: string;
  content: string;
}

export interface ContextOptions {
  includeCurrentFile?: boolean;
  selectedText?: boolean;
  includeProjectTree?: boolean;
  additionalFiles?: string[];
  agentMode?: boolean;
}

/**
 * Flattens editor context into a single prompt string for the Perplexity web API.
 */
export class ContextBuilder {
  constructor(private readonly fileReader: FileReader) {}

  async buildContextString(
    userMessage: string,
    conversationHistory: ChatMessage[],
    options: ContextOptions = {}
  ): Promise<string> {
    const parts: string[] = [SYSTEM_PROMPT];

    if (options.agentMode) {
      parts.push(`\n[Agent Mode Instructions]\n${AGENT_PROMPT}`);
    }

    if (options.includeCurrentFile !== false) {
      const currentFile = this.fileReader.readCurrentFile();
      if (currentFile) {
        parts.push(
          `\n[Current File]`,
          `name=${currentFile.fileName}`,
          `path=${currentFile.relativePath || currentFile.absolutePath}`,
          `language=${currentFile.language}`,
          `\`\`\`${currentFile.language}`,
          this._truncate(currentFile.content, 4000),
          '```'
        );
      }
    }

    if (options.selectedText) {
      const selection = this.fileReader.readSelection();
      if (selection) {
        parts.push(
          `\n[Selected Code]`,
          `path=${selection.relativePath || selection.absolutePath}`,
          `lines=${selection.startLine}-${selection.endLine}`,
          `language=${selection.language}`,
          `\`\`\`${selection.language}`,
          selection.content,
          '```'
        );
      }
    }

    if (options.includeProjectTree !== false) {
      try {
        const tree = await this.fileReader.readDirectoryTree(2);
        if (tree && tree !== '(no workspace open)') {
          parts.push(`\n[Project Structure]\n${tree}`);
        }
      } catch {
        // Ignore tree construction failures.
      }
    }

    if (conversationHistory.length > 0) {
      parts.push('\n[Conversation History]');
      for (const message of conversationHistory.slice(-6)) {
        const role = message.role === 'user' ? 'User' : 'Assistant';
        parts.push(`${role}: ${this._truncate(message.content, 500)}`);
      }
    }

    parts.push(`\n[Current Question]\n${userMessage}`);
    return parts.join('\n');
  }

  async buildMessages(
    userMessage: string,
    conversationHistory: ChatMessage[],
    options: ContextOptions = {}
  ): Promise<ChatMessage[]> {
    const contextString = await this.buildContextString(userMessage, conversationHistory, options);
    return [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: contextString },
    ];
  }

  private _truncate(text: string, maxTokens: number): string {
    const maxChars = maxTokens * 4;
    if (text.length <= maxChars) {
      return text;
    }
    return `${text.slice(0, maxChars)}\n...(truncated)`;
  }
}
