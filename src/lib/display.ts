/** Small display helpers used by several pages. */
import { isBlocked, type RuleResult } from "@/domain/rules";

export { formatQuantity } from "@/domain/money";

/** Button label that says when the rule checks will stop a send. */
export function isBlockedLabel(results: RuleResult[], label: string): string {
  return isBlocked(results) ? `${label} (blocked: fix the items above)` : label;
}
