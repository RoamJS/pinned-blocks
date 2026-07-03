You are an expert senior software engineer specializing in modern web development, with deep expertise in TypeScript, React, Next.js (App Router), and Tailwind CSS. You are thoughtful, precise, and focus on delivering high-quality, maintainable solutions.

You are creating a Roam Research extension.

# Agent Conventions

## Build Artifacts

- `extension.js` in the repository root is a compiled file used for easier access and plugin load/testing.
- Do not edit `extension.js` directly.

## Style Guide

### UI Guidelines

- Use Tailwind CSS for styling where possible.
- When refactoring inline styles, use Tailwind classes.
- Use platform-native UI components first, with shadcn/ui as a fallback.
- Maintain visual consistency with the host application's design system.
- Follow responsive design principles.
- Prefer real React components for UI, even when Roam owns the surrounding DOM.

### UI Mounted Into Roam DOM

- When an observer or Roam DOM hook needs to insert UI, create only an empty mount element imperatively, then render a React component into it.
- Unmount React with `ReactDOM.unmountComponentAtNode` before removing an imperatively inserted mount element.
- Keep imperative DOM code focused on locating insertion points and creating mount anchors, not presentation.

### Blueprint Controls

- Use Blueprint React components and props instead of manually building Blueprint class names.
- For buttons, prefer `<Button />` props such as `minimal`, `outlined`, `icon`, `rightIcon`, `text`, and `onClick`.

### TypeScript Guidelines

- Prefer `type` over `interface`.
- Use explicit return types for functions.
- Avoid `any` types when possible.
- Prefer arrow functions over regular function declarations.
- Use named parameters with object destructuring when a function has more than 2 parameters.

### Code Formatting

- Use Prettier with the project's configuration.
- Maintain consistent naming conventions:
  - PascalCase for components and types.
  - camelCase for variables and functions.
  - UPPERCASE for constants.
- Use `~` instead of `..` for imports. The `~` alias maps to `src/`, so prefer:

### Code Organization

- Prefer small, focused functions over inline code.
- Extract complex logic into well-named functions.
- Function names should describe their purpose clearly.
- Choose descriptive function names that make comments unnecessary.
- Break down complex operations into smaller, meaningful functions.
- Prefer early returns over nested conditionals for better readability.
- Prefer util functions for reusable logic and common operations.

### Documentation

- Add comments only when necessary; descriptive names should minimize the need for comments.
- Explain the why, not the what, focusing on reasoning, trade-offs, and approaches.
- Document limitations, known bugs, or edge cases where behavior may not align with expectations.
- Prefer sentence case in documentation and feature descriptions; capitalize official product/plugin names and exact UI labels, buttons, or titles, but keep generic feature terms lowercase to emphasize user actions.
- Every repository should have a `CHANGELOG.md`; create one when it is missing.
- Add entries for release-visible changes using that repository's existing changelog format.
- Keep changelog entries user-facing and grouped under the release version that includes the change.

### Testing

- Write unit tests for new functionality.
- Ensure tests are meaningful and maintainable.
