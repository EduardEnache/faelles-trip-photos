/**
 * SSE broadcast hub. Each connected client gets a `send` callback; broadcast
 * pushes a ServerEvent to all of them.
 */
import type { ServerEvent } from '@shared/api';

type Sender = (event: ServerEvent) => void;

export class EventHub {
  private clients = new Set<Sender>();

  subscribe(send: Sender): () => void {
    this.clients.add(send);
    return () => this.clients.delete(send);
  }

  broadcast(event: ServerEvent): void {
    for (const send of this.clients) {
      try {
        send(event);
      } catch {
        // dead connection; it will be cleaned up by its own close handler
      }
    }
  }

  get clientCount(): number {
    return this.clients.size;
  }
}
