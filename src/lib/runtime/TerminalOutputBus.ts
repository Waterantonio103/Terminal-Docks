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

function decodePtyBytes(data: number[] | Uint8Array): { bytes: Uint8Array; text: string } {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  return {
    bytes,
    text: new TextDecoder().decode(bytes),
  };
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

  constructor(
    private maxChunks = DEFAULT_MAX_CHUNKS,
    private maxChars = DEFAULT_MAX_CHARS,
  ) {}

  start(): Promise<void> {
    if (this.startPromise) return this.startPromise;

    this.startPromise = listen<{ id: string; data: number[] }>('pty-out', event => {
      const { bytes, text } = decodePtyBytes(event.payload.data);
      this.append({
        terminalId: event.payload.id,
        bytes,
        text,
        at: Date.now(),
      });
    }).then(unlisten => {
      this.unlisten = unlisten;
    });

    return this.startPromise;
  }

  append(chunk: Omit<PtyChunk, 'seq'>): void {
    let buf = this.buffers.get(chunk.terminalId);
    if (!buf) {
      buf = { chunks: [], totalChars: 0, seq: 0, maxChunks: this.maxChunks, maxChars: this.maxChars };
      this.buffers.set(chunk.terminalId, buf);
    }

    buf.seq += 1;
    const seqChunk: PtyChunk = { ...chunk, seq: buf.seq };
    buf.chunks.push(seqChunk);
    buf.totalChars += chunk.text.length;
    trimBuffer(buf);

    for (const listener of this.listeners.get(chunk.terminalId) ?? []) {
      try {
        listener(seqChunk);
      } catch {
        // Listener failures must not break terminal output delivery.
      }
    }
  }

  subscribe(terminalId: string, cb: TerminalOutputListener): () => void {
    void this.start();
    const listeners = this.listeners.get(terminalId) ?? new Set<TerminalOutputListener>();
    listeners.add(cb);
    this.listeners.set(terminalId, listeners);

    return () => {
      const current = this.listeners.get(terminalId);
      if (!current) return;
      current.delete(cb);
      if (current.size === 0) {
        this.listeners.delete(terminalId);
      }
    };
  }

  getSequence(terminalId: string): number {
    return this.buffers.get(terminalId)?.seq ?? 0;
  }

  getText(terminalId: string): string {
    const buf = this.buffers.get(terminalId);
    if (!buf || buf.chunks.length === 0) return '';
    return buf.chunks.map(c => c.text).join('');
  }

  getTail(terminalId: string, maxChars: number): string {
    const text = this.getText(terminalId);
    if (text.length <= maxChars) return text;
    return text.slice(text.length - maxChars);
  }

  getChunksSince(terminalId: string, afterSeq: number): PtyChunk[] {
    const buf = this.buffers.get(terminalId);
    if (!buf || buf.chunks.length === 0) return [];
    if (afterSeq <= 0) return [...buf.chunks];
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
    this.buffers.delete(terminalId);
  }

  getBufferInfo(terminalId: string): { chunkCount: number; totalChars: number; seq: number } {
    const buf = this.buffers.get(terminalId);
    if (!buf) return { chunkCount: 0, totalChars: 0, seq: 0 };
    return { chunkCount: buf.chunks.length, totalChars: buf.totalChars, seq: buf.seq };
  }

  dispose(): void {
    this.unlisten?.();
    this.unlisten = null;
    this.startPromise = null;
    this.buffers.clear();
    this.listeners.clear();
  }
}

export const terminalOutputBus = new TerminalOutputBus();
