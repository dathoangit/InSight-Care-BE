export function buildBedNames(roomName: string, bedCount: number): string[] {
  if (bedCount <= 0) {
    return [];
  }

  if (roomName.toUpperCase() === 'CC') {
    return Array.from({ length: bedCount }, (_, index) => `cc${index + 1}`);
  }

  if (bedCount === 1) {
    return [roomName];
  }

  if (bedCount === 2) {
    return [`${roomName}A`, `${roomName}B`];
  }

  return Array.from(
    { length: bedCount },
    (_, index) => `${roomName}${index + 1}`,
  );
}
