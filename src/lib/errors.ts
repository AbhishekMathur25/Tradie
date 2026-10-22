/**
 * An error whose message is safe and useful to show to the person using the
 * app ("Deposits can't exceed 10%..."). Anything else is a bug and is logged,
 * not shown.
 */
export class UserFacingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UserFacingError";
  }
}

/** Thrown when an edit was based on an out-of-date copy of a record. */
export class StaleRecordError extends UserFacingError {
  constructor() {
    super("Someone changed this while you were editing. Reload the page and try again.");
    this.name = "StaleRecordError";
  }
}
