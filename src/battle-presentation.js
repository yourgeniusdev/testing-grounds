export function adjacentTooltip(point, size, bounds, preferredWidth = 260, height = 200) {
  const edge = size * Math.sqrt(3) / 2;
  const right = bounds.width - point.x - edge - 16;
  const left = point.x - edge - 16;
  const onRight = right >= preferredWidth || right >= left;
  const width = Math.max(1, Math.min(preferredWidth, onRight ? right : left));
  return { width, left: onRight ? point.x + edge + 8 : point.x - edge - 8 - width, top: Math.max(8, Math.min(point.y - height / 2, bounds.height - height - 8)) };
}

export function damageIndicators(before, after, outcome = "hit") {
  if (outcome === "miss") return [{ text: "Промах", layer: "miss" }];
  const icons = { shield: "◇", armor: "⬡", integrity: "♥", stack: "✈" };
  const values = Object.entries(icons).flatMap(([layer, icon]) => {
    const loss = Math.max(0, (before?.[layer] || 0) - (after?.[layer] || 0));
    return loss ? [{ text: `−${loss} ${icon}`, layer }] : [];
  });
  return values.length ? values : [{ text: "0", layer: "zero" }];
}

export function visualShotSchedule(plan, minimum = 150) {
  let launch = -minimum;
  let arrival = -minimum;
  const steps = plan.steps.map(step => {
    launch = Math.max(step.launchTime, launch + minimum, arrival + minimum - step.duration);
    arrival = launch + step.duration;
    return { ...step, launchTime: launch, arrivalTime: arrival };
  });
  return { ...plan, domainPlan: plan, steps, duration: Math.max(0, ...steps.map(step => step.arrivalTime)) };
}

export function informationTooltipLayout(anchor, viewport, height = 200) {
  const margin = 8;
  const width = Math.max(1, Math.min(220, viewport.width - margin * 2));
  const maxHeight = Math.max(1, viewport.height - margin * 2);
  const visibleHeight = Math.min(height, maxHeight);
  const left = Math.max(margin, Math.min(anchor.x + 12, viewport.width - width - margin));
  const preferredTop = anchor.y + 12 + visibleHeight <= viewport.height - margin ? anchor.y + 12 : anchor.y - visibleHeight - 12;
  return { width, maxHeight, left, top: Math.max(margin, Math.min(preferredTop, viewport.height - visibleHeight - margin)) };
}

export function createActivationTransitionGuard(now = () => performance.now()) {
  let blockedUntil = -Infinity;
  return {
    run(mobile, transition) {
      if (mobile && now() < blockedUntil) return false;
      const result = transition();
      if (mobile && result) blockedUntil = now() + 450;
      return result;
    }
  };
}

export function createHoldGesture() {
  let consumed = false;
  return {
    begin() { consumed = false; },
    consume() { consumed = true; },
    cancel() { consumed = false; },
    click() { const result = consumed; consumed = false; return result; }
  };
}

export function impactPlacement(point, width, height, live) {
  const gap = 6;
  for (let ring = 0; ; ring++) {
    const offsets = ring === 0 ? [[0, 0]] : [[ring, 0], [-ring, 0], [0, ring], [0, -ring], [ring, ring], [-ring, -ring]];
    for (const [dx, dy] of offsets) {
      const box = { left: point.x - width / 2 + dx * (width + gap), top: point.y - 15 + dy * (height + 38), width, height };
      if (!live.some(other => box.left < other.left + other.width + gap && box.left + width + gap > other.left && box.top - 32 < other.top + other.height + gap && box.top + height + gap > other.top - 32)) return box;
    }
  }
}

export function inspectionObjects(units, contents, position) {
  return [...units, ...contents].filter(object => object.position.q === position.q && object.position.r === position.r);
}

export function repeatedTargetTap(previous, targetId, now) {
  return previous?.targetId === targetId && now - previous.time >= 350;
}
