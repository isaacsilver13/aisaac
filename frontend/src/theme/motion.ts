export const motionDuration = {
  fast: 0.12,
  standard: 0.18,
  panel: 0.24,
} as const;

export const motionEase = [0.2, 0.8, 0.2, 1] as const;

export const layoutSpring = {
  type: "spring" as const,
  stiffness: 420,
  damping: 38,
  mass: 0.8,
};

export const pressTransition = {
  duration: motionDuration.fast,
  ease: motionEase,
};
