/**
 * TerminalOutputBus.ts — Global PTY output buffer and event bus.
 *
 * Subscribes once to the Tauri `pty-out` event and maintains a per-terminal
 * ring buffer of recent output chunks. Provides:
 * - Sequence-tracked replay for zero-duplicate remount
 * - Efficient tail retrieval for CLI readiness detection
 * - Live subscriber dispatch
 * - Automatic buffer cleanup
 *
 * Phase 4 — PTY Output Bus and Terminal Views
 */

import { listen } from '@tauri-apps/api/event';
import { normalizeTerminalId } from '../terminalIds.js';

export interface PtyChunk {
  terminalId: string;
  bytes: Uint8Array;
  text: string;
  at: number;
  seq: number;
}

type TerminalOutputListener = (chunk: PtyChunk) => void;

const DEFAULT_MAX_CHUNKS = 600;
const DEFAULT_MAX_CHARS = 64_000;

interface TerminalBuffer {
  chunks: PtyChunk[];
  totalChars: number;
  seq: number;
  maxChunks: number;
  maxChars: number;
}

function bytesFromPtyData(data: number[] | Uint8Array): Uint8Array {
  return data instanceof Uint8Array ? data : new Uint8Array(data);
}

function decodePtyBytes(data: number[] | Uint8Array, decoder = new TextDecoder()): { bytes: Uint8Array; text: string } {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  return {
    bytes,
    text: decoder.decode(bytes, { stream: true }),
  };
}

function normalizePositiveInteger(value: number, fallback: number): number {
  if (!Number.isFinite(value) || value <= 0) return fallback;
  return Math.max(1, Math.floor(value));
}

function trimBuffer(buf: TerminalBuffer): void {
  while (buf.chunks.length > buf.maxChunks) {
    const removed = buf.chunks.shift()!;
    buf.totalChars -= removed.text.length;
  }
  while (buf.totalChars > buf.maxChars && buf.chunks.length > 1) {
    const removed = buf.chunks.shift()!;
    buf.totalChars -= removed.text.length;
  }
}

export class TerminalOutputBus {
  private buffers = new Map<string, TerminalBuffer>();
  private listeners = new Map<string, Set<TerminalOutputListener>>();
  private startPromise: Promise<void> | null = null;
  private unlisten: (() => void) | null = null;
  private decoders = new Map<string, TextDecoder>();
  private readonly maxBufferChunks: number;
  private readonly maxBufferChars: number;

  constructor(
    maxChunks = DEFAULT_MAX_CHUNKS,
    maxChars = DEFAULT_MAX_CHARS,
  ) {
    this.maxBufferChunks = normalizePositiveInteger(maxChunks, DEFAULT_MAX_CHUNKS);
    this.maxBufferChars = normalizePositiveInteger(maxChars, DEFAULT_MAX_CHARS);
  }

  start(): Promise<void> {
    if (this.startPromise) return this.startPromise;

    this.startPromise = listen<{ id: string; data: number[] }>('pty-out', event => {
      this.appendBytes(event.payload.id, event.payload.data);
    }).then(unlisten => {
      this.unlisten = unlisten;
    }).catch(error => {
      this.startPromise = null;
      throw error;
    });

    return this.startPromise;
  }

  appendBytes(terminalId: string, data: number[] | Uint8Array, at = Date.now()): void {
    const normalizedTerminalId = normalizeTerminalId(terminalId);
    if (!normalizedTerminalId) return;
    const bytes = bytesFromPtyData(data);
    if (bytes.length === 0) return;
    const decoder = this.decoders.get(normalizedTerminalId) ?? new TextDecoder();
    this.decoders.set(normalizedTerminalId, decoder);
    const { text } = decodePtyBytes(bytes, decoder);
    this.append({
      terminalId: normalizedTerminalId,
      bytes,
      text,
      at,
    });
  }

  append(chunk: Omit<PtyChunk, 'seq'>): void {
    const terminalId = normalizeTerminalId(chunk.terminalId);
    if (!terminalId) return;

    let buf = this.buffers.get(terminalId);
    if (!buf) {
      buf = { chunks: [], totalChars: 0, seq: 0, maxChunks: this.maxBufferChunks, maxChars: this.maxBufferChars };
      this.buffers.set(terminalId, buf);
    }

    buf.seq += 1;
    const seqChunk: PtyChunk = { ...chunk, terminalId, seq: buf.seq };
    buf.chunks.push(seqChunk);
    buf.totalChars += chunk.text.length;
    trimBuffer(buf);

    for (const listener of this.listeners.get(terminalId) ?? []) {
      try {
        listener(seqChunk);
      } catch {
        // Listener failures must not break terminal output delivery.
      }
    }
  }

