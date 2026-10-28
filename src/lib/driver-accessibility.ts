/** Driver.js uses an invisible div with button-only ARIA attributes. */
export function normalizeDriverAccessibility(): void {
  const target = document.getElementById("driver-dummy-element");
  if (!target) return;
  target.setAttribute("role", "button");
  target.setAttribute("aria-label", "Guided tour focus target");
  target.setAttribute("tabindex", "-1");
}
