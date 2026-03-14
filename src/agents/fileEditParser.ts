export interface ParsedFileEdit {
  path: string;
  language: string;
  content: string;
}

interface ParseOptions {
  fallbackPath?: string;
}

const CODE_BLOCK_REGEX = /```([^\n`]*)\n([\s\S]*?)```/g;

export function parseFileEdits(reply: string, options: ParseOptions = {}): ParsedFileEdit[] {
  const edits: ParsedFileEdit[] = [];
  const seen = new Map<string, ParsedFileEdit>();
  let match: RegExpExecArray | null;
  let lastIndex = 0;

  while ((match = CODE_BLOCK_REGEX.exec(reply)) !== null) {
    const info = match[1].trim();
    const content = match[2].replace(/\s+$/, '');
    const prefix = reply.slice(lastIndex, match.index);
    lastIndex = CODE_BLOCK_REGEX.lastIndex;

    const parsed = parseFenceInfo(info);
    const inferredPath = parsed.path || extractPathFromPrefix(prefix);
    const fallbackPath = !inferredPath && edits.length === 0 ? options.fallbackPath : undefined;
    const finalPath = inferredPath || fallbackPath;
    if (!finalPath) {
      continue;
    }

    const normalizedPath = finalPath.replace(/^["']|["']$/g, '').replace(/\\/g, '/');
    const edit: ParsedFileEdit = {
      path: normalizedPath,
      language: parsed.language || inferLanguageFromPath(normalizedPath),
      content,
    };

    seen.set(normalizedPath.toLowerCase(), edit);
  }

  for (const edit of seen.values()) {
    edits.push(edit);
  }

  return edits;
}

function parseFenceInfo(info: string): { language: string; path?: string } {
  const tokens = info.split(/\s+/).filter(Boolean);
  let language = '';
  let path: string | undefined;

  for (const token of tokens) {
    if (!language && !token.includes('=')
      && !token.startsWith('path:')
      && !token.startsWith('file:')
    ) {
      language = token;
      continue;
    }

    const keyValueMatch = token.match(/^(path|file|title)=(.+)$/i);
    if (keyValueMatch) {
      path = keyValueMatch[2];
      continue;
    }

    const colonMatch = token.match(/^(path|file):(.+)$/i);
    if (colonMatch) {
      path = colonMatch[2];
    }
  }

  return { language, path };
}

function extractPathFromPrefix(prefix: string): string | undefined {
  const lines = prefix.trim().split(/\r?\n/).slice(-4).reverse();
  for (const rawLine of lines) {
    const line = rawLine.trim();
    const explicit = line.match(/^(?:file|path)\s*:\s*(.+)$/i);
    if (explicit) {
      return explicit[1];
    }

    const heading = line.match(/^#+\s+(.+\.[A-Za-z0-9_-]+)$/);
    if (heading) {
      return heading[1];
    }
  }

  return undefined;
}

function inferLanguageFromPath(filePath: string): string {
  const extension = filePath.split('.').pop()?.toLowerCase() || '';
  switch (extension) {
    case 'ts':
    case 'tsx':
      return extension;
    case 'js':
    case 'jsx':
      return extension;
    case 'json':
      return 'json';
    case 'css':
      return 'css';
    case 'html':
      return 'html';
    case 'md':
      return 'markdown';
    case 'py':
      return 'python';
    case 'rs':
      return 'rust';
    case 'go':
      return 'go';
    case 'java':
      return 'java';
    default:
      return 'text';
  }
}
