# Linked reference pinning

The user-approved request is: “The ability to pin select references in the linked reference section to the top of the results.” The follow-up authorizes real Roam screenshots and video, a Claude Fable 5.1 UI/UX review, improvements within this feature, a pull request, and up to three PR review rounds.

## Scope and acceptance

- A user can pin and unpin individual linked-reference results.
- All rendered pinned results appear before unpinned results, including results from different source-page groups.
- Pin membership is saved per target page or block using shared graph records.
- Pinning references preserves the source outline order and the existing outline-pin behavior.
- Native reference editing, source context, and Roam filters remain usable.
- Extension unload removes its controls and restores native layout.
- Desktop and narrower layouts clearly distinguish pinned and unpinned references.

This work does not change production publishing, graph-wide reference sorting, or unrelated extension features. A filter or collapsed group can exclude a pinned reference from the rendered results. This feature does not force those results to appear.

## Verification and capture

Run `npm test` and `npx tsc --noEmit`. Browser tests can use an existing Chromium executable via `ROAM_BROWSER_EXECUTABLE_PATH` when Playwright's bundled browser is unavailable.

Build with `npx samepage build --dry`, then run:

```sh
node scripts/capture-linked-references.mjs local/linked-references-media/<unique-run-name>
```

The capture runner uses the RoamJS Playwright session and extension-loader skills. `ROAMJS_SKILLS_ROOT` can select the repository's canonical skill collection. Use `ROAM_PLAYWRIGHT_ENV_PATH`, `ROAM_PROFILE_DIR`, and `PLAYWRIGHT_PACKAGE_ROOT` to select an existing environment, authenticated profile, and Playwright runtime. Credentials and profile contents stay outside the repository.

The runner captures the real browser with Chromium's screencast API, retains source frame timestamps, writes a silent MP4 and six screenshots, and records checksums and behavior assertions in `media-manifest.json`. It refuses to overwrite completed captures. Fixture cleanup runs after recording ends.

The model's video review uses extracted timeline frames and full-resolution screenshots. This is a visual and temporal review, not native MP4 playback or an audio review. Generated media, reviewer logs, and raw captures stay under ignored `local/` directories.
