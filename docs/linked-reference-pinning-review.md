# Linked reference UI/UX review

Claude Fable 5.1 completed a read-only review on October 12, 2026. The runtime initialization record confirmed `claude-fable-5-1`; the terminal result was successful. The reviewer inspected all six screenshots, five source files, and all 36 frames sampled every half-second across the complete 18-second recording. The source video checksum was `74e9bd774886123246c3595ae879b5f0b2b00b785936cf67b604b21f518bd6cc`.

The review used video frames and screenshots, not native MP4 playback. The recording is silent. Separately, Chromium played the MP4 to its end without a media error, and FFmpeg decoded the entire file.

## Findings and changes

| Finding                                                | Disposition                                                                                                                           |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| Daily note target IDs were rejected                    | Accept ten-character daily note IDs in both rendered target parsing and shared record validation.                                     |
| Pinned rows narrowed when source labels appeared       | Reserve a fixed control column and render source captions above the block, keeping the content width stable.                          |
| Source labels truncated the distinguishing title text  | Show full, wrapping source titles, with no caption for missing titles.                                                                |
| Flattening native groups shifted rows left             | Preserve the native grouped-reference insets when displaying the pinned rows first.                                                   |
| No pending state allowed repeated toggles while saving | Disable and show a loading state for all controls sharing the pending pin key. Ignore repeated clicks until synchronization finishes. |
| Pinned results lacked a heading                        | Add “Pinned references” with the number of rendered pins.                                                                             |
| Pinning all results left an empty source heading       | Hide that heading while all its rendered rows are pinned, and restore it after unpinning or unload.                                   |
| Hard-coded source-label color could clash with themes  | Inherit the native text color and expose `--roamjs-reference-pin-source-color`.                                                       |
| Relative pinned order was unclear                      | Document that pins retain the current native reference ordering among themselves, rather than the order of clicks.                    |
| Video clicks lacked a visible cursor                   | Add a capture-only cursor indicator and click ring following actual browser pointer events. Show a hover hold before each new pin.    |

Native DOM order and Tab navigation continue to follow Roam's grouping. Pin controls support Up and Down arrows in their displayed order and remain operable with native keyboard activation. Moving Roam-owned result nodes would risk disrupting its rendering lifecycle; this implementation retains those nodes.

The recapture verifies multiple pins from different source groups, independent target pages, source outline preservation, stable row width and horizontal alignment, a daily note target, and a narrower layout. Unit and browser tests cover pending toggles, daily note record persistence, layout, target reuse, and cleanup after an in-flight toggle.

Complete reviewer logs and versioned original/updated media remain in ignored local output directories. This review does not approve production publication or establish a normal-speed human playback review.
