
// Shift the Gravity App.tsx v3
// 2026-03-29
// 変更点: 実機フィードバックを反映。傾き感度を上げ、傾き方向を補正し、上昇時と落下時で横ズレ方向が揃うように修正。横向きスマホで収まりやすい画面サイズに調整し、長押し時の選択/コピーメニューも抑制。

import React, { useEffect, useRef, useState } from "react";

// ===== TYPES =====
type GamePhase = "idle" | "playing" | "lost" | "cleared";
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

// ===== CONSTANTS =====
const WORLD_WIDTH = 1600;
const WORLD_HEIGHT = 900;

const PLAYER_SIZE = 24;
const PLAYER_HITBOX_SCALE = 0.84;

const START_POSITION: Vec2 = { x: 140, y: 760 };
const GOAL_RECT: Rect = { x: 1400, y: 84, w: 112, h: 112 };

const STAGE_OBSTACLES: Rect[] = [
  { x: 320, y: 250, w: 90, h: 470 },
  { x: 520, y: 250, w: 280, h: 80 },
  { x: 760, y: 390, w: 90, h: 350 },
  { x: 930, y: 180, w: 360, h: 80 },
  { x: 1120, y: 180, w: 80, h: 320 },
  { x: 1240, y: 560, w: 220, h: 80 },
];

// --- ここが実機で一番触る場所 ---
const GRAVITY = 1040;
const THRUST = 1360;
const MAX_RISE_SPEED = 820;
const MAX_FALL_SPEED = 980;
const MAX_SIDE_SPEED = 760;
const LINEAR_DAMPING = 1.08;
const MAX_INPUT_TILT_DEG = 18;
const MAX_GRAVITY_ROTATION_RAD = 0.82;
const TILT_DIRECTION = -1;

const BG_COLOR = "#0b0f14";
const FIELD_COLOR = "#101826";
const GRID_COLOR = "rgba(255,255,255,0.05)";
const PLAYER_COLOR = "#ffffff";
const PLAYER_TRAIL_COLOR = "rgba(255,255,255,0.22)";
const OBSTACLE_FILL = "#8b93a7";
const OBSTACLE_STROKE = "rgba(255,255,255,0.5)";
const GOAL_FILL = "rgba(158, 255, 173, 0.2)";
const GOAL_STROKE = "#9effad";
const HUD_PANEL = "rgba(16, 24, 38, 0.86)";
const HUD_BORDER = "rgba(255,255,255,0.12)";

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
  const gamma = Number.isFinite(event.gamma) ? event.gamma : 0;
  const type = getOrientationType();
  const sign = type === "landscape-secondary" ? -1 : 1;
  return gamma * sign * TILT_DIRECTION;
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

function makeInitialPlayer(): Player {
  return {
    x: START_POSITION.x,
    y: START_POSITION.y,
    vx: 0,
    vy: 0,
    size: PLAYER_SIZE,
  };
}

function formatTiltText(value: number): string {
  return `${value >= 0 ? "+" : ""}${value.toFixed(1)}°`;
}

function isDesktopLike(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(hover: hover) and (pointer: fine)").matches;
}

