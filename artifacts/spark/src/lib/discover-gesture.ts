export type SwipeDirection = 'pass' | 'like' | 'spark';

const SWIPE_DISTANCE = 110;
const FLICK_DISTANCE = 42;
const FLICK_VELOCITY = 650;
const AXIS_DOMINANCE = 1.2;

/** Resolve a completed card gesture without treating short, ambiguous movement as a swipe. */
export function resolveSwipeDirection(
  offset: { x: number; y: number },
  velocity: { x: number; y: number },
): SwipeDirection | null {
  const distanceX = Math.abs(offset.x);
  const distanceY = Math.abs(offset.y);
  const horizontalDominant = distanceX > distanceY * AXIS_DOMINANCE;
  const verticalDominant = distanceY > distanceX * AXIS_DOMINANCE;

  const committed = (distance: number, direction: number, speed: number) =>
    distance >= SWIPE_DISTANCE ||
    (distance >= FLICK_DISTANCE && direction * speed >= FLICK_VELOCITY);

  if (horizontalDominant && committed(distanceX, Math.sign(offset.x), velocity.x)) {
    return offset.x > 0 ? 'like' : 'pass';
  }

  if (
    verticalDominant &&
    offset.y < 0 &&
    committed(distanceY, Math.sign(offset.y), velocity.y)
  ) {
    return 'spark';
  }

  return null;
}
