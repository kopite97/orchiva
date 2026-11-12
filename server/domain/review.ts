import { reviewSchema, type RequestRecord } from "../../shared/contracts/feature-request";
import type { z } from "zod";

/** Server authority: a passed check is evidence, never an automatic criterion verdict. */
export function validateReview(record: RequestRecord, input: z.infer<typeof reviewSchema>) {
  if (input.expectedRevision === undefined || !input.commandKey) throw new Error("REVIEW_REQUIRED: revision and command key required");
  const result = record.result!;
  const reviews = input.criteriaReviews;
  if (!record.criteria.length || !reviews || reviews.length !== record.criteria.length || new Set(reviews.map(x => x.criterionId)).size !== record.criteria.length) throw new Error("REVIEW_REQUIRED: review every criterion exactly once");
  for (const review of reviews) {
    const criterion = record.criteria.find(x => x.id === review.criterionId);
    if (!criterion) throw new Error("INVALID_REFERENCE: criterion");
    for (const ref of review.evidenceRefs) {
      if (ref.kind === "check" ? !result.checks.some(x => x.checkId === ref.id) : !result.files?.some(x => x.path === ref.id)) throw new Error("INVALID_REFERENCE: evidence must belong to this result");
    }
    if (!review.evidenceRefs.length && review.note.trim().length < 10) throw new Error("REVIEW_REQUIRED: concrete manual evidence (at least 10 characters)");
    if (!result.checks.length && review.note.trim().length < 10) throw new Error("REVIEW_REQUIRED: manual evidence required without automated checks");
    if (input.approved && !review.satisfied) throw new Error("REVIEW_REQUIRED: every criterion must be satisfied");
  }
  if (input.approved && (result.failure || result.executionFailure || result.checks.some(x => !x.passed || (x.status && x.status !== "passed")))) throw new Error("INVALID_STATE: failed evidence cannot be approved");
  if (input.approved && result.testChanges?.length && (!input.testChangesAcknowledged || (input.testChangeNote?.trim().length ?? 0) < 10)) throw new Error("TEST_CHANGE_REQUIRED: acknowledge changed check inputs with a reason (at least 10 characters)");
}