// ===== MAIN APP =====
export default function ShiftTheGravityApp(): React.JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const [gamePhase, setGamePhase] = useState<GamePhase>("idle");
  const [permissionState, setPermissionState] = useState<PermissionState>("checking");
  const [isLandscape, setIsLandscape] = useState<boolean>(true);
  const [manualTilt, setManualTilt] = useState<number>(0);
  const [debugTilt, setDebugTilt] = useState<number>(0);
  const [showManualTiltFallback, setShowManualTiltFallback] = useState<boolean>(false);

  const phaseRef = useRef<GamePhase>("idle");
  const pointerActiveRef = useRef<boolean>(false);
  const neutralTiltRef = useRef<number>(0);
  const liveTiltRef = useRef<number>(0);
  const loopTimeRef = useRef<number>(0);
  const trailRef = useRef<Vec2[]>([]);
  const playerRef = useRef<Player>(makeInitialPlayer());
  const latestDebugRef = useRef<number>(0);

  const supportsOrientation = typeof window !== "undefined" && !!getDeviceOrientationCtor();
  const canStart = isLandscape && (permissionState === "granted" || showManualTiltFallback);

  const screenUp: Vec2 = { x: 0, y: -1 };
  const rootStyle: React.CSSProperties = {
    minHeight: "100dvh",
    height: "100dvh",
    overflow: "hidden",
    overscrollBehavior: "none",
    background: "#000",
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
      setShowManualTiltFallback(true);
      return;
    }

    const orientationCtor = getDeviceOrientationCtor();
    const hasRequestPermission = typeof orientationCtor?.requestPermission === "function";

    if (hasRequestPermission) {
      setPermissionState("needs-request");
      setShowManualTiltFallback(false);
    } else {
      setPermissionState("granted");
      setShowManualTiltFallback(isDesktopLike());
    }
  }, [supportsOrientation]);

  useEffect(() => {
    if (permissionState !== "granted") return;

    let sawOrientationEvent = false;

    const handleOrientation = (event: DeviceOrientationEvent) => {
      sawOrientationEvent = true;
      setShowManualTiltFallback(false);
      liveTiltRef.current = readRawTiltDegrees(event);
    };

    const fallbackTimer = window.setTimeout(() => {
      if (!sawOrientationEvent && isDesktopLike()) {
        setShowManualTiltFallback(true);
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
      }

      drawScene();
      rafId = window.requestAnimationFrame(stepAndDraw);
    };

    rafId = window.requestAnimationFrame(stepAndDraw);
    return () => window.cancelAnimationFrame(rafId);
  }, [manualTilt, permissionState]);

  function getCurrentTiltDegrees(): number {
    return permissionState === "granted" && !showManualTiltFallback
      ? liveTiltRef.current
      : manualTilt;
  }

  function resetStage(): void {
    playerRef.current = makeInitialPlayer();
    trailRef.current = [];
    loopTimeRef.current = 0;
  }

  function startRun(): void {
    resetStage();
    neutralTiltRef.current = getCurrentTiltDegrees();
    setGamePhase("playing");
  }

  function finishRun(nextPhase: Extract<GamePhase, "lost" | "cleared">): void {
    if (phaseRef.current !== "playing") return;
    pointerActiveRef.current = false;
    setGamePhase(nextPhase);
  }

  async function handleEnableTilt(): Promise<void> {
    if (!supportsOrientation) {
      setPermissionState("unsupported");
      setShowManualTiltFallback(true);
      return;
    }

    try {
      const orientationCtor = getDeviceOrientationCtor();
      const requestPermission = orientationCtor?.requestPermission;

      if (typeof requestPermission === "function") {
        const result = await requestPermission();
        const granted = result === "granted";
        setPermissionState(granted ? "granted" : "denied");
        setShowManualTiltFallback(!granted && isDesktopLike());
      } else {
        setPermissionState("granted");
        setShowManualTiltFallback(isDesktopLike());
      }
    } catch {
      setPermissionState("denied");
      setShowManualTiltFallback(true);
    }
  }

  function beginThrust(event: React.PointerEvent<HTMLDivElement>): void {
    event.preventDefault();
    if (phaseRef.current !== "playing") return;
    const target = event.target as HTMLElement | null;
    if (target?.closest("button")) return;
    pointerActiveRef.current = true;
    window.getSelection()?.removeAllRanges();
  }

  function endThrust(): void {
    pointerActiveRef.current = false;
  }

  function simulateGame(dt: number): void {
    const player = playerRef.current;
    const steps = Math.max(1, Math.ceil(dt / (1 / 120)));
    const stepDt = dt / steps;

    for (let i = 0; i < steps; i += 1) {
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

      if (
        player.x - player.size * 0.5 < 0 ||
        player.x + player.size * 0.5 > WORLD_WIDTH ||
        player.y - player.size * 0.5 < 0 ||
        player.y + player.size * 0.5 > WORLD_HEIGHT
      ) {
        finishRun("lost");
        return;
      }

      const hitbox = getPlayerHitbox(player);
      const hitObstacle = STAGE_OBSTACLES.some((obstacle: Rect) => rectsOverlap(hitbox, obstacle));
      if (hitObstacle) {
        finishRun("lost");
        return;
      }

      if (rectsOverlap(hitbox, GOAL_RECT)) {
        finishRun("cleared");
        return;
      }

      if (performance.now() - latestDebugRef.current > 80) {
        latestDebugRef.current = performance.now();
        setDebugTilt(clampedInputDeg);
      }
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

    ctx.fillStyle = BG_COLOR;
    ctx.fillRect(0, 0, WORLD_WIDTH, WORLD_HEIGHT);

    ctx.fillStyle = FIELD_COLOR;
    ctx.fillRect(20, 20, WORLD_WIDTH - 40, WORLD_HEIGHT - 40);

    ctx.strokeStyle = GRID_COLOR;
    ctx.lineWidth = 1;
    for (let x = 80; x < WORLD_WIDTH; x += 80) {
      ctx.beginPath();
      ctx.moveTo(x, 24);
      ctx.lineTo(x, WORLD_HEIGHT - 24);
      ctx.stroke();
    }
    for (let y = 80; y < WORLD_HEIGHT; y += 80) {
      ctx.beginPath();
      ctx.moveTo(24, y);
      ctx.lineTo(WORLD_WIDTH - 24, y);
      ctx.stroke();
    }

    ctx.save();
    ctx.fillStyle = GOAL_FILL;
    ctx.strokeStyle = GOAL_STROKE;
    ctx.lineWidth = 4;
    ctx.shadowColor = GOAL_STROKE;
    ctx.shadowBlur = 26;
    ctx.fillRect(GOAL_RECT.x, GOAL_RECT.y, GOAL_RECT.w, GOAL_RECT.h);
    ctx.strokeRect(GOAL_RECT.x, GOAL_RECT.y, GOAL_RECT.w, GOAL_RECT.h);
    ctx.restore();

    STAGE_OBSTACLES.forEach((obstacle: Rect) => {
      ctx.fillStyle = OBSTACLE_FILL;
      ctx.strokeStyle = OBSTACLE_STROKE;
      ctx.lineWidth = 3;
      ctx.fillRect(obstacle.x, obstacle.y, obstacle.w, obstacle.h);
      ctx.strokeRect(obstacle.x, obstacle.y, obstacle.w, obstacle.h);
    });

    const trail = trailRef.current;
    trail.forEach((point: Vec2, index: number) => {
      const ratio = (index + 1) / trail.length;
      const size = 5 + ratio * 6;
      ctx.fillStyle = PLAYER_TRAIL_COLOR;
      ctx.fillRect(point.x - size / 2, point.y - size / 2, size, size);
    });

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
      ? "傾き許可が取れなかったため、下のスライダーで傾きを代用できます。"
      : permissionState === "unsupported"
      ? "この環境では傾きセンサーが使えないため、下のスライダーで確認できます。"
      : showManualTiltFallback
      ? "この環境では実センサー入力が来ていないため、下のスライダーで確認できます。"
      : "";

  return (
    <div className="w-full bg-black text-white" style={rootStyle}>
      <div className="mx-auto flex h-full max-w-7xl flex-col items-center justify-center p-2 md:p-4">
        <div className="mb-2 flex w-full items-center justify-between gap-3 px-1 text-[11px] text-white/70 md:mb-3 md:text-sm">
          <div>
            <span className="font-semibold text-white">Shift the gravity</span>
            <span className="ml-2">試作版 v3</span>
          </div>
          <div className="rounded-full border border-white/10 bg-white/5 px-3 py-1">
            tilt {formatTiltText(debugTilt)}
          </div>
        </div>

        <div
          className="relative overflow-hidden rounded-3xl border border-white/10 bg-slate-950 shadow-2xl"
          style={gameFrameStyle}
          onPointerDown={beginThrust}
          onPointerUp={endThrust}
          onPointerCancel={endThrust}
          onPointerLeave={endThrust}
          onContextMenu={(event) => event.preventDefault()}
        >
          <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />

          <div className="pointer-events-none absolute left-2 top-2 right-2 flex items-start justify-between gap-2 md:left-4 md:top-4 md:right-4 md:gap-3">
            <div
              className="rounded-2xl border px-2 py-1.5 text-[10px] md:px-3 md:py-2 md:text-sm"
              style={{ background: HUD_PANEL, borderColor: HUD_BORDER }}
            >
              <div className="font-semibold text-white">操作</div>
              <div className="mt-1 text-white/80">長押しで推力 / 離すと落下</div>
              <div className="text-white/80">端末を傾けると重力方向が少しずれます</div>
            </div>
            <div
              className="rounded-2xl border px-2 py-1.5 text-right text-[10px] md:px-3 md:py-2 md:text-sm"
              style={{ background: HUD_PANEL, borderColor: HUD_BORDER }}
            >
              <div className="font-semibold text-white">状態</div>
              <div className="mt-1 text-white/80">
                {gamePhase === "playing"
                  ? "Playing"
                  : gamePhase === "lost"
                  ? "FAILED"
                  : gamePhase === "cleared"
                  ? "Good Job"
                  : "Ready"}
              </div>
            </div>
          </div>

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
            <div className="absolute inset-0 flex items-center justify-center bg-black/44 px-6 text-center">
              <div className="pointer-events-auto w-full max-w-md rounded-3xl border border-white/10 bg-slate-950/92 p-6 shadow-2xl md:p-8">
                <div className="text-2xl font-semibold md:text-3xl">FAILED</div>
                <p className="mt-3 text-sm leading-6 text-white/75">
                  障害物か画面端に触れました。もう一度試せます。
                </p>
                <div className="mt-6">
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
                <div className="text-2xl font-semibold text-emerald-300 md:text-3xl">Good Job</div>
                <p className="mt-3 text-sm leading-6 text-white/75">
                  初版ステージをクリアしました。今は同じステージを再プレイできます。
                </p>
                <div className="mt-6 flex items-center justify-center gap-3">
                  <button
                    className="rounded-2xl border border-white/20 bg-white/10 px-6 py-3 text-sm font-medium text-white transition hover:bg-white/15"
                    onClick={startRun}
                  >
                    Replay
                  </button>
                  <button
                    className="rounded-2xl border border-emerald-300/30 bg-emerald-300/10 px-6 py-3 text-sm font-medium text-emerald-200 transition hover:bg-emerald-300/15"
                    onClick={startRun}
                  >
                    Play Again
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        {showManualTiltFallback && (
          <div className="mt-2 w-full max-w-4xl rounded-3xl border border-white/10 bg-slate-950/90 p-3 shadow-xl md:mt-4 md:p-4">
            <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between md:gap-3">
              <div>
                <div className="text-sm font-semibold text-white">傾き代用スライダー</div>
                <div className="mt-1 text-xs leading-5 text-white/65 md:text-sm">
                  PCプレビューや傾き未許可時は、ここで重力方向のずれを確認できます。
                </div>
              </div>
              <div className="text-sm text-white/70">
                {formatTiltText(manualTilt - neutralTiltRef.current)}
              </div>
            </div>
            <input
              className="mt-3 w-full"
              type="range"
              min={-30}
              max={30}
              step={0.1}
              value={manualTilt}
              onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
                setManualTilt(Number(event.target.value))
              }
            />
          </div>
        )}
      </div>
    </div>
  );
}
