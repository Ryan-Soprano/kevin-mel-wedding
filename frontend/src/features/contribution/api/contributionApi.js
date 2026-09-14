export class ContributionValidationError extends Error {}

export async function createContribution(contribution) {
  const response = await fetch("/api/contributions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(contribution),
  });

  if (response.status === 400) {
    const validation = await response.json();
    throw new ContributionValidationError(validation.errors.join(" "));
  }

  if (!response.ok) {
    throw new Error(`Request failed: HTTP ${response.status}`);
  }

  return response.json();
}
