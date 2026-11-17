// Called only after ownership validation. Retain ordering even after a socket
// closes so a delayed older upgrade cannot evict a successful newer attempt.
export class StreamAttempts {
  client = null;
  latest = 0;
  accept(client, attempt) {
    if (!Number.isSafeInteger(attempt) || attempt < 0) return false;
    if (this.client !== client) { this.client = client; this.latest = 0; }
    if (attempt === 0) return this.latest === 0; // pre-versioned clients
    if (attempt <= this.latest) return false;
    this.latest = attempt;
    return true;
  }
}
