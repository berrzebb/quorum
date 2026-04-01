/**
 * Shared hash utility for autonomy modules.
 *
 * @module autonomy/hash-util
 * @since RAI-5
 */

/** djb2 hash — fast non-crypto string fingerprint for comparison. */
export function djb2Hash(str: string): string {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash + str.charCodeAt(i)) | 0;
  }
  return (hash >>> 0).toString(36);
}
