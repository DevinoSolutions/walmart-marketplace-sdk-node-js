import type { z } from "zod";
import { WalmartValidationError, type WalmartValidationIssue } from "../errors/index.js";

/**
 * Validates caller input against a zod schema and throws {@link WalmartValidationError} on
 * failure.
 *
 * Input validation happens BEFORE the request is built, which matters most for the write
 * paths: a malformed price or shipment body that Walmart accepts-then-half-applies is far
 * more expensive to undo than a local rejection.
 */
export function parseInput<S extends z.ZodType>(
  schema: S,
  input: unknown,
  label: string,
): z.output<S> {
  const result = schema.safeParse(input);
  if (result.success) return result.data;
  const issues: WalmartValidationIssue[] = result.error.issues.map((issue) => ({
    path: issue.path.map(String).join("."),
    message: issue.message,
  }));
  const summary = issues
    .map((i) => (i.path === "" ? i.message : `${i.path}: ${i.message}`))
    .join("; ");
  throw new WalmartValidationError(`Invalid ${label}: ${summary}`, issues);
}
