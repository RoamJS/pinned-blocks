export type ReferencePin = { targetUid: string; blockUid: string };

export const getReferencePinKey = ({
  targetUid,
  blockUid,
}: ReferencePin): string => `${targetUid}:${blockUid}`;

export const getReferenceTargetUid = (id: string): string | null =>
  id.match(
    /-mentions-(?:page|block)-(\d{2}-\d{2}-\d{4}|[A-Za-z0-9_-]{9})-/,
  )?.[1] || null;
