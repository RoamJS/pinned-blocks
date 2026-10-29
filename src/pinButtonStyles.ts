export const pinButtonStyles = (controlClass: string): string => `
  .${controlClass} > button.bp3-button.bp3-minimal {
    background: none !important;
    box-shadow: none !important;
    color: #f5f8fa;
  }
  .${controlClass} > button.bp3-button.bp3-minimal:hover,
  .${controlClass} > button.bp3-button.bp3-minimal:focus-visible,
  .${controlClass} > button.bp3-button.bp3-minimal[aria-pressed="true"] {
    color: #5c7080;
  }
  .${controlClass} > button.bp3-button.bp3-minimal[aria-pressed] > .bp3-icon {
    color: inherit;
  }
`;
