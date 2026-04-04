// Shift the Gravity App.tsx v6.5
// 2026-03-29
// 変更点: ゴールを静かな四角に戻した。currentStageIndex を更新できるようにし、クリア時に Next Stage を実装。最終ステージのみ Congratulations を表示し、Replay は常に現在のステージをやり直す形に整理。

import React, { useEffect, useMemo, useRef, useState } from "react";

// ===== TYPES =====
type GamePhase = "idle" | "playing" | "impact" | "lost" | "cleared";
type PermissionState =
  | "checking"
  | "needs-request"
  | "granted"
  | "denied"
  | "unsupported";

type Vec2 = {
  x: number;
  y: number;
};

type Rect = {
  x: number;
  y: number;
  w: number;
  h: number;
};

type Player = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
};

type MotionPermissionResult = "granted" | "denied";

type DeviceOrientationConstructorWithPermission = typeof DeviceOrientationEvent & {
  requestPermission?: () => Promise<MotionPermissionResult>;
};

type ParticleEffect = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
  color: string;
};

type ImpactEffect = {
  x: number;
  y: number;
  life: number;
  maxLife: number;
};

type StageDefinition = {
  id: string;
  name: string;
  start: Vec2;
  goal: Rect;
  obstacles: Rect[];
};

// ===== CONSTANTS =====
const WORLD_WIDTH = 1600;
const WORLD_HEIGHT = 900;

const PLAYER_SIZE = 24;
const PLAYER_HITBOX_SCALE = 0.76;

const STAGES: StageDefinition[] = [
  {
    id: "stage-1",
    name: "Stage-1",
    start: { x: 250, y: 200 },
    goal: { x: 1150, y: 100, w: 310, h: 150 },
    obstacles: [{ x: 860, y: 0, w: 200, h: 500 }],
  },
  {
    id: "stage-2",
    name: "Stage-2",
    start: { x: 200, y: 200 },
    goal: { x: 1400, y: 0, w: 200, h: 100 },
    obstacles: [
      { x: 400, y: 0, w: 150, h: 600 },
      { x: 850, y: 250, w: 150, h: 650 },
      { x: 1250, y: 0, w: 150, h: 650 },
      { x: 1400, y: 550, w: 50, h: 50 },
      { x: 1550, y: 350, w: 50, h: 50 },
      { x: 1400, y: 150, w: 100, h: 50 },
    ],
  },
  {
    id: "stage-3",
    name: "Stage-3",
    start: { x: 200, y: 500 },
    goal: { x: 0, y: 250, w: 300, h: 100 },
    obstacles: [
      { x: 0, y: 350, w: 300, h: 100 },
      { x: 350, y: 150, w: 200, h: 250 },
      { x: 350, y: 400, w: 1000, h: 250 },
      { x: 1150, y: 200, w: 200, h: 200 },
      { x: 650, y: 50, w: 350, h: 200 },
    ],
  },
  {
    id: "first-drift",
    name: "First Drift",
    start: { x: 140, y: 660 },
    goal: { x: 1400, y: 84, w: 112, h: 112 },
    obstacles: [
      { x: 520, y: 420, w: 80, h: 300 },
      { x: 860, y: 180, w: 80, h: 260 },
      { x: 1120, y: 520, w: 220, h: 80 },
    ],
  },
];

const INITIAL_STAGE_INDEX = 0;

// --- ここが実機で一番触る場所 ---
const GRAVITY = 1040;
const THRUST = 1360;
const MAX_RISE_SPEED = 940;
const MAX_FALL_SPEED = 980;
const MAX_SIDE_SPEED = 760;
const LINEAR_DAMPING = 1.08;
const MAX_INPUT_TILT_DEG = 18;
const MAX_GRAVITY_ROTATION_RAD = 0.82;
const TILT_DIRECTION = 1;

const GRAZE_DISTANCE = 28;
const GRAZE_MIN_SPEED = 320;
const GRAZE_COOLDOWN_MS = 120;
const GRAZE_PARTICLE_LIFE = 0.12;
const IMPACT_EFFECT_LIFE = 0.2;
const LOST_DELAY_MS = 180;
const LOST_FADE_MS = 120;

