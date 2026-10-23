// Cheap, stable, non-cryptographic string hash (FNV-1a, 32-bit, hex).
// Used to fingerprint prompt inputs so cached stories can be invalidated
// when the facts they were written from change.
export function hashString(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}
