export const pinButtonStyles = (controlClass: string): string => `
  .${controlClass} > button.bp3-button.bp3-minimal[aria-pressed] {
    background: none !important;
    box-shadow: none !important;
    color: #b8c4ce;
  }
  .${controlClass} > button.bp3-button.bp3-minimal:hover,
  .${controlClass} > button.bp3-button.bp3-minimal:focus-visible {
    background: rgba(167, 182, 194, 0.15) !important;
  }
  .${controlClass} > button.bp3-button.bp3-minimal[aria-pressed="true"] {
    color: #5c7080;
  }
  .${controlClass} > button.bp3-button.bp3-minimal[aria-pressed] > .bp3-icon {
    color: inherit;
  }
`;
