import * as vscode from 'vscode';
import * as yaml from 'yaml';
import { ResolvedVariable, AssembledCapsule, MARKER_MAP } from '../types/capsule';
import { getSurfaceUri } from './fileService';
import { SurfaceId } from '../types';

/**
 * Resolve a variable path to its content.
 * Supports dot notation for nested access.
 * 
 * Examples:
 * - 'capsule' -> entire capsule.yaml
 * - 'capsule.head' -> just the head field from capsule.yaml
 * - 'trace' -> entire trace.yaml
 */
export async function resolveVariable(
  sessionId: string,
  variablePath: string
): Promise<ResolvedVariable> {
  // Parse the path
  const parts = variablePath.split('.');
  const surfaceId = parts[0] as SurfaceId;
  const fieldPath = parts.slice(1);
  
  // Load the surface file via vscode.workspace.fs
  const uri = getSurfaceUri(sessionId, surfaceId);
  if (!uri) {
    return {
      path: variablePath,
      marker: deriveMarker(variablePath),
      content: null
    };
  }

  let surface: object | null = null;
  try {
    const content = await vscode.workspace.fs.readFile(uri);
    surface = yaml.parse(new TextDecoder().decode(content));
  } catch {
    surface = null;
  }
  
  // Extract nested field if specified
  let content: object | null = surface;
  if (content && fieldPath.length > 0) {
    for (const field of fieldPath) {
      if (content && typeof content === 'object' && field in content) {
        content = (content as Record<string, any>)[field];
      } else {
        content = null;
        break;
      }
    }
  }
  
  // Derive marker
  const marker = deriveMarker(variablePath);
  
  return {
    path: variablePath,
    marker,
    content
  };
}

/**
 * Derive a semantic marker from a variable path.
 * Uses MARKER_MAP for known paths, otherwise derives from path.
 */
export function deriveMarker(variablePath: string): string {
  // Check explicit mapping first
  if (variablePath in MARKER_MAP) {
    return MARKER_MAP[variablePath];
  }
  
  // Derive from path parts
  const parts = variablePath.split('.');
  if (parts.length > 1) {
    // For nested paths like 'capsule.head', use the last part
    return parts[parts.length - 1].toUpperCase();
  }
  
  // For top-level paths, use the surface name
  return variablePath.toUpperCase().replace(/-/g, '_');
}

/**
 * Resolve multiple variable paths.
 */
export async function resolveVariables(
  sessionId: string,
  variablePaths: string[]
): Promise<ResolvedVariable[]> {
  const results: ResolvedVariable[] = [];
  
  for (const path of variablePaths) {
    const resolved = await resolveVariable(sessionId, path);
    results.push(resolved);
  }
  
  return results;
}

/**
 * Format an object as readable text for LLM consumption.
 * Converts YAML-like structures to human-readable format.
 */
export function formatContent(content: object | null): string {
  if (content === null || content === undefined) {
    return '(empty)';
  }
  
  if (typeof content !== 'object') {
    return String(content);
  }
  
  if (Array.isArray(content)) {
    if (content.length === 0) {
      return '(none)';
    }
    return content.map((item, index) => formatArrayItem(item, index)).join('\n');
  }
  
  // Object
  const lines: string[] = [];
  for (const [key, value] of Object.entries(content)) {
    lines.push(formatField(key, value));
  }
  
  return lines.join('\n') || '(empty)';
}

function formatField(key: string, value: any): string {
  const label = formatLabel(key);
  
  if (value === null || value === undefined) {
    return `${label}: (none)`;
  }
  
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return `${label}: (none)`;
    }
    const items = value.map((item, i) => formatArrayItem(item, i)).join('\n');
    return `${label}:\n${items}`;
  }
  
  if (typeof value === 'object') {
    const nested = formatContent(value);
    return `${label}:\n${indent(nested)}`;
  }
  
  return `${label}: ${value}`;
}

function formatArrayItem(item: any, index: number): string {
  if (typeof item === 'object' && item !== null) {
    // Handle common patterns like recentTurns
    if ('turnId' in item && 'userInput' in item) {
      return `- Turn ${item.turnId}: ${item.userInput}`;
    }
    if ('content' in item) {
      return `- ${item.content}`;
    }
    // Generic object in array
    const parts = Object.entries(item)
      .map(([k, v]) => `${k}: ${v}`)
      .join(', ');
    return `- ${parts}`;
  }
  return `- ${item}`;
}

function formatLabel(key: string): string {
  // Convert camelCase to Title Case with spaces
  return key
    .replace(/([A-Z])/g, ' $1')
    .replace(/^./, str => str.toUpperCase())
    .trim();
}

function indent(text: string, spaces: number = 2): string {
  const prefix = ' '.repeat(spaces);
  return text.split('\n').map(line => prefix + line).join('\n');
}

/**
 * Assemble a capsule from resolved variables.
 * Creates marked sections for LLM consumption.
 * 
 * Format:
 * [MARKER: variable.path]
 * {formatted content}
 * 
 * [MARKER: variable.path]
 * {formatted content}
 * 
 * [USER]
 * {userInput if provided}
 */
export function assembleCapsule(
  resolvedVariables: ResolvedVariable[],
  userInput?: string
): AssembledCapsule {
  const sections: string[] = [];
  
  // Add each resolved variable as a marked section
  for (const variable of resolvedVariables) {
    const section = formatSection(variable);
    sections.push(section);
  }
  
  // Add user input section if provided
  if (userInput) {
    sections.push(`[USER]\n${userInput}`);
  }
  
  return {
    text: sections.join('\n\n'),
    variables: resolvedVariables
  };
}

function formatSection(variable: ResolvedVariable): string {
  const header = `[${variable.marker}: ${variable.path}]`;
  const content = formatContent(variable.content);
  return `${header}\n${content}`;
}

/**
 * High-level function to resolve variables and assemble capsule.
 * This is the main entry point for capsule compilation.
 */
export async function compileCapsule(
  sessionId: string,
  variablePaths: string[],
  userInput?: string
): Promise<AssembledCapsule> {
  const resolved = await resolveVariables(sessionId, variablePaths);
  return assembleCapsule(resolved, userInput);
}
