// Shift the Gravity App.tsx v1
// 2026-03-29
// 変更点: 初版試作。横向き1ステージ、長押し推力、傾きで重力方向が少しずれる操作、障害物/ゴール、実機調整しやすい定数群を実装。

import React, { useEffect, useMemo, useRef, useState } from "react";

// ===== CONSTANTS =====
const WORLD_WIDTH = 1600;
const WORLD_HEIGHT = 900;

const PLAYER_SIZE = 24;
const PLAYER_HITBOX_SCALE = 0.84;

const START_POSITION = { x: 140, y: 760 };
const GOAL_RECT = { x: 1400, y: 84, w: 112, h: 112 };

const STAGE_OBSTACLES = [
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
const MAX_RISE_SPEED = 760;
const MAX_FALL_SPEED = 980;
const MAX_SIDE_SPEED = 560;
const LINEAR_DAMPING = 1.15;
const MAX_INPUT_TILT_DEG = 30;
const MAX_GRAVITY_ROTATION_RAD = 0.42;

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
function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function dot(a, b) {
  return a.x * b.x + a.y * b.y;
}

function dotVelocity(player, axis) {
  return player.vx * axis.x + player.vy * axis.y;
}

function rectsOverlap(a, b) {
  return (
    a.x < b.x + b.w &&
    a.x + a.w > b.x &&
    a.y < b.y + b.h &&
    a.y + a.h > b.y
  );
}

function getPlayerHitbox(player) {
  const hitSize = player.size * PLAYER_HITBOX_SCALE;
  const inset = (player.size - hitSize) * 0.5;
  return {
    x: player.x - player.size * 0.5 + inset,
    y: player.y - player.size * 0.5 + inset,
    w: hitSize,
    h: hitSize,
  };
}

function getOrientationType() {
  if (typeof window === "undefined") return "landscape-primary";

  if (window.screen?.orientation?.type) {
    return window.screen.orientation.type;
  }

  const legacyAngle = typeof window.orientation === "number" ? window.orientation : 90;
  return legacyAngle === -90 ? "landscape-secondary" : "landscape-primary";
}

function readRawTiltDegrees(event) {
  const gamma = Number.isFinite(event.gamma) ? event.gamma : 0;
  const type = getOrientationType();
  const sign = type === "landscape-secondary" ? -1 : 1;
  return gamma * sign;
}

function resizeCanvasToDisplaySize(canvas) {
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

function makeInitialPlayer() {
  return {
    x: START_POSITION.x,
    y: START_POSITION.y,
    vx: 0,
    vy: 0,
    size: PLAYER_SIZE,
  };
}

function formatTiltText(value) {
  return `${value >= 0 ? "+" : ""}${value.toFixed(1)}°`;
}

// ===== MAIN APP =====
export default function ShiftTheGravityApp() {
  const canvasRef = useRef(null);
  const containerRef = useRef(null);

  const [gamePhase, setGamePhase] = useState("idle");
  const [permissionState, setPermissionState] = useState("checking");
  const [isLandscape, setIsLandscape] = useState(true);
  const [manualTilt, setManualTilt] = useState(0);
  const [debugTilt, setDebugTilt] = useState(0);

  const phaseRef = useRef("idle");
  const pointerActiveRef = useRef(false);
  const neutralTiltRef = useRef(0);
  const liveTiltRef = useRef(0);
  const loopTimeRef = useRef(0);
  const trailRef = useRef([]);
  const playerRef = useRef(makeInitialPlayer());
  const latestDebugRef = useRef(0);

  const supportsOrientation = useMemo(() => {
    if (typeof window === "undefined") return false;
    return "DeviceOrientationEvent" in window;
  }, []);

  const showManualTiltFallback = permissionState === "unsupported" || permissionState === "denied";
  const canStart = isLandscape && (permissionState === "granted" || showManualTiltFallback);

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
      return;
    }

    const hasRequestPermission =
      typeof window.DeviceOrientationEvent?.requestPermission === "function";

    if (hasRequestPermission) {
      setPermissionState("needs-request");
    } else {
      setPermissionState("granted");
    }
  }, [supportsOrientation]);

  useEffect(() => {
    if (permissionState !== "granted") return;

    const handleOrientation = (event) => {
      liveTiltRef.current = readRawTiltDegrees(event);
    };

    window.addEventListener("deviceorientation", handleOrientation, true);
    return () => {
      window.removeEventListener("deviceorientation", handleOrientation, true);
    };
  }, [permissionState]);

  useEffect(() => {
    let rafId = 0;

    const stepAndDraw = (timestamp) => {
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

  function getCurrentTiltDegrees() {
    return permissionState === "granted" ? liveTiltRef.current : manualTilt;
  }

  function resetStage() {
    playerRef.current = makeInitialPlayer();
    trailRef.current = [];
    loopTimeRef.current = 0;
  }

  function startRun() {
    resetStage();
    neutralTiltRef.current = getCurrentTiltDegrees();
    setGamePhase("playing");
  }

  function finishRun(nextPhase) {
    if (phaseRef.current !== "playing") return;
    pointerActiveRef.current = false;
    setGamePhase(nextPhase);
  }

  async function handleEnableTilt() {
    if (!supportsOrientation) {
      setPermissionState("unsupported");
      return;
    }

    try {
      const requestPermission = window.DeviceOrientationEvent?.requestPermission;

      if (typeof requestPermission === "function") {
        const result = await requestPermission();
        setPermissionState(result === "granted" ? "granted" : "denied");
      } else {
        setPermissionState("granted");
      }
    } catch (error) {
      setPermissionState("denied");
    }
  }

  function beginThrust(event) {
    if (phaseRef.current !== "playing") return;
    if (event.target.closest("button")) return;
    pointerActiveRef.current = true;
  }

  function endThrust() {
    pointerActiveRef.current = false;
  }

  function simulateGame(dt) {
    const player = playerRef.current;
    const steps = Math.max(1, Math.ceil(dt / (1 / 120)));
    const stepDt = dt / steps;

    for (let i = 0; i < steps; i += 1) {
      const rawDeltaDeg = getCurrentTiltDegrees() - neutralTiltRef.current;
      const clampedInputDeg = clamp(rawDeltaDeg, -MAX_INPUT_TILT_DEG, MAX_INPUT_TILT_DEG);
      const gravityRotation =
        (clampedInputDeg / MAX_INPUT_TILT_DEG) * MAX_GRAVITY_ROTATION_RAD;

      const down = {
        x: Math.sin(gravityRotation),
        y: Math.cos(gravityRotation),
      };
      const side = { x: down.y, y: -down.x };

      const thrustMultiplier = pointerActiveRef.current ? 1 : 0;
      const ax = down.x * GRAVITY - down.x * THRUST * thrustMultiplier;
      const ay = down.y * GRAVITY - down.y * THRUST * thrustMultiplier;

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
      const hitObstacle = STAGE_OBSTACLES.some((obstacle) => rectsOverlap(hitbox, obstacle));
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

  function drawScene() {
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

    STAGE_OBSTACLES.forEach((obstacle) => {
      ctx.fillStyle = OBSTACLE_FILL;
      ctx.strokeStyle = OBSTACLE_STROKE;
      ctx.lineWidth = 3;
      ctx.fillRect(obstacle.x, obstacle.y, obstacle.w, obstacle.h);
      ctx.strokeRect(obstacle.x, obstacle.y, obstacle.w, obstacle.h);
    });

    const trail = trailRef.current;
    trail.forEach((point, index) => {
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
      : "";

  return (
    <div className="min-h-screen w-full bg-black text-white">
      <div className="mx-auto flex min-h-screen max-w-7xl items-center justify-center p-4 md:p-6">
        <div className="w-full">
          <div className="mb-3 flex items-center justify-between gap-3 text-xs text-white/70 md:text-sm">
            <div>
              <span className="font-semibold text-white">Shift the gravity</span>
              <span className="ml-2">試作版 v1</span>
            </div>
            <div className="rounded-full border border-white/10 bg-white/5 px-3 py-1">
              tilt {formatTiltText(debugTilt)}
            </div>
          </div>

          <div
            ref={containerRef}
            className="relative overflow-hidden rounded-3xl border border-white/10 bg-slate-950 shadow-2xl"
            style={{ aspectRatio: "16 / 9", touchAction: "none", userSelect: "none" }}
            onPointerDown={beginThrust}
            onPointerUp={endThrust}
            onPointerCancel={endThrust}
            onPointerLeave={endThrust}
          >
            <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />

            <div className="pointer-events-none absolute left-4 top-4 right-4 flex items-start justify-between gap-3">
              <div className="rounded-2xl border px-3 py-2 text-xs md:text-sm" style={{ background: HUD_PANEL, borderColor: HUD_BORDER }}>
                <div className="font-semibold text-white">操作</div>
                <div className="mt-1 text-white/80">長押しで推力 / 離すと落下</div>
                <div className="text-white/80">端末を傾けると重力方向が少しずれます</div>
              </div>
              <div className="rounded-2xl border px-3 py-2 text-right text-xs md:text-sm" style={{ background: HUD_PANEL, borderColor: HUD_BORDER }}>
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
                  <p className="mt-3 text-sm leading-6 text-white/75">障害物か画面端に触れました。もう一度試せます。</p>
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
                  <p className="mt-3 text-sm leading-6 text-white/75">初版ステージをクリアしました。今は同じステージを再プレイできます。</p>
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
            <div className="mt-4 rounded-3xl border border-white/10 bg-slate-950/90 p-4 shadow-xl">
              <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div>
                  <div className="text-sm font-semibold text-white">傾き代用スライダー</div>
                  <div className="mt-1 text-xs leading-6 text-white/65 md:text-sm">
                    PCプレビューや傾き未許可時は、ここで重力方向のずれを確認できます。
                  </div>
                </div>
                <div className="text-sm text-white/70">{formatTiltText(manualTilt - neutralTiltRef.current)}</div>
              </div>
              <input
                className="mt-4 w-full"
                type="range"
                min={-30}
                max={30}
                step={0.1}
                value={manualTilt}
                onChange={(event) => setManualTilt(Number(event.target.value))}
              />
            </div>
          )}

          <div className="mt-4 grid gap-3 text-xs text-white/60 md:grid-cols-3 md:text-sm">
            <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
              <div className="font-semibold text-white/85">固定済み</div>
              <div className="mt-1">横向き / 小さな四角 / 傾きで重力方向が少しずれる</div>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
              <div className="font-semibold text-white/85">今後の調整点</div>
              <div className="mt-1">GRAVITY / THRUST / 速度上限 / 障害物配置</div>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
              <div className="font-semibold text-white/85">優先順位</div>
              <div className="mt-1">まずは実機で、押して上がる感覚と落下感の確認</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
