/** Thrown by job pipelines when the user cancels; workers report it as `cancelled`, not `failed`. */
export class CancelledError extends Error {
  constructor() {
    super("Cancelled");
  }
}
