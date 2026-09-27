// Exactly one composer submission at a time. Once passed to the transport,
// never automatically resend: a missing ACK does not mean it wasn't executed.
export class InputDelivery {
  constructor({ send, onChange, onSuccess, onFailure, timeoutMs = 30000,
    setTimer = setTimeout, clearTimer = clearTimeout, createId = () => crypto.randomUUID() }) {
    Object.assign(this, { send, onChange, onSuccess, onFailure, timeoutMs, setTimer, clearTimer, createId });
    this.job = null;
  }

  submit(text, sessionSlug) {
    if (this.job) return false;
    const job = { text, sessionSlug, inputId: this.createId(), phase: "queued" };
    this.job = job;
    job.timer = this.setTimer(() => this.fail(job), this.timeoutMs);
    this.onChange(job);
    return true;
  }

  flush(sessionSlug, ready) {
    const job = this.job;
    if (!ready || !job || job.sessionSlug !== sessionSlug || job.phase !== "queued") return;
    job.phase = "sent";
    this.onChange(job);
    try {
      const sent = this.send({ type: "input", session: sessionSlug, data: `${job.text}\r`, inputId: job.inputId });
      if (!sent && this.job === job) {
        job.phase = "queued";
        this.onChange(job);
      }
    } catch {
      this.fail(job);
    }
  }

  ack(inputId, sessionSlug) {
    const job = this.job;
    if (!job || job.phase !== "sent" || job.inputId !== inputId || job.sessionSlug !== sessionSlug) return false;
    this.finish(job);
    this.onSuccess(job);
    return true;
  }

  fail(job = this.job) {
    if (!job || this.job !== job) return;
    this.finish(job);
    this.onFailure(job);
  }

  finish(job) {
    this.clearTimer(job.timer);
    this.job = null;
    this.onChange(null);
  }
}