  subscribe(terminalId: string, cb: TerminalOutputListener): () => void {
    const normalizedTerminalId = normalizeTerminalId(terminalId);
    if (!normalizedTerminalId) return () => {};

    void this.start();
    const listeners = this.listeners.get(normalizedTerminalId) ?? new Set<TerminalOutputListener>();
    listeners.add(cb);
    this.listeners.set(normalizedTerminalId, listeners);

    return () => {
      const current = this.listeners.get(normalizedTerminalId);
      if (!current) return;
      current.delete(cb);
      if (current.size === 0) {
        this.listeners.delete(normalizedTerminalId);
      }
    };
  }

  getSequence(terminalId: string): number {
    const normalizedTerminalId = normalizeTerminalId(terminalId);
    if (!normalizedTerminalId) return 0;
    return this.buffers.get(normalizedTerminalId)?.seq ?? 0;
  }

  getText(terminalId: string): string {
    const normalizedTerminalId = normalizeTerminalId(terminalId);
    if (!normalizedTerminalId) return '';
    const buf = this.buffers.get(normalizedTerminalId);
    if (!buf || buf.chunks.length === 0) return '';
    return buf.chunks.map(c => c.text).join('');
  }

  getTail(terminalId: string, maxChars: number): string {
    if (!Number.isFinite(maxChars) || maxChars <= 0) return '';
    const normalizedTerminalId = normalizeTerminalId(terminalId);
    if (!normalizedTerminalId) return '';
    const buf = this.buffers.get(normalizedTerminalId);
    if (!buf || buf.chunks.length === 0) return '';

    const targetChars = Math.floor(maxChars);
    const parts: string[] = [];
    let remaining = targetChars;
    for (let index = buf.chunks.length - 1; index >= 0 && remaining > 0; index -= 1) {
      const text = buf.chunks[index].text;
      if (text.length <= remaining) {
        parts.push(text);
        remaining -= text.length;
        continue;
      }
      parts.push(text.slice(text.length - remaining));
      break;
    }
    return parts.reverse().join('');
  }

  getChunksSince(terminalId: string, afterSeq: number): PtyChunk[] {
    const normalizedTerminalId = normalizeTerminalId(terminalId);
    if (!normalizedTerminalId) return [];
    const buf = this.buffers.get(normalizedTerminalId);
    if (!buf || buf.chunks.length === 0) return [];
    if (!Number.isFinite(afterSeq) || afterSeq <= 0) return [...buf.chunks];
    const idx = buf.chunks.findIndex(c => c.seq > afterSeq);
    if (idx === -1) return [];
    return buf.chunks.slice(idx);
  }

  getTextSince(terminalId: string, afterSeq: number): string {
    return this.getChunksSince(terminalId, afterSeq).map(c => c.text).join('');
  }

  getBytesSince(terminalId: string, afterSeq: number): Uint8Array[] {
    return this.getChunksSince(terminalId, afterSeq).map(c => c.bytes);
  }

  clear(terminalId: string): void {
    const normalizedTerminalId = normalizeTerminalId(terminalId);
    if (!normalizedTerminalId) return;
    this.buffers.delete(normalizedTerminalId);
    this.decoders.delete(normalizedTerminalId);
  }

  getBufferInfo(terminalId: string): { chunkCount: number; totalChars: number; seq: number } {
    const normalizedTerminalId = normalizeTerminalId(terminalId);
    if (!normalizedTerminalId) return { chunkCount: 0, totalChars: 0, seq: 0 };
    const buf = this.buffers.get(normalizedTerminalId);
    if (!buf) return { chunkCount: 0, totalChars: 0, seq: 0 };
    return { chunkCount: buf.chunks.length, totalChars: buf.totalChars, seq: buf.seq };
  }

  dispose(): void {
    this.unlisten?.();
    this.unlisten = null;
    this.startPromise = null;
    this.buffers.clear();
    this.listeners.clear();
    this.decoders.clear();
  }
}

export const terminalOutputBus = new TerminalOutputBus();
