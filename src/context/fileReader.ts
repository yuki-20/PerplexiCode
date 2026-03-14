import * as path from 'path';
import * as vscode from 'vscode';

export interface FileSnapshot {
  content: string;
  fileName: string;
  language: string;
  absolutePath: string;
  relativePath?: string;
}

export interface SelectionSnapshot extends FileSnapshot {
  startLine: number;
  endLine: number;
}

/**
 * Reads files and directory structures from the active workspace.
 */
export class FileReader {
  readCurrentFile(): FileSnapshot | null {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      return null;
    }

    return {
      content: editor.document.getText(),
      fileName: path.basename(editor.document.fileName),
      language: editor.document.languageId,
      absolutePath: editor.document.uri.fsPath,
      relativePath: this.getWorkspaceRelativePath(editor.document.uri),
    };
  }

  readSelection(): SelectionSnapshot | null {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.selection.isEmpty) {
      return null;
    }

    return {
      content: editor.document.getText(editor.selection),
      fileName: path.basename(editor.document.fileName),
      language: editor.document.languageId,
      absolutePath: editor.document.uri.fsPath,
      relativePath: this.getWorkspaceRelativePath(editor.document.uri),
      startLine: editor.selection.start.line + 1,
      endLine: editor.selection.end.line + 1,
    };
  }

  async readFileByPath(filePath: string): Promise<{ content: string; fileName: string; absolutePath: string } | null> {
    try {
      const workspaceFolders = vscode.workspace.workspaceFolders;
      let uri: vscode.Uri;

      if (path.isAbsolute(filePath)) {
        uri = vscode.Uri.file(filePath);
      } else if (workspaceFolders && workspaceFolders.length > 0) {
        uri = vscode.Uri.joinPath(workspaceFolders[0].uri, filePath);
      } else {
        return null;
      }

      const data = await vscode.workspace.fs.readFile(uri);
      return {
        content: Buffer.from(data).toString('utf-8'),
        fileName: path.basename(uri.fsPath),
        absolutePath: uri.fsPath,
      };
    } catch {
      return null;
    }
  }

  async readDirectoryTree(maxDepth = 3): Promise<string> {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
      return '(no workspace open)';
    }

    const root = workspaceFolders[0].uri;
    const lines: string[] = [`${path.basename(root.fsPath)}/`];
    await this._buildTreeRecursive(root, '', 0, maxDepth, lines);
    return lines.join('\n');
  }

  getWorkspaceRoot(): vscode.Uri | undefined {
    return vscode.workspace.workspaceFolders?.[0]?.uri;
  }

  getWorkspaceRelativePath(uri: vscode.Uri): string | undefined {
    const root = this.getWorkspaceRoot();
    if (!root) {
      return undefined;
    }

    const relative = path.relative(root.fsPath, uri.fsPath);
    return relative && !relative.startsWith('..') ? relative.replace(/\\/g, '/') : undefined;
  }

  private async _buildTreeRecursive(
    dirUri: vscode.Uri,
    prefix: string,
    depth: number,
    maxDepth: number,
    lines: string[]
  ): Promise<void> {
    if (depth >= maxDepth) {
      lines.push(`${prefix}└── ...`);
      return;
    }

    try {
      const entries = await vscode.workspace.fs.readDirectory(dirUri);
      const filteredEntries = entries
        .filter(([name]) => !this.isExcluded(name))
        .sort((left, right) => {
          if (left[1] !== right[1]) {
            return left[1] === vscode.FileType.Directory ? -1 : 1;
          }
          return left[0].localeCompare(right[0]);
        });

      for (let index = 0; index < filteredEntries.length; index += 1) {
        const [name, fileType] = filteredEntries[index];
        const isLast = index === filteredEntries.length - 1;
        const connector = isLast ? '└── ' : '├── ';
        const childPrefix = isLast ? '    ' : '│   ';

        if (fileType === vscode.FileType.Directory) {
          lines.push(`${prefix}${connector}${name}/`);
          await this._buildTreeRecursive(
            vscode.Uri.joinPath(dirUri, name),
            prefix + childPrefix,
            depth + 1,
            maxDepth,
            lines
          );
        } else {
          lines.push(`${prefix}${connector}${name}`);
        }
      }
    } catch {
      // Ignore directories that cannot be read.
    }
  }

  private isExcluded(name: string): boolean {
    const excludeNames = new Set([
      'node_modules',
      '.git',
      'dist',
      'out',
      '.next',
      '__pycache__',
      '.vscode-test',
      '.DS_Store',
      'Thumbs.db',
      '.env',
    ]);

    return excludeNames.has(name) || name.startsWith('.');
  }
}
