/**
 * Module-level coordination so only one music preview plays at a time
 * across every MediaCard. Card components register their <audio> element
 * via `playExclusively()`; the previous active audio gets paused and
 * reset before the new one starts.
 *
 * No React state involved — audio elements are DOM, and pausing one is
 * a side-effect. Cards listen for their own `pause` event to update
 * their own "is playing" indicator.
 */

let currentAudio: HTMLAudioElement | null = null;

/** Play this audio element, pausing any other preview currently playing. */
export function playExclusively(audio: HTMLAudioElement): Promise<void> {
  if (currentAudio && currentAudio !== audio) {
    currentAudio.pause();
    currentAudio.currentTime = 0;
  }
  currentAudio = audio;
  return audio.play();
}

/** Stop whatever is currently playing, if anything. Idempotent. */
export function stopAll(): void {
  if (currentAudio) {
    currentAudio.pause();
    currentAudio.currentTime = 0;
    currentAudio = null;
  }
}

/** For tests / cleanup — inspects internal state without exporting it. */
export function _currentAudioForTest(): HTMLAudioElement | null {
  return currentAudio;
}
