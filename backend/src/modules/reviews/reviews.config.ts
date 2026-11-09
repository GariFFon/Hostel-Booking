/** Guests may review a completed stay for this many days after check-out. */
export const REVIEW_WINDOW_DAYS = 60;

/**
 * A guest may edit or delete a review for this many days after posting, and only until the host has replied
 * (otherwise a 1-star review could be turned into 5 stars under an answer that no longer makes sense).
 */
export const REVIEW_EDIT_WINDOW_DAYS = 14;
