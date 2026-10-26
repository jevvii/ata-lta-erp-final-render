import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('Disbursements Token Drift Guard', () => {
  const routeFile = path.resolve(__dirname, '../../../routes/disbursements.tsx');
  const componentsDir = path.resolve(__dirname, '../components');

  const filesToCheck: string[] = [routeFile];

  if (fs.existsSync(componentsDir)) {
    const getFilesRecursively = (dir: string): string[] => {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      const files: string[] = [];
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          files.push(...getFilesRecursively(fullPath));
        } else if (entry.name.endsWith('.tsx') || entry.name.endsWith('.ts')) {
          files.push(fullPath);
        }
      }
      return files;
    };
    filesToCheck.push(...getFilesRecursively(componentsDir));
  }

  const uniqueFilesToCheck = Array.from(new Set(filesToCheck));

  it('finds and scans all disbursement source files including workspace components', () => {
    expect(uniqueFilesToCheck.length).toBeGreaterThan(1);
    const workspaceFiles = uniqueFilesToCheck.filter((f) => f.includes('/components/workspace/'));
    expect(workspaceFiles.length).toBeGreaterThanOrEqual(3);
    for (const filePath of uniqueFilesToCheck) {
      expect(fs.existsSync(filePath)).toBe(true);
    }
  });

  uniqueFilesToCheck.forEach((filePath) => {
    const filename = path.basename(filePath);

    it(`ensures ${filename} has ZERO raw 6-digit hex codes and no deprecated tokens`, () => {
      const content = fs.readFileSync(filePath, 'utf-8');

      // Reject all raw 6-digit hex codes (#[0-9A-Fa-f]{6})
      const rawHexMatches = content.match(/#[0-9A-Fa-f]{6}\b/g);
      expect(
        rawHexMatches,
        `File ${filename} contains raw hex codes: ${rawHexMatches?.join(', ')}. Use semantic token utilities instead.`
      ).toBeNull();

      // Reject raw #1E293B (legacy ink hex)
      const hasLegacyInk = /#1[eE]293[bB]/.test(content);
      expect(
        hasLegacyInk,
        `File ${filename} contains deprecated ink hex #1E293B. Use semantic token "text-ink" instead.`
      ).toBe(false);

      // Reject border-[#E2E8F0] (legacy border hex)
      const hasLegacyBorder = /border-\[#([eE]2[eE]8[fF]0)\]/.test(content);
      expect(
        hasLegacyBorder,
        `File ${filename} contains deprecated border-[#E2E8F0]. Use semantic token "border-border" instead.`
      ).toBe(false);

      // Reject invalid text-secondary / bg-secondary / border-secondary utilities (valid token is text-text-secondary)
      const hasInvalidSecondary = /(?<![a-zA-Z0-9_-])(?:text|bg|border)-secondary(?![a-zA-Z0-9_-])/.test(
        content
      );
      expect(
        hasInvalidSecondary,
        `File ${filename} contains invalid "*-secondary" utility. Use "text-text-secondary" for #334155 text instead.`
      ).toBe(false);
    });
  });
});
