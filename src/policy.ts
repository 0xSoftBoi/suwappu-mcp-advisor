export const ADVISOR_TOOL_ALLOWLIST = new Set([
  "get_portfolio",
  "get_prices",
  "list_chains",
  "get_quote",
]);

export function assertAdvisorToolAllowed(name: string): void {
  if (!ADVISOR_TOOL_ALLOWLIST.has(name)) {
    throw new Error(
      `Tool "${name}" is outside the advisor's local allowlist. This example never calls transaction-preparation or execution tools.`,
    );
  }
}