const FIELD_COLOR = "#101826";
const GRID_COLOR = "rgba(255,255,255,0.05)";
const BORDER_COLOR = "rgba(212, 232, 255, 0.48)";
const BORDER_GLOW = "rgba(178, 212, 255, 0.28)";
const PLAYER_COLOR = "#ffffff";
const PLAYER_TRAIL_COLOR = "rgba(255,255,255,0.22)";
const GRAZE_COLOR = "rgba(220, 240, 255, 0.96)";
const IMPACT_COLOR = "rgba(255, 146, 146, 0.96)";
const OBSTACLE_FILL = "#8b93a7";
const OBSTACLE_STROKE = "rgba(255,255,255,0.5)";
const GOAL_FILL = "rgba(158, 255, 173, 0.16)";
const GOAL_STROKE = "rgba(158, 255, 173, 0.92)";

// ===== HELPERS =====
function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function dotVelocity(player: Player, axis: Vec2): number {
  return player.vx * axis.x + player.vy * axis.y;
}

function rectsOverlap(a: Rect, b: Rect): boolean {
  return (
    a.x < b.x + b.w &&
    a.x + a.w > b.x &&
    a.y < b.y + b.h &&
    a.y + a.h > b.y
  );
}

function getPlayerHitbox(player: Player): Rect {
  const hitSize = player.size * PLAYER_HITBOX_SCALE;
  const inset = (player.size - hitSize) * 0.5;
  return {
    x: player.x - player.size * 0.5 + inset,
    y: player.y - player.size * 0.5 + inset,
    w: hitSize,
    h: hitSize,
  };
}

function getRectGap(a: Rect, b: Rect): number {
  const gapX = Math.max(0, b.x - (a.x + a.w), a.x - (b.x + b.w));
  const gapY = Math.max(0, b.y - (a.y + a.h), a.y - (b.y + b.h));
  return Math.hypot(gapX, gapY);
}

function getClosestPointOnRect(point: Vec2, rect: Rect): Vec2 {
  return {
    x: clamp(point.x, rect.x, rect.x + rect.w),
    y: clamp(point.y, rect.y, rect.y + rect.h),
  };
}

function getClosestWorldBorderPoint(point: Vec2): Vec2 {
  const distances = [
    { side: "left", value: point.x },
    { side: "right", value: WORLD_WIDTH - point.x },
    { side: "top", value: point.y },
    { side: "bottom", value: WORLD_HEIGHT - point.y },
  ];
  distances.sort((a, b) => a.value - b.value);
  const nearest = distances[0]?.side ?? "left";

  if (nearest === "left") return { x: 0, y: clamp(point.y, 0, WORLD_HEIGHT) };
  if (nearest === "right") return { x: WORLD_WIDTH, y: clamp(point.y, 0, WORLD_HEIGHT) };
  if (nearest === "top") return { x: clamp(point.x, 0, WORLD_WIDTH), y: 0 };
  return { x: clamp(point.x, 0, WORLD_WIDTH), y: WORLD_HEIGHT };
}

function getDistanceToWorldBounds(rect: Rect): number {
  const leftGap = rect.x;
  const rightGap = WORLD_WIDTH - (rect.x + rect.w);
  const topGap = rect.y;
  const bottomGap = WORLD_HEIGHT - (rect.y + rect.h);
  return Math.min(leftGap, rightGap, topGap, bottomGap);
}

function getDeviceOrientationCtor(): DeviceOrientationConstructorWithPermission | undefined {
  if (typeof window === "undefined") return undefined;
  return (window as Window & {
    DeviceOrientationEvent?: DeviceOrientationConstructorWithPermission;
  }).DeviceOrientationEvent;
}

function getLegacyOrientation(): number {
  if (typeof window === "undefined") return 90;
  return (window as Window & { orientation?: number }).orientation ?? 90;
}

function getOrientationType(): string {
  if (typeof window === "undefined") return "landscape-primary";

  if (window.screen?.orientation?.type) {
    return window.screen.orientation.type;
  }

  const legacyAngle = getLegacyOrientation();
  return legacyAngle === -90 ? "landscape-secondary" : "landscape-primary";
}

function readRawTiltDegrees(event: DeviceOrientationEvent): number {
  const beta = Number.isFinite(event.beta) ? event.beta : 0;
  const type = getOrientationType();
  const sign = type === "landscape-secondary" ? -1 : 1;
  return beta * sign * TILT_DIRECTION;
}

function resizeCanvasToDisplaySize(canvas: HTMLCanvasElement): {
  width: number;
  height: number;
  dpr: number;
} {
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  const width = Math.round(rect.width * dpr);
  const height = Math.round(rect.height * dpr);

  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }

  return { width, height, dpr };
}

function makeInitialPlayer(start: Vec2): Player {
  return {
    x: start.x,
    y: start.y,
    vx: 0,
    vy: 0,
    size: PLAYER_SIZE,
  };
}

function isDesktopLike(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(hover: hover) and (pointer: fine)").matches;
}

