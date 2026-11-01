function samePosition(left, right) {
  return left?.q === right?.q && left?.r === right?.r;
}

export function movementResultBoundary(result) {
  if (!result?.transition || result.transition.type !== "move") return true;
  if (result.status !== "executed") return true;
  if (result.reactionPlan || result.hazardOutcomes?.length || result.effectOutcomes?.length || result.reactionOutcomes?.length) return true;
  return false;
}

export function canGroupNextMovement(plan, elementIndex, result) {
  if (movementResultBoundary(result)) return false;
  const current = plan?.elements?.[elementIndex];
  const next = plan?.elements?.[elementIndex + 1];
  return current?.type === "move"
    && next?.type === "move"
    && current.heading === next.heading
    && samePosition(current.to, next.from);
}

export function planMovementAnimationSegment(plan, startElement, execute) {
  const results = [];
  let elementIndex = startElement;
  while (true) {
    const result = execute(elementIndex);
    results.push(result);
    if (!canGroupNextMovement(plan, elementIndex, result)) break;
    elementIndex++;
  }
  const transitions = results.map(result => result?.transition).filter(Boolean);
  return Object.freeze({
    startElement,
    elementCount: transitions.length,
    transitions: Object.freeze(transitions),
    result: results.at(-1)
  });
}

export function sampleMovementAnimationSegment(segment, progress) {
  const transitions = segment?.transitions || [];
  if (!transitions.length) return null;
  const scaled = Math.min(1, Math.max(0, progress)) * transitions.length;
  const index = Math.min(transitions.length - 1, Math.floor(scaled));
  const localProgress = progress >= 1 ? 1 : scaled - index;
  const transition = transitions[index];
  return {
    transition,
    progress: localProgress,
    position: {
      q: transition.before.position.q + (transition.after.position.q - transition.before.position.q) * localProgress,
      r: transition.before.position.r + (transition.after.position.r - transition.before.position.r) * localProgress
    }
  };
}

export function movementAnimationContinuation(result) {
  if (result?.status === "reaction-pending") return "reaction";
  if (result?.status === "executed") return "next";
  return "finish";
}

export function reactionAnimationContinuation(resumed) {
  if (resumed?.status === "reaction-pending") return "reaction";
  if (resumed?.status === "executed") return "next";
  return "finish";
}
