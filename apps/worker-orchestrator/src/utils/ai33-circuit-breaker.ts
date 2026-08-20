import { checkHealth } from "./ai33-management.js";

const RECOVERY_POLL_INTERVAL_MS = 60_000;
const PROACTIVE_POLL_INTERVAL_MS = 10 * 60_000; // check every 10 min — AI33 health endpoint rate-limits at 2 min

type CircuitState = "closed" | "open";

class AI33CircuitBreaker {
  private state: CircuitState = "closed";
  private recoveryTimer: NodeJS.Timeout | null = null;
  private proactiveTimer: NodeJS.Timeout | null = null;

  isOpen(): boolean {
    return this.state === "open";
  }

  /** Call once at startup. Immediately checks health and opens circuit if imagen is down,
   * then polls every 2 minutes to catch outages before any job fails. */
  async init(apiKey: string): Promise<void> {
    await this._checkAndAct(apiKey, "startup");
    if (this.proactiveTimer) clearInterval(this.proactiveTimer);
    this.proactiveTimer = setInterval(async () => {
      if (this.state === "open") return; // recovery loop handles it
      await this._checkAndAct(apiKey, "proactive-poll");
    }, PROACTIVE_POLL_INTERVAL_MS);
  }

  private async _checkAndAct(apiKey: string, reason: string): Promise<void> {
    try {
      const health = await checkHealth(apiKey);
      const imagenDown =
        health.imagen_is_down === true ||
        health.imagen === "maintenance" ||
        health.imagen === "degraded" ||
        health.imagen === "overloaded";
      console.log(
        JSON.stringify({
          level: "info",
          message: `AI33 proactive health check (${reason})`,
          imagen: (health as any).imagen,
          imagen_is_down: imagenDown,
        }),
      );
      if (imagenDown && this.state === "closed") {
        this.openCircuit(
          apiKey,
          `${reason}: imagen=${(health as any).imagen ?? "down"}`,
        );
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(
        JSON.stringify({
          level: "warn",
          message: `AI33 proactive health check failed (${reason})`,
          error: msg,
        }),
      );
    }
  }

  async onError(apiKey: string): Promise<void> {
    if (this.state === "open") return;

    console.log(
      JSON.stringify({
        level: "warn",
        message: "AI33 error — checking health before opening circuit",
      }),
    );

    try {
      const health = await checkHealth(apiKey);
      const imagenDown =
        health.imagen_is_down === true ||
        health.imagen === "maintenance" ||
        health.imagen === "degraded" ||
        health.imagen === "overloaded";
      if (imagenDown) {
        this.openCircuit(apiKey, `imagen: ${(health as any).imagen ?? "down"}`);
      } else {
        console.log(
          JSON.stringify({
            level: "info",
            message:
              "AI33 health good despite error — transient failure, circuit stays closed",
            imagen: (health as any).imagen,
          }),
        );
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(
        JSON.stringify({
          level: "warn",
          message: "AI33 health check itself failed — opening circuit",
          error: msg,
        }),
      );
      this.openCircuit(apiKey, "health-check-failed");
    }
  }

  private openCircuit(apiKey: string, reason: string): void {
    this.state = "open";
    console.log(
      JSON.stringify({
        level: "warn",
        message: "AI33 circuit OPEN — all image gen routed to Gemini only",
        reason,
      }),
    );
    this.startRecoveryLoop(apiKey);
  }

  private startRecoveryLoop(apiKey: string): void {
    if (this.recoveryTimer) return;
    this.recoveryTimer = setInterval(async () => {
      try {
        const health = await checkHealth(apiKey);
        const imagenDown =
          (health as any).imagen_is_down === true ||
          (health as any).imagen === "maintenance" ||
          (health as any).imagen === "degraded" ||
          (health as any).imagen === "overloaded";
        if (!imagenDown) {
          this.closeCircuit();
        } else {
          console.log(
            JSON.stringify({
              level: "info",
              message: "AI33 imagen still down — circuit stays open",
              imagen: (health as any).imagen,
            }),
          );
        }
      } catch {
        // Still unreachable — stay open, try again next interval
      }
    }, RECOVERY_POLL_INTERVAL_MS);
  }

  private closeCircuit(): void {
    if (this.recoveryTimer) {
      clearInterval(this.recoveryTimer);
      this.recoveryTimer = null;
    }
    this.state = "closed";
    console.log(
      JSON.stringify({
        level: "info",
        message:
          "AI33 circuit CLOSED — AI33 fallback restored for image generation",
      }),
    );
    // Restart proactive polling now that we're closed again
  }
}

export const ai33CircuitBreaker = new AI33CircuitBreaker();

// ─── TTS Circuit Breaker ──────────────────────────────────────────────────────

/**
 * Progressive recovery polling schedule for TTS circuit breaker.
 * Returns the next poll interval based on how long the circuit has been open.
 *
 *  0–5 min   → check every 60 s
 *  5–15 min  → check every 2 min
 *  15–30 min → check every 5 min
 *  30–60 min → check every 15 min
 *  1–2 hr    → check every 30 min
 *  2 hr+     → check every 60 min (max)
 */
function ttsRecoveryInterval(openedAtMs: number): number {
  const elapsed = Date.now() - openedAtMs;
  if (elapsed < 5 * 60_000) return 60_000;
  if (elapsed < 15 * 60_000) return 2 * 60_000;
  if (elapsed < 30 * 60_000) return 5 * 60_000;
  if (elapsed < 60 * 60_000) return 15 * 60_000;
  if (elapsed < 2 * 60 * 60_000) return 30 * 60_000;
  return 60 * 60_000;
}

class AI33TTSCircuitBreaker {
  private state: CircuitState = "closed";
  private recoveryTimer: NodeJS.Timeout | null = null;
  private openedAt = 0;

  isOpen(): boolean {
    return this.state === "open";
  }

  /** Milliseconds to delay the next TTS retry when the circuit is open. */
  getDelayMs(): number {
    return this.state === "open" ? ttsRecoveryInterval(this.openedAt) : 0;
  }

  /**
   * Call once at startup (after the image circuit breaker init).
   * Opens the TTS circuit immediately if AI33 is returning 401 or is down,
   * so no TTS jobs waste time on dead AI33 providers before the first failure.
   */
  async init(_apiKey: string): Promise<void> {
    // NO-OP. AI33 /health-check is broken (returns 401/502 inconsistently)
    // even when keys are valid and TTS endpoints work. Don't pre-trip the
    // circuit at startup based on health-check; let real TTS errors trip it.
  }

  async onError(apiKey: string): Promise<void> {
    if (this.state === "open") return;

    console.log(
      JSON.stringify({
        level: "warn",
        message: "AI33 TTS error — checking health before opening circuit",
      }),
    );

    try {
      const health = await checkHealth(apiKey);
      const ttsDown =
        health.elevenlabs === "maintenance" ||
        health.elevenlabs === "degraded" ||
        health.elevenlabs === "overloaded" ||
        health.minimax === "maintenance" ||
        health.minimax === "degraded" ||
        health.minimax === "overloaded";
      if (ttsDown) {
        this.openCircuit(
          apiKey,
          `elevenlabs: ${health.elevenlabs}, minimax: ${health.minimax}`,
        );
      } else {
        console.log(
          JSON.stringify({
            level: "info",
            message:
              "AI33 TTS health good despite error — transient failure, circuit stays closed",
            minimax: health.minimax,
          }),
        );
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // 401 = API key is invalid or expired → TTS is definitely broken for us.
      // Open the circuit immediately so we stop wasting time on every job.
      // Other errors (timeout, network blip) ≠ TTS is down, so stay closed.
      if (msg.includes("401") || msg.toLowerCase().includes("unauthorized")) {
        this.openCircuit(
          apiKey,
          "health-check-401: API key invalid or expired",
        );
      } else {
        console.log(
          JSON.stringify({
            level: "warn",
            message:
              "AI33 health check unreachable — assuming TTS OK, circuit stays closed",
            error: msg,
          }),
        );
      }
    }
  }

  private openCircuit(apiKey: string, reason: string): void {
    this.state = "open";
    this.openedAt = Date.now();
    console.log(
      JSON.stringify({
        level: "warn",
        message:
          "AI33 TTS circuit OPEN — TTS jobs will be delayed until recovery",
        reason,
      }),
    );
    this.scheduleNextCheck(apiKey);
  }

  private scheduleNextCheck(apiKey: string): void {
    if (this.recoveryTimer) clearTimeout(this.recoveryTimer);
    const interval = ttsRecoveryInterval(this.openedAt);
    this.recoveryTimer = setTimeout(async () => {
      this.recoveryTimer = null;
      try {
        const health = await checkHealth(apiKey);
        const ttsDown =
          health.elevenlabs === "maintenance" ||
          health.elevenlabs === "degraded" ||
          health.elevenlabs === "overloaded" ||
          health.minimax === "maintenance" ||
          health.minimax === "degraded" ||
          health.minimax === "overloaded";
        if (!ttsDown) {
          this.closeCircuit();
        } else {
          console.log(
            JSON.stringify({
              level: "info",
              message: "AI33 TTS still down — circuit stays open",
              elevenlabs: health.elevenlabs,
              minimax: health.minimax,
              next_check_ms: ttsRecoveryInterval(this.openedAt),
            }),
          );
          this.scheduleNextCheck(apiKey);
        }
      } catch {
        // Health check unreachable — stay open, schedule next check
        this.scheduleNextCheck(apiKey);
      }
    }, interval);
  }

  private closeCircuit(): void {
    if (this.recoveryTimer) {
      clearTimeout(this.recoveryTimer);
      this.recoveryTimer = null;
    }
    this.state = "closed";
    console.log(
      JSON.stringify({
        level: "info",
        message: "AI33 TTS circuit CLOSED — TTS generation resumed",
      }),
    );
  }
}

export const ai33TTSCircuitBreaker = new AI33TTSCircuitBreaker();