function getSpeedMagnitude(player: Player): number {
  return Math.hypot(player.vx, player.vy);
}

// ===== MAIN APP =====
export default function ShiftTheGravityApp(): React.JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const grazeEffectsRef = useRef<ParticleEffect[]>([]);
  const impactEffectRef = useRef<ImpactEffect | null>(null);
  const lastGrazeAtRef = useRef<number>(0);
  const loseTimeoutRef = useRef<number | null>(null);

  const [gamePhase, setGamePhase] = useState<GamePhase>("idle");
  const [permissionState, setPermissionState] = useState<PermissionState>("checking");
  const [isLandscape, setIsLandscape] = useState<boolean>(true);
  const [recenterTick, setRecenterTick] = useState<number>(0);
  const [lostOverlayVisible, setLostOverlayVisible] = useState<boolean>(false);
  const [currentStageIndex, setCurrentStageIndex] = useState<number>(INITIAL_STAGE_INDEX);

  const currentStage = useMemo<StageDefinition>(() => {
    return STAGES[currentStageIndex] ?? STAGES[0];
  }, [currentStageIndex]);

  const isLastStage = currentStageIndex >= STAGES.length - 1;

  const phaseRef = useRef<GamePhase>("idle");
  const pointerActiveRef = useRef<boolean>(false);
  const neutralTiltRef = useRef<number>(0);
  const liveTiltRef = useRef<number>(0);
  const loopTimeRef = useRef<number>(0);
  const trailRef = useRef<Vec2[]>([]);
  const playerRef = useRef<Player>(makeInitialPlayer(currentStage.start));

  const supportsOrientation = typeof window !== "undefined" && !!getDeviceOrientationCtor();
  const canStart = isLandscape && permissionState === "granted";

  const screenUp: Vec2 = { x: 0, y: -1 };
  const rootStyle: React.CSSProperties = {
    minHeight: "100dvh",
    height: "100dvh",
    overflow: "hidden",
    overscrollBehavior: "none",
    background: "#000",
    touchAction: "none",
    userSelect: "none",
    WebkitUserSelect: "none",
    WebkitTouchCallout: "none",
    WebkitTapHighlightColor: "transparent",
  };
  const gameFrameStyle: React.CSSProperties = {
    aspectRatio: "16 / 9",
    touchAction: "none",
    userSelect: "none",
    WebkitUserSelect: "none",
    WebkitTouchCallout: "none",
    WebkitTapHighlightColor: "transparent",
    height: "calc(100dvh - 44px)",
    width: "auto",
    maxWidth: "100%",
  };

  useEffect(() => {
    phaseRef.current = gamePhase;
  }, [gamePhase]);

  useEffect(() => {
    playerRef.current = makeInitialPlayer(currentStage.start);
    trailRef.current = [];
    grazeEffectsRef.current = [];
    impactEffectRef.current = null;
    loopTimeRef.current = 0;
    pointerActiveRef.current = false;
    setLostOverlayVisible(false);
  }, [currentStage]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const updateLandscape = () => {
      setIsLandscape(window.matchMedia("(orientation: landscape)").matches);
    };

    updateLandscape();
    window.addEventListener("resize", updateLandscape);
    window.addEventListener("orientationchange", updateLandscape);

    return () => {
      window.removeEventListener("resize", updateLandscape);
      window.removeEventListener("orientationchange", updateLandscape);
    };
  }, []);

  useEffect(() => {
    if (!supportsOrientation) {
      setPermissionState("unsupported");
      return;
    }

    const orientationCtor = getDeviceOrientationCtor();
    const hasRequestPermission = typeof orientationCtor?.requestPermission === "function";

    if (hasRequestPermission) {
      setPermissionState("needs-request");
    } else {
      setPermissionState("granted");
    }
  }, [supportsOrientation]);

  useEffect(() => {
    if (permissionState !== "granted") return;

    let sawOrientationEvent = false;

    const handleOrientation = (event: DeviceOrientationEvent) => {
      sawOrientationEvent = true;
      liveTiltRef.current = readRawTiltDegrees(event);
    };

    const fallbackTimer = window.setTimeout(() => {
      if (!sawOrientationEvent) {
        setPermissionState(isDesktopLike() ? "unsupported" : "granted");
      }
    }, 1200);

    window.addEventListener("deviceorientation", handleOrientation, true);
    return () => {
      window.clearTimeout(fallbackTimer);
      window.removeEventListener("deviceorientation", handleOrientation, true);
    };
  }, [permissionState]);

  useEffect(() => {
    let rafId = 0;

    const stepAndDraw = (timestamp: number) => {
      if (!loopTimeRef.current) {
        loopTimeRef.current = timestamp;
      }

      const deltaTime = Math.min((timestamp - loopTimeRef.current) / 1000, 1 / 30);
      loopTimeRef.current = timestamp;

      if (phaseRef.current === "playing") {
        simulateGame(deltaTime);
      } else {
        updateEffects(deltaTime);
      }

      drawScene();
      rafId = window.requestAnimationFrame(stepAndDraw);
    };

    rafId = window.requestAnimationFrame(stepAndDraw);
    return () => window.cancelAnimationFrame(rafId);
  }, [permissionState, currentStage]);

  useEffect(() => {
    if (recenterTick === 0) return;
    const timer = window.setTimeout(() => setRecenterTick(0), 700);
    return () => window.clearTimeout(timer);
  }, [recenterTick]);

  useEffect(() => {
    if (gamePhase !== "lost") {
      setLostOverlayVisible(false);
      return;
    }

    const rafId = window.requestAnimationFrame(() => {
      setLostOverlayVisible(true);
    });

    return () => window.cancelAnimationFrame(rafId);
  }, [gamePhase]);

  useEffect(() => {
    return () => {
      if (loseTimeoutRef.current !== null) {
        window.clearTimeout(loseTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const release = () => {
      pointerActiveRef.current = false;
    };

    window.addEventListener("pointerup", release);
    window.addEventListener("pointercancel", release);

    return () => {
      window.removeEventListener("pointerup", release);
      window.removeEventListener("pointercancel", release);
    };
  }, []);

  function getCurrentTiltDegrees(): number {
    return liveTiltRef.current;
  }

  function ensureAudioReady(): void {
    if (typeof window === "undefined") return;

    const AudioCtor =
      window.AudioContext ||
      (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtor) return;

    if (!audioContextRef.current) {
      audioContextRef.current = new AudioCtor();
    }

    const context = audioContextRef.current;
    if (context.state === "suspended") {
      void context.resume();
    }
  }

  function playGrazeSound(): void {
    const context = audioContextRef.current;
    if (!context || context.state !== "running") return;

    const now = context.currentTime;
    const osc = context.createOscillator();
    const gain = context.createGain();
    const filter = context.createBiquadFilter();

    osc.type = "triangle";
    osc.frequency.setValueAtTime(760, now);
    osc.frequency.exponentialRampToValueAtTime(430, now + 0.055);

    filter.type = "highpass";
    filter.frequency.setValueAtTime(320, now);

    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.04, now + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.07);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(context.destination);

    osc.start(now);
    osc.stop(now + 0.075);
  }

  function playImpactSound(): void {
    const context = audioContextRef.current;
    if (!context || context.state !== "running") return;

    const now = context.currentTime;
    const osc = context.createOscillator();
    const gain = context.createGain();

    osc.type = "square";
    osc.frequency.setValueAtTime(220, now);
    osc.frequency.exponentialRampToValueAtTime(90, now + 0.11);

    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.12, now + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.14);

    osc.connect(gain);
    gain.connect(context.destination);

    osc.start(now);
    osc.stop(now + 0.16);
  }

  function vibrateImpact(): void {
    if (typeof navigator === "undefined" || typeof navigator.vibrate !== "function") {
      return;
    }

    navigator.vibrate(18);
  }

  function resetStage(): void {
    if (loseTimeoutRef.current !== null) {
      window.clearTimeout(loseTimeoutRef.current);
      loseTimeoutRef.current = null;
    }

    playerRef.current = makeInitialPlayer(currentStage.start);
    trailRef.current = [];
    grazeEffectsRef.current = [];
    impactEffectRef.current = null;
    loopTimeRef.current = 0;
    setLostOverlayVisible(false);
  }

  function startRun(): void {
    ensureAudioReady();
    resetStage();
    neutralTiltRef.current = getCurrentTiltDegrees();
    setGamePhase("playing");
  }

  function recenterTilt(): void {
    neutralTiltRef.current = getCurrentTiltDegrees();
    setRecenterTick(Date.now());
  }

  function goToStage(index: number): void {
    if (loseTimeoutRef.current !== null) {
      window.clearTimeout(loseTimeoutRef.current);
      loseTimeoutRef.current = null;
    }

    pointerActiveRef.current = false;
    setCurrentStageIndex(clamp(index, 0, STAGES.length - 1));
    setGamePhase("idle");
  }

  function goToNextStage(): void {
    if (isLastStage) return;
    goToStage(currentStageIndex + 1);
  }

  function finishRun(nextPhase: Extract<GamePhase, "cleared">): void {
    if (phaseRef.current !== "playing") return;
    pointerActiveRef.current = false;
    setGamePhase(nextPhase);
  }

  function startLoseSequence(point: Vec2): void {
    if (phaseRef.current !== "playing") return;

    pointerActiveRef.current = false;
    triggerImpact(point);
    vibrateImpact();
    setGamePhase("impact");

    if (loseTimeoutRef.current !== null) {
      window.clearTimeout(loseTimeoutRef.current);
    }

    loseTimeoutRef.current = window.setTimeout(() => {
      loseTimeoutRef.current = null;
      setGamePhase("lost");
    }, LOST_DELAY_MS);
  }

  function triggerGraze(point: Vec2): void {
    const now = performance.now();
    if (now - lastGrazeAtRef.current < GRAZE_COOLDOWN_MS) return;
    lastGrazeAtRef.current = now;

    playGrazeSound();

    for (let i = 0; i < 4; i += 1) {
      const angle = -0.7 + i * 0.45 + Math.random() * 0.18;
      const speed = 45 + Math.random() * 80;
      grazeEffectsRef.current.push({
        x: point.x,
        y: point.y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: GRAZE_PARTICLE_LIFE,
        maxLife: GRAZE_PARTICLE_LIFE,
        size: 5 + Math.random() * 4,
        color: GRAZE_COLOR,
      });
    }
  }

  function triggerImpact(point: Vec2): void {
    playImpactSound();
    impactEffectRef.current = {
      x: point.x,
      y: point.y,
      life: IMPACT_EFFECT_LIFE,
      maxLife: IMPACT_EFFECT_LIFE,
    };

    for (let i = 0; i < 10; i += 1) {
      const angle = (Math.PI * 2 * i) / 10 + Math.random() * 0.2;
      const speed = 90 + Math.random() * 110;
      grazeEffectsRef.current.push({
        x: point.x,
        y: point.y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: 0.18,
        maxLife: 0.18,
        size: 6 + Math.random() * 5,
        color: IMPACT_COLOR,
      });
    }
  }

  function updateEffects(dt: number): void {
    grazeEffectsRef.current = grazeEffectsRef.current
      .map((effect) => ({
        ...effect,
        x: effect.x + effect.vx * dt,
        y: effect.y + effect.vy * dt,
        vx: effect.vx * Math.exp(-7 * dt),
        vy: effect.vy * Math.exp(-7 * dt),
        life: effect.life - dt,
      }))
      .filter((effect) => effect.life > 0);

    if (impactEffectRef.current) {
      impactEffectRef.current = {
        ...impactEffectRef.current,
        life: impactEffectRef.current.life - dt,
      };
      if (impactEffectRef.current.life <= 0) {
        impactEffectRef.current = null;
      }
    }
  }

  async function handleEnableTilt(): Promise<void> {
    if (!supportsOrientation) {
      setPermissionState("unsupported");
      return;
    }

    try {
      const orientationCtor = getDeviceOrientationCtor();
      const requestPermission = orientationCtor?.requestPermission;

      if (typeof requestPermission === "function") {
        const result = await requestPermission();
        const granted = result === "granted";
        setPermissionState(granted ? "granted" : "denied");
      } else {
        setPermissionState("granted");
      }
    } catch {
      setPermissionState("denied");
    }
  }

  function beginThrust(event: React.PointerEvent<HTMLDivElement>): void {
    event.preventDefault();
    ensureAudioReady();
    if (phaseRef.current !== "playing") return;
    const target = event.target as HTMLElement | null;
    if (target?.closest("button")) return;
    pointerActiveRef.current = true;
    window.getSelection()?.removeAllRanges();
  }

  function endThrust(): void {
    pointerActiveRef.current = false;
  }

  function maybeTriggerGraze(hitbox: Rect, player: Player): void {
    const speed = getSpeedMagnitude(player);
    if (speed < GRAZE_MIN_SPEED) return;

    const playerCenter = { x: player.x, y: player.y };
    let nearestDistance = Infinity;
    let nearestPoint: Vec2 | null = null;

    currentStage.obstacles.forEach((obstacle) => {
      const distance = getRectGap(hitbox, obstacle);
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearestPoint = getClosestPointOnRect(playerCenter, obstacle);
      }
    });

    const worldDistance = getDistanceToWorldBounds(hitbox);
    if (worldDistance < nearestDistance) {
      nearestDistance = worldDistance;
      nearestPoint = getClosestWorldBorderPoint(playerCenter);
    }

    if (nearestDistance <= GRAZE_DISTANCE && nearestPoint) {
      triggerGraze(nearestPoint);
    }
  }

  function simulateGame(dt: number): void {
    const player = playerRef.current;
    const steps = Math.max(1, Math.ceil(dt / (1 / 120)));
    const stepDt = dt / steps;

    for (let i = 0; i < steps; i += 1) {
      updateEffects(stepDt);

      const rawDeltaDeg = getCurrentTiltDegrees() - neutralTiltRef.current;
      const clampedInputDeg = clamp(rawDeltaDeg, -MAX_INPUT_TILT_DEG, MAX_INPUT_TILT_DEG);
      const gravityRotation =
        (clampedInputDeg / MAX_INPUT_TILT_DEG) * MAX_GRAVITY_ROTATION_RAD;

      const down: Vec2 = {
        x: Math.sin(gravityRotation),
        y: Math.cos(gravityRotation),
      };
      const side: Vec2 = { x: down.y, y: -down.x };

      const thrustMultiplier = pointerActiveRef.current ? 1 : 0;
      const ax = down.x * GRAVITY + screenUp.x * THRUST * thrustMultiplier;
      const ay = down.y * GRAVITY + screenUp.y * THRUST * thrustMultiplier;

      player.vx += ax * stepDt;
      player.vy += ay * stepDt;

      const damping = Math.exp(-LINEAR_DAMPING * stepDt);
      player.vx *= damping;
      player.vy *= damping;

      let downSpeed = dotVelocity(player, down);
      let sideSpeed = dotVelocity(player, side);

      downSpeed = clamp(downSpeed, -MAX_RISE_SPEED, MAX_FALL_SPEED);
      sideSpeed = clamp(sideSpeed, -MAX_SIDE_SPEED, MAX_SIDE_SPEED);

      player.vx = down.x * downSpeed + side.x * sideSpeed;
      player.vy = down.y * downSpeed + side.y * sideSpeed;

      player.x += player.vx * stepDt;
      player.y += player.vy * stepDt;

      trailRef.current.push({ x: player.x, y: player.y });
      if (trailRef.current.length > 24) {
        trailRef.current.shift();
      }

      const hitbox = getPlayerHitbox(player);

      if (
        player.x - player.size * 0.5 < 0 ||
        player.x + player.size * 0.5 > WORLD_WIDTH ||
        player.y - player.size * 0.5 < 0 ||
        player.y + player.size * 0.5 > WORLD_HEIGHT
      ) {
        startLoseSequence({ x: clamp(player.x, 0, WORLD_WIDTH), y: clamp(player.y, 0, WORLD_HEIGHT) });
        return;
      }

      const collidedObstacle = currentStage.obstacles.find((obstacle) => rectsOverlap(hitbox, obstacle));
      if (collidedObstacle) {
        startLoseSequence(getClosestPointOnRect({ x: player.x, y: player.y }, collidedObstacle));
        return;
      }

      if (rectsOverlap(hitbox, currentStage.goal)) {
        finishRun("cleared");
        return;
      }

      maybeTriggerGraze(hitbox, player);
    }
  }

  function drawScene(): void {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const { width, height, dpr } = resizeCanvasToDisplaySize(canvas);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const scaleX = width / WORLD_WIDTH;
    const scaleY = height / WORLD_HEIGHT;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, width, height);

    ctx.scale(scaleX, scaleY);

    ctx.fillStyle = FIELD_COLOR;
    ctx.fillRect(0, 0, WORLD_WIDTH, WORLD_HEIGHT);

    ctx.strokeStyle = GRID_COLOR;
    ctx.lineWidth = 1;
    for (let x = 80; x < WORLD_WIDTH; x += 80) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, WORLD_HEIGHT);
      ctx.stroke();
    }
    for (let y = 80; y < WORLD_HEIGHT; y += 80) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(WORLD_WIDTH, y);
      ctx.stroke();
    }

    ctx.save();
    ctx.lineWidth = 10;
    ctx.strokeStyle = BORDER_GLOW;
    ctx.shadowColor = BORDER_GLOW;
    ctx.shadowBlur = 24;
    ctx.strokeRect(5, 5, WORLD_WIDTH - 10, WORLD_HEIGHT - 10);
    ctx.restore();

    ctx.save();
    ctx.lineWidth = 4;
    ctx.strokeStyle = BORDER_COLOR;
    ctx.strokeRect(2, 2, WORLD_WIDTH - 4, WORLD_HEIGHT - 4);
    ctx.restore();

    ctx.save();
    ctx.fillStyle = GOAL_FILL;
    ctx.strokeStyle = GOAL_STROKE;
    ctx.lineWidth = 4;
    ctx.fillRect(currentStage.goal.x, currentStage.goal.y, currentStage.goal.w, currentStage.goal.h);
    ctx.strokeRect(currentStage.goal.x, currentStage.goal.y, currentStage.goal.w, currentStage.goal.h);
    ctx.restore();

    currentStage.obstacles.forEach((obstacle: Rect) => {
      ctx.fillStyle = OBSTACLE_FILL;
      ctx.strokeStyle = OBSTACLE_STROKE;
      ctx.lineWidth = 3;
      ctx.fillRect(obstacle.x, obstacle.y, obstacle.w, obstacle.h);
      ctx.strokeRect(obstacle.x, obstacle.y, obstacle.w, obstacle.h);
    });

    trailRef.current.forEach((point: Vec2, index: number) => {
      const ratio = (index + 1) / trailRef.current.length;
      const size = 5 + ratio * 6;
      ctx.fillStyle = PLAYER_TRAIL_COLOR;
      ctx.fillRect(point.x - size / 2, point.y - size / 2, size, size);
    });

    grazeEffectsRef.current.forEach((effect) => {
      const alpha = effect.life / effect.maxLife;
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.fillStyle = effect.color;
      ctx.fillRect(effect.x - effect.size / 2, effect.y - effect.size / 2, effect.size, effect.size * 0.6);
      ctx.restore();
    });

    if (impactEffectRef.current) {
      const impact = impactEffectRef.current;
      const alpha = impact.life / impact.maxLife;
      const radius = 12 + (1 - alpha) * 52;

      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = IMPACT_COLOR;
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.arc(impact.x, impact.y, radius, 0, Math.PI * 2);
      ctx.stroke();

      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(impact.x - radius * 0.7, impact.y - radius * 0.7);
      ctx.lineTo(impact.x + radius * 0.7, impact.y + radius * 0.7);
      ctx.moveTo(impact.x + radius * 0.7, impact.y - radius * 0.7);
      ctx.lineTo(impact.x - radius * 0.7, impact.y + radius * 0.7);
      ctx.stroke();
      ctx.restore();
    }

    const player = playerRef.current;
    ctx.save();
    ctx.shadowColor = "rgba(255,255,255,0.35)";
    ctx.shadowBlur = 18;
    ctx.fillStyle = PLAYER_COLOR;
    ctx.fillRect(
      player.x - player.size * 0.5,
      player.y - player.size * 0.5,
      player.size,
      player.size
    );
    ctx.restore();

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  const permissionMessage =
    permissionState === "needs-request"
      ? "iPhone / iPad では最初に傾き許可が必要です。"
      : permissionState === "denied"
      ? "傾き許可が取れませんでした。"
      : permissionState === "unsupported"
      ? "この環境では傾きセンサーが使えません。"
      : "";

  return (
    <div
      className="w-full bg-black text-white"
      style={rootStyle}
      onPointerDown={beginThrust}
      onPointerUp={endThrust}
      onPointerCancel={endThrust}
      onContextMenu={(event) => event.preventDefault()}
    >
      <div className="mx-auto flex h-full max-w-7xl flex-col items-center justify-center p-2 md:p-4">
        <div className="mb-2 flex w-full items-center justify-between gap-3 px-1 text-[11px] text-white/70 md:mb-3 md:text-sm">
          <div>
            <span className="font-semibold text-white">Shift the gravity</span>
            <span className="ml-2">試作版 v6.5</span>
          </div>
          <div>
            {recenterTick > 0 && (
              <div className="rounded-full border border-emerald-300/20 bg-emerald-300/10 px-2 py-1 text-[10px] text-emerald-200 md:text-xs">
                recentered
              </div>
            )}
          </div>
        </div>

        <div
          className="relative overflow-hidden rounded-3xl border border-white/10 bg-slate-950 shadow-2xl"
          style={gameFrameStyle}
        >
          <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />

          {!isLandscape && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/82 px-6 text-center">
              <div className="max-w-md rounded-3xl border border-white/10 bg-slate-950/95 p-6 shadow-2xl">
                <div className="text-xl font-semibold">横向きでプレイしてください</div>
                <p className="mt-3 text-sm leading-6 text-white/75">
                  この試作は横向き前提です。端末を横向きにしてから始めてください。
                </p>
              </div>
            </div>
          )}

          {isLandscape && gamePhase === "idle" && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/44 px-6 text-center">
              <div className="pointer-events-auto max-w-lg rounded-3xl border border-white/10 bg-slate-950/92 p-6 shadow-2xl md:p-8">
                <div className="text-2xl font-semibold md:text-3xl">Shift the gravity</div>
                <p className="mt-3 text-sm leading-6 text-white/75 md:text-base">
                  長押しで浮かび、離すと落ちます。端末を傾けると、重力方向が左右に少しずれます。
                </p>
                <p className="mt-2 text-xs leading-5 text-white/55 md:text-sm">
                  Stage {currentStageIndex + 1}: {currentStage.name}
                </p>

                {permissionMessage && (
                  <p className="mt-4 text-sm leading-6 text-emerald-300/90">{permissionMessage}</p>
                )}

                <div className="mt-6 flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
                  {permissionState === "needs-request" && (
                    <button
                      className="rounded-2xl border border-emerald-300/30 bg-emerald-300/10 px-5 py-3 text-sm font-medium text-emerald-200 transition hover:bg-emerald-300/15"
                      onClick={handleEnableTilt}
                    >
                      傾き操作を有効にする
                    </button>
                  )}
                  <button
                    className="rounded-2xl border border-cyan-300/25 bg-cyan-300/10 px-5 py-3 text-sm font-medium text-cyan-100 transition hover:bg-cyan-300/15 disabled:cursor-not-allowed disabled:opacity-40"
                    onClick={recenterTilt}
                    disabled={!canStart}
                  >
                    Recenter
                  </button>
                  <button
                    className="rounded-2xl border border-white/20 bg-white/10 px-6 py-3 text-sm font-medium text-white transition hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-40"
                    onClick={startRun}
                    disabled={!canStart}
                  >
                    Start
                  </button>
                </div>
              </div>
            </div>
          )}

          {isLandscape && gamePhase === "lost" && (
            <div
              className={`absolute inset-0 flex items-center justify-center bg-black/24 px-6 text-center transition-opacity ${
                lostOverlayVisible ? "opacity-100" : "opacity-0"
              }`}
              style={{ transitionDuration: `${LOST_FADE_MS}ms` }}
            >
              <div className="pointer-events-auto w-full max-w-md rounded-3xl border border-white/10 bg-slate-950/82 p-6 shadow-2xl md:p-8">
                <div className="text-2xl font-semibold md:text-3xl">FAILED</div>
                <p className="mt-3 text-sm leading-6 text-white/75">
                  障害物か画面端に触れました。もう一度試せます。
                </p>
                <div className="mt-6 flex items-center justify-center gap-3">
                  <button
                    className="rounded-2xl border border-cyan-300/25 bg-cyan-300/10 px-5 py-3 text-sm font-medium text-cyan-100 transition hover:bg-cyan-300/15"
                    onClick={recenterTilt}
                  >
                    Recenter
                  </button>
                  <button
                    className="rounded-2xl border border-white/20 bg-white/10 px-6 py-3 text-sm font-medium text-white transition hover:bg-white/15"
                    onClick={startRun}
                  >
                    Replay
                  </button>
                </div>
              </div>
            </div>
          )}

          {isLandscape && gamePhase === "cleared" && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/44 px-6 text-center">
              <div className="pointer-events-auto w-full max-w-md rounded-3xl border border-emerald-300/20 bg-slate-950/92 p-6 shadow-2xl md:p-8">
                <div className="text-2xl font-semibold text-emerald-300 md:text-3xl">
                  {isLastStage ? "Congratulations" : "Good Job"}
                </div>
                <p className="mt-3 text-sm leading-6 text-white/75">
                  {isLastStage
                    ? "すべてのステージをクリアしました。"
                    : `Stage ${currentStageIndex + 1} をクリアしました。次のステージへ進めます。`}
                </p>
                <div className="mt-6 flex items-center justify-center gap-3">
                  <button
                    className="rounded-2xl border border-cyan-300/25 bg-cyan-300/10 px-5 py-3 text-sm font-medium text-cyan-100 transition hover:bg-cyan-300/15"
                    onClick={recenterTilt}
                  >
                    Recenter
                  </button>
                  <button
                    className="rounded-2xl border border-white/20 bg-white/10 px-6 py-3 text-sm font-medium text-white transition hover:bg-white/15"
                    onClick={startRun}
                  >
                    Replay
                  </button>
                  {!isLastStage && (
                    <button
                      className="rounded-2xl border border-emerald-300/30 bg-emerald-300/10 px-6 py-3 text-sm font-medium text-emerald-200 transition hover:bg-emerald-300/15"
                      onClick={goToNextStage}
                    >
                      Next Stage
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

