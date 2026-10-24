"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { fetchSession } from "@/lib/session";
import changEImageUrl from "../../docs/change.png";

type FallingMoon = {
  x: number;
  y: number;
  size: number;
  speed: number;
};

type ChangEProjectile = {
  active: boolean;
  x: number;
  y: number;
  width: number;
  height: number;
  speed: number;
  angle: number;
  spinSpeed: number;
  hitsThisShot: number;
  resolved: boolean;
};

type RuntimeState = {
  running: boolean;
  width: number;
  height: number;
  elapsedMs: number;
  moons: FallingMoon[];
  spawnAccumulator: number;
  flightCount: number;
  nextSpinFlightCount: number;
  playerY: number;
  moveUp: boolean;
  moveDown: boolean;
  projectile: ChangEProjectile;
};

const CONFIG = {
  // 可調參數區：每回合起始嫦娥數量
  startingChangEs: 5,
  // 可調參數區：滿月基礎上升速度（像素/秒）
  moonBaseFallSpeed: 150,
  // 可調參數區：滿月隨時間增加上升速度（像素/秒）
  moonTimeRampSpeed: 16,
  // 可調參數區：滿月隨分數增加上升速度（像素/秒）
  moonScoreRampSpeed: 4,
  // 可調參數區：滿月生成基礎間隔（秒）
  moonSpawnBaseInterval: 1.4,
  // 可調參數區：滿月最小生成間隔（秒）
  moonSpawnMinInterval: 0.3,
  // 可調參數區：滿月生成隨時間加速係數（秒）
  moonSpawnTimeRamp: 0.028,
  // 可調參數區：滿月生成隨分數加速係數（秒）
  moonSpawnScoreRamp: 0.011,
  // 可調參數區：滿月像素尺寸
  moonSize: 48,
  // 可調參數區：嫦娥上下移動速度（像素/秒）
  moveSpeed: 290,
  // 可調參數區：嫦娥飛行速度（像素/秒）
  projectileSpeed: 490,
  // 可調參數區：嫦娥比照板手的旋轉速度（弧度/秒）
  projectileSpinSpeed: 8.4,
  // 可調參數區：兩次旋轉之間最少飛出次數
  spinIntervalMin: 15,
  // 可調參數區：兩次旋轉之間最多飛出次數
  spinIntervalMax: 20,
  // 可調參數區：嫦娥飛行時上下飄動幅度（像素）
  bobAmplitude: 10,
  // 可調參數區：嫦娥飛行時上下飄動速度（弧度/秒）
  bobAngularSpeed: 2.8,
  // 可調參數區：嫦娥待機時上下飄動幅度（像素）
  idleBobAmplitude: 5,
  // 可調參數區：嫦娥待機時上下飄動速度（弧度/秒）
  idleBobAngularSpeed: 2.1,
  // 可調參數區：右側嫦娥活動區寬度比例
  playerZoneRatio: 0.2,
  // 可調參數區：左側滿月上升區寬度比例
  moonZoneRatio: 0.5,
  // 可調參數區：滿月上升速度等級範圍（1 最慢、10 最快，每顆隨機）
  moonSpeedLevelMin: 1,
  moonSpeedLevelMax: 10,
  // 可調參數區：連擊字樣顯示時間（毫秒）
  comboBannerMs: 900,
  // 可調參數區：最高分 localStorage 鍵名
  bestScoreKey: "campus-toolkit-chang-e-best-score",
};

function createSpinInterval(): number {
  const range = CONFIG.spinIntervalMax - CONFIG.spinIntervalMin + 1;
  return CONFIG.spinIntervalMin + Math.floor(Math.random() * range);
}

function loadBestScore(): number | null {
  try {
    const raw = window.localStorage.getItem(CONFIG.bestScoreKey);
    if (raw === null) return null;
    const value = Number.parseInt(raw, 10);
    return Number.isFinite(value) && value >= 0 ? value : null;
  } catch {
    return null;
  }
}

function saveBestScore(value: number): void {
  try {
    window.localStorage.setItem(CONFIG.bestScoreKey, String(value));
  } catch {
    // 忽略寫入失敗
  }
}

type LeaderboardRow = {
  rank: number;
  name: string;
  role: string;
  roleLabel: string;
  score: number;
  recordDate: string;
};

type LeaderboardMy = {
  name: string;
  role: string;
  roleLabel: string;
  score: number;
  rank: number | null;
  recordDate: string;
};

async function loadRemoteBestScore(): Promise<number | null> {
  try {
    const res = await fetch("/api/moon-leaderboard", { cache: "no-store" });
    if (!res.ok) return null;
    const data = await res.json();
    if (data?.success && data.my && typeof data.my.score === "number") return data.my.score;
    return null;
  } catch {
    return null;
  }
}

async function saveRemoteBestScore(score: number): Promise<boolean> {
  try {
    const res = await fetch("/api/moon-leaderboard", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ score }),
    });
    return res.ok;
  } catch (error) {
    console.error("同步排行榜失敗:", error);
    return false;
  }
}

async function loadLeaderboard(): Promise<{ top: LeaderboardRow[]; my: LeaderboardMy | null } | null> {
  try {
    const res = await fetch("/api/moon-leaderboard", { cache: "no-store" });
    if (!res.ok) return null;
    const data = await res.json();
    if (!data?.success) return null;
    return { top: data.top ?? [], my: data.my ?? null };
  } catch {
    return null;
  }
}

function createMetalHitContext(): AudioContext | null {
  try {
    const Ctor = window.AudioContext ?? (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    return new Ctor();
  } catch {
    return null;
  }
}

function playMoonChime(audioCtx: AudioContext | null): void {
  if (!audioCtx) return;
  if (audioCtx.state === "suspended") {
    void audioCtx.resume();
  }

  const now = audioCtx.currentTime;
  const master = audioCtx.createGain();
  master.gain.setValueAtTime(0.45, now);
  master.gain.exponentialRampToValueAtTime(0.001, now + 0.55);
  master.connect(audioCtx.destination);

  // 空靈風鈴／碰鐘感：C6–E6–G6 琶音點亮，適合嫦娥碰月
  const partials = [
    { freq: 1046.5, delay: 0, decay: 0.5 },
    { freq: 1318.5, delay: 0.05, decay: 0.45 },
    { freq: 1568.0, delay: 0.1, decay: 0.4 },
  ];
  partials.forEach(({ freq, delay, decay }, index) => {
    const start = now + delay;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(freq, start);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(0.7 / (index + 1), start + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, start + decay);
    osc.connect(gain);
    gain.connect(master);
    osc.start(start);
    osc.stop(start + decay + 0.05);
  });
}

let changEImageCache: HTMLImageElement | null = null;

function getChangEImage(): HTMLImageElement | null {
  if (typeof window === "undefined") return null;
  if (!changEImageCache) {
    const img = new window.Image();
    img.src = changEImageUrl.src;
    changEImageCache = img;
  }
  return changEImageCache;
}

function createRuntime(width: number, height: number): RuntimeState {
  return {
    running: true,
    width,
    height,
    elapsedMs: 0,
    moons: [],
    spawnAccumulator: 0,
    flightCount: 0,
    nextSpinFlightCount: createSpinInterval(),
    playerY: Math.round(height * 0.5),
    moveUp: false,
    moveDown: false,
    projectile: {
      active: false,
      x: 0,
      y: 0,
      width: 96,
      height: 60,
      speed: CONFIG.projectileSpeed,
      angle: 0,
      spinSpeed: 0,
      hitsThisShot: 0,
      resolved: false,
    },
  };
}

function getComboLabel(hits: number): string {
  if (hits <= 1) return "";
  if (hits === 2) return "DOUBLE KILL";
  if (hits === 3) return "TRIPLE KILL";
  return `${hits}X KILL`;
}

function intersects(a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

function drawMoon(ctx: CanvasRenderingContext2D, moon: FallingMoon) {
  const size = Math.round(moon.size);
  const cx = Math.round(moon.x + size / 2);
  const cy = Math.round(moon.y + size / 2);
  const radius = size / 2;

  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.fillStyle = "#ffe9a3";
  ctx.fill();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = "#d4a53a";
  ctx.stroke();

  ctx.fillStyle = "#f3d584";
  ctx.beginPath();
  ctx.arc(cx - radius * 0.28, cy - radius * 0.2, radius * 0.26, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(cx + radius * 0.24, cy + radius * 0.3, radius * 0.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(cx + radius * 0.3, cy - radius * 0.35, radius * 0.14, 0, Math.PI * 2);
  ctx.fill();
}

function drawChangE(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number) {
  const img = getChangEImage();
  if (!img || !img.complete || img.naturalWidth === 0) return;
  const scale = Math.min(width / img.naturalWidth, height / img.naturalHeight);
  const drawWidth = img.naturalWidth * scale;
  const drawHeight = img.naturalHeight * scale;
  ctx.drawImage(img, x + (width - drawWidth) / 2, y + (height - drawHeight) / 2, drawWidth, drawHeight);
}

export default function HomepageCornerChangE() {
  const [open, setOpen] = useState(false);
  const [score, setScore] = useState(0);
  const [changEsLeft, setChangEsLeft] = useState(CONFIG.startingChangEs);
  const [comboLabel, setComboLabel] = useState("");
  const [finished, setFinished] = useState(false);
  const [bestScore, setBestScore] = useState<number | null>(null);
  const [remoteBest, setRemoteBest] = useState<number | null>(null);
  const [showBoard, setShowBoard] = useState(false);
  const [boardRows, setBoardRows] = useState<LeaderboardRow[]>([]);
  const [boardMy, setBoardMy] = useState<LeaderboardMy | null>(null);
  const [boardLoading, setBoardLoading] = useState(false);
  const [playerName, setPlayerName] = useState("匿名");
  const [playerRanked, setPlayerRanked] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const frameRef = useRef<number | null>(null);
  const comboTimerRef = useRef<number | null>(null);
  const scoreRef = useRef(0);
  const changEsRef = useRef(CONFIG.startingChangEs);
  const runtimeRef = useRef<RuntimeState>(createRuntime(960, 540));
  const prevTsRef = useRef(0);
  const bodyOverflowRef = useRef("");
  const audioCtxRef = useRef<AudioContext | null>(null);
  const bestScoreRef = useRef<number | null>(null);
  const remoteBestRef = useRef<number | null>(null);
  const pointerStartRef = useRef<{ x: number; y: number } | null>(null);
  const pointerDraggedRef = useRef(false);
  const finishedRef = useRef(false);
  const loggedInRef = useRef(false);
  const sessionReadyRef = useRef(false);
  const syncedScoreRef = useRef<number | null>(null);

  const closeOverlay = useCallback(() => {
    setOpen(false);
    setShowBoard(false);
  }, []);

  const refreshLeaderboard = useCallback(async () => {
    setBoardLoading(true);
    const data = await loadLeaderboard();
    if (data) {
      setBoardRows(data.top);
      setBoardMy(data.my);
    }
    setBoardLoading(false);
  }, []);

  const toggleLeaderboard = useCallback(() => {
    const next = !showBoard;
    setShowBoard(next);
    if (next) void refreshLeaderboard();
  }, [refreshLeaderboard, showBoard]);

  const syncRemoteBest = useCallback(async (currentScore: number): Promise<boolean> => {
    const ok = await saveRemoteBestScore(currentScore);
    if (ok) {
      const prev = remoteBestRef.current;
      if (prev === null || currentScore > prev) {
        remoteBestRef.current = currentScore;
        setRemoteBest(currentScore);
      }
    }
    return ok;
  }, []);

  const commitBestScore = useCallback((currentScore: number) => {
    const previousBest = bestScoreRef.current;
    const improved = previousBest === null || currentScore > previousBest;
    if (improved) {
      bestScoreRef.current = currentScore;
      setBestScore(currentScore);
      saveBestScore(currentScore);
    }

    // 只上傳「登入後本局實際拿到的分數」；匿名 localStorage 舊分不送上榜
    if (!loggedInRef.current || !sessionReadyRef.current) return;
    if (currentScore <= 0) return;
    if (syncedScoreRef.current !== null && currentScore <= syncedScoreRef.current) return;
    syncedScoreRef.current = currentScore;
    void syncRemoteBest(currentScore);
  }, [syncRemoteBest]);

  const resetRound = useCallback(() => {
    runtimeRef.current = createRuntime(960, 540);
    scoreRef.current = 0;
    changEsRef.current = CONFIG.startingChangEs;
    finishedRef.current = false;
    syncedScoreRef.current = null;
    setScore(0);
    setChangEsLeft(CONFIG.startingChangEs);
    setComboLabel("");
    setFinished(false);
    prevTsRef.current = 0;
  }, []);

  const spawnMoon = useCallback((runtime: RuntimeState) => {
    const size = CONFIG.moonSize;
    const maxX = Math.floor(runtime.width * CONFIG.moonZoneRatio) - size - 8;
    const minX = 8;
    const x = Math.max(minX, Math.floor(Math.random() * Math.max(1, maxX - minX + 1)) + minX);
    const speedLevel =
      CONFIG.moonSpeedLevelMin +
      Math.random() * (CONFIG.moonSpeedLevelMax - CONFIG.moonSpeedLevelMin);
    const rampByTime = (runtime.elapsedMs / 1000 / 30) * CONFIG.moonTimeRampSpeed;
    const rampByScore = scoreRef.current * CONFIG.moonScoreRampSpeed;
    const levelMid = (CONFIG.moonSpeedLevelMin + CONFIG.moonSpeedLevelMax) / 2;
    const speed =
      ((CONFIG.moonBaseFallSpeed + rampByTime + rampByScore) * speedLevel) / levelMid;
    runtime.moons.push({ x, y: runtime.height + 10, size, speed });
  }, []);

  const resolveShot = useCallback(() => {
    const runtime = runtimeRef.current;
    const projectile = runtime.projectile;
    if (projectile.resolved) return;
    projectile.resolved = true;

    const hits = projectile.hitsThisShot;
    if (hits > 0) {
      const gained = hits * hits;
      scoreRef.current += gained;
      setScore(scoreRef.current);
      commitBestScore(scoreRef.current);
      const label = getComboLabel(hits);
      if (label) {
        setComboLabel(label);
        if (comboTimerRef.current !== null) {
          window.clearTimeout(comboTimerRef.current);
        }
        comboTimerRef.current = window.setTimeout(() => {
          setComboLabel("");
        }, CONFIG.comboBannerMs);
      }
      return;
    }

    changEsRef.current -= 1;
    setChangEsLeft(changEsRef.current);
    if (changEsRef.current <= 0) {
      runtime.running = false;
      commitBestScore(scoreRef.current);
      finishedRef.current = true;
      setFinished(true);
    }
  }, [commitBestScore]);

  const fireProjectile = useCallback(() => {
    const runtime = runtimeRef.current;
    if (!runtime.running || finishedRef.current) return;
    const projectile = runtime.projectile;
    if (projectile.active) return;

    const x = Math.floor(runtime.width * (1 - CONFIG.playerZoneRatio / 2));
    const y = Math.round(runtime.playerY - projectile.height / 2);
    runtime.flightCount += 1;
    const shouldSpin = runtime.flightCount >= runtime.nextSpinFlightCount;
    if (shouldSpin) {
      runtime.flightCount = 0;
      runtime.nextSpinFlightCount = createSpinInterval();
    }
    runtime.projectile = {
      ...projectile,
      active: true,
      x,
      y,
      angle: 0,
      spinSpeed: shouldSpin ? -CONFIG.projectileSpinSpeed : 0,
      hitsThisShot: 0,
      resolved: false,
    };
  }, []);

  const tick = useCallback((timestamp: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const runtime = runtimeRef.current;
    if (!runtime.running && !finishedRef.current) return;

    if (prevTsRef.current === 0) {
      prevTsRef.current = timestamp;
    }
    const deltaMs = Math.min(40, timestamp - prevTsRef.current);
    prevTsRef.current = timestamp;
    const dt = deltaMs / 1000;

    runtime.elapsedMs += deltaMs;
    const playerMinY = 36;
    const playerMaxY = runtime.height - 36;

    if (runtime.moveUp) runtime.playerY -= CONFIG.moveSpeed * dt;
    if (runtime.moveDown) runtime.playerY += CONFIG.moveSpeed * dt;
    runtime.playerY = Math.max(playerMinY, Math.min(playerMaxY, runtime.playerY));

    const spawnInterval = Math.max(
      CONFIG.moonSpawnMinInterval,
      CONFIG.moonSpawnBaseInterval -
        (runtime.elapsedMs / 1000 / 18) * CONFIG.moonSpawnTimeRamp -
        scoreRef.current * CONFIG.moonSpawnScoreRamp
    );
    runtime.spawnAccumulator += dt;
    while (runtime.spawnAccumulator >= spawnInterval && runtime.running) {
      runtime.spawnAccumulator -= spawnInterval;
      spawnMoon(runtime);
    }

    runtime.moons.forEach((moon) => {
      moon.y -= moon.speed * dt;
    });
    runtime.moons = runtime.moons.filter((moon) => moon.y + moon.size > -12);

    const projectile = runtime.projectile;
    const bobOffset = Math.sin((runtime.elapsedMs / 1000) * CONFIG.bobAngularSpeed) * CONFIG.bobAmplitude;
    const idleBobOffset =
      Math.sin((runtime.elapsedMs / 1000) * CONFIG.idleBobAngularSpeed) * CONFIG.idleBobAmplitude;
    if (projectile.active) {
      projectile.x -= projectile.speed * dt;
      projectile.angle += projectile.spinSpeed * dt;

      const projectileBox = {
        x: projectile.x,
        y: projectile.y + bobOffset,
        w: projectile.width,
        h: projectile.height,
      };
      runtime.moons = runtime.moons.filter((moon) => {
        const moonBox = { x: moon.x, y: moon.y, w: moon.size, h: moon.size };
        const hit = intersects(projectileBox, moonBox);
        if (hit) {
          projectile.hitsThisShot += 1;
          playMoonChime(audioCtxRef.current);
        }
        return !hit;
      });

      if (projectile.x + projectile.width < -20) {
        projectile.active = false;
        resolveShot();
      }
    }

    ctx.imageSmoothingEnabled = true;
    ctx.fillStyle = "#f9f9f9";
    ctx.fillRect(0, 0, runtime.width, runtime.height);

    runtime.moons.forEach((moon) => drawMoon(ctx, moon));

    const playerWidth = 96;
    const playerHeight = 60;
    const playerX = Math.floor(runtime.width * (1 - CONFIG.playerZoneRatio / 2)) - playerWidth / 2;
    const playerY = runtime.playerY - playerHeight / 2;

    if (!projectile.active) {
      drawChangE(ctx, playerX, playerY + idleBobOffset, playerWidth, playerHeight);
    } else {
      ctx.save();
      const cx = projectile.x + projectile.width / 2;
      const cy = projectile.y + bobOffset + projectile.height / 2;
      ctx.translate(cx, cy);
      ctx.rotate(projectile.angle);
      drawChangE(
        ctx,
        -projectile.width / 2,
        -projectile.height / 2,
        projectile.width,
        projectile.height
      );
      ctx.restore();
    }

    frameRef.current = window.requestAnimationFrame(tick);
  }, [resolveShot, spawnMoon]);

  const setPlayerYFromClientY = useCallback((clientY: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    if (rect.height === 0) return;
    const scaleY = canvas.height / rect.height;
    const y = (clientY - rect.top) * scaleY;
    const runtime = runtimeRef.current;
    runtime.playerY = Math.max(36, Math.min(runtime.height - 36, y));
  }, []);

  const handlePointerDown = useCallback((event: React.PointerEvent<HTMLCanvasElement>) => {
    if (finishedRef.current) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    pointerStartRef.current = { x: event.clientX, y: event.clientY };
    pointerDraggedRef.current = false;
    setPlayerYFromClientY(event.clientY);
  }, [setPlayerYFromClientY]);

  const handlePointerMove = useCallback((event: React.PointerEvent<HTMLCanvasElement>) => {
    if (finishedRef.current) return;
    if (pointerStartRef.current) {
      const dx = event.clientX - pointerStartRef.current.x;
      const dy = event.clientY - pointerStartRef.current.y;
      if (Math.abs(dx) > 6 || Math.abs(dy) > 6) {
        pointerDraggedRef.current = true;
      }
    }
    setPlayerYFromClientY(event.clientY);
  }, [setPlayerYFromClientY]);

  const handlePointerUp = useCallback((event: React.PointerEvent<HTMLCanvasElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    const wasDrag = pointerDraggedRef.current;
    pointerStartRef.current = null;
    pointerDraggedRef.current = false;
    if (!wasDrag) {
      fireProjectile();
    }
  }, [fireProjectile]);

  const handlePointerCancel = useCallback((event: React.PointerEvent<HTMLCanvasElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    pointerStartRef.current = null;
    pointerDraggedRef.current = false;
  }, []);

  useEffect(() => {
    if (!open) return;

    resetRound();
    const localBest = loadBestScore();
    bestScoreRef.current = localBest;
    setBestScore(localBest);
    audioCtxRef.current = createMetalHitContext();
    getChangEImage();

    let cancelled = false;
    void (async () => {
      const session = await fetchSession(true);
      if (cancelled) return;
      const loggedIn = Boolean(session);
      loggedInRef.current = loggedIn;
      sessionReadyRef.current = true;
      setPlayerName(session ? session.displayName || session.account || "玩家" : "匿名");
      setPlayerRanked(loggedIn);

      if (!session) {
        setRemoteBest(null);
        remoteBestRef.current = null;
        return;
      }

      const remote = await loadRemoteBestScore();
      if (cancelled) return;

      // 榜上紀錄與本機最高分分開顯示，不互相合併
      if (remote !== null) {
        remoteBestRef.current = remote;
        setRemoteBest(remote);
        syncedScoreRef.current = remote;
      }

      // 遊戲已結束但當時 session 未就緒 → 補送「本局」分數（不是 localStorage）
      if (finishedRef.current && scoreRef.current > 0) {
        const finalScore = scoreRef.current;
        if (syncedScoreRef.current === null || finalScore > syncedScoreRef.current) {
          syncedScoreRef.current = finalScore;
          void syncRemoteBest(finalScore);
        }
      }
    })();

    const canvas = canvasRef.current;
    if (!canvas) return () => { cancelled = true; };

    bodyOverflowRef.current = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const focusCanvas = window.setTimeout(() => {
      canvas.focus();
    }, 0);

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeOverlay();
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        runtimeRef.current.moveUp = true;
      } else if (event.key === "ArrowDown") {
        event.preventDefault();
        runtimeRef.current.moveDown = true;
      } else if (event.key === " " || event.code === "Space") {
        event.preventDefault();
        fireProjectile();
      }
    };

    const onKeyUp = (event: KeyboardEvent) => {
      if (event.key === "ArrowUp") runtimeRef.current.moveUp = false;
      if (event.key === "ArrowDown") runtimeRef.current.moveDown = false;
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    frameRef.current = window.requestAnimationFrame(tick);

    return () => {
      cancelled = true;
      window.clearTimeout(focusCanvas);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      document.body.style.overflow = bodyOverflowRef.current;
      runtimeRef.current.moveUp = false;
      runtimeRef.current.moveDown = false;
      runtimeRef.current.running = false;
      loggedInRef.current = false;
      sessionReadyRef.current = false;
      syncedScoreRef.current = null;
      setPlayerName("匿名");
      setPlayerRanked(false);
      if (frameRef.current !== null) {
        window.cancelAnimationFrame(frameRef.current);
      }
      frameRef.current = null;
      if (comboTimerRef.current !== null) {
        window.clearTimeout(comboTimerRef.current);
      }
      comboTimerRef.current = null;
      setComboLabel("");
      if (audioCtxRef.current) {
        void audioCtxRef.current.close();
        audioCtxRef.current = null;
      }
    };
  }, [closeOverlay, fireProjectile, open, resetRound, tick]);

  return (
    <>
      <button
        type="button"
        title="嫦娥奔月"
        onClick={() => setOpen(true)}
        className="fixed left-4 top-[88px] z-20 p-1 rounded border border-themed bg-card/80 hover:bg-surface transition-colors cursor-pointer"
        aria-label="開啟嫦娥奔月"
      >
        <svg
          viewBox="0 0 24 24"
          width={18}
          height={18}
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />
        </svg>
      </button>

      {open && (
        <div className="fixed inset-0 z-[90] bg-black/50 flex items-center justify-center px-3 py-4">
          <div className="relative w-full max-w-[1020px] mx-auto">
            <button
              type="button"
              title="關閉（Esc）"
              onClick={closeOverlay}
              className="absolute -right-3 -top-3 z-10 flex h-9 w-9 items-center justify-center rounded-full border border-slate-500 bg-white text-black shadow hover:bg-slate-100 cursor-pointer"
              aria-label="關閉視窗"
            >
              <svg
                viewBox="0 0 24 24"
                width={16}
                height={16}
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                aria-hidden="true"
              >
                <path d="M18 6 6 18" />
                <path d="m6 6 12 12" />
              </svg>
            </button>
            {/* 行動裝置（<sm）：狀態列放在畫布外的上方，避免遮擋左上角遊戲區 */}
            <div className="sm:hidden mb-1.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 rounded border border-black bg-white px-2.5 py-1.5 pr-16 font-mono text-xs text-black">
              <span className="shrink-0">分數 {score}</span>
              <span className="shrink-0">嫦娥 {changEsLeft}</span>
              {bestScore !== null && <span className="shrink-0">最高 {bestScore}</span>}
              {playerRanked && (
                <span className="shrink-0">榜上 {remoteBest !== null ? remoteBest : "—"}</span>
              )}
              <span className="min-w-0 max-w-full truncate">
                玩家 {playerName}
                {!playerRanked && "（不列入排行榜）"}
              </span>
            </div>

            <canvas
              ref={canvasRef}
              width={960}
              height={540}
              tabIndex={0}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerCancel={handlePointerCancel}
              className="w-full h-auto max-h-[82vh] border border-slate-500 bg-[#f9f9f9] outline-none touch-none cursor-crosshair"
              aria-label="互動畫布"
            />

            <p className="mt-1 text-center text-xs text-t3">
              <a
                href="https://zh.pngtree.com/freepng/mid-autumn-festival-cartoon-hand-drawn-dragonfly-flying-to-the--star-diamond-fairy_3853789.html"
                target="_blank"
                rel="noopener noreferrer"
              >
                png 圖片來源於 zh.pngtree.com/
              </a>
            </p>

            <div className="hidden sm:block pointer-events-none absolute left-3 top-3 text-black font-mono text-sm sm:text-base">
              <div>
                玩家: {playerName}
                {!playerRanked && "（不列入排行榜）"}
              </div>
              <div>分數: {score}</div>
              <div>嫦娥數: {changEsLeft}</div>
              {bestScore !== null && <div>本機最高分: {bestScore}</div>}
              {playerRanked && (
                <div>榜上紀錄: {remoteBest !== null ? remoteBest : "—"}</div>
              )}
              {!playerRanked && bestScore !== null && (
                <div className="text-[0.9em]">（本機紀錄，不上傳）</div>
              )}
            </div>

            <button
              type="button"
              onClick={toggleLeaderboard}
              className="absolute right-3 top-3 z-10 rounded border border-black bg-white px-2 py-1 text-xs sm:text-sm text-black hover:bg-slate-100 cursor-pointer"
            >
              {showBoard ? "關閉排行榜" : "排行榜"}
            </button>

            {showBoard && (
              <div className="absolute inset-0 z-[95] flex items-center justify-center bg-white/90 px-3">
                <div className="w-full max-w-[480px] max-h-[86%] overflow-auto rounded border border-black bg-white p-4 text-black">
                  <div className="mb-3 flex items-center justify-between">
                    <h3 className="text-lg font-bold">嫦娥奔月排行榜 TOP 100</h3>
                    <button
                      type="button"
                      onClick={() => setShowBoard(false)}
                      className="text-sm underline cursor-pointer"
                    >
                      關閉
                    </button>
                  </div>
                  {boardMy && (
                    <p className="mb-3 text-sm">
                      我的名次: {boardMy.rank ?? "未上榜"}（{boardMy.score} 分
                      {boardMy.recordDate ? `，${boardMy.recordDate}` : ""}）
                    </p>
                  )}
                  {boardLoading ? (
                    <p className="text-sm text-t3">載入中...</p>
                  ) : boardRows.length === 0 ? (
                    <p className="text-sm text-t3">尚無資料</p>
                  ) : (
                    <table className="w-full text-left text-sm">
                      <thead>
                        <tr className="border-b border-black">
                          <th className="py-1 pr-2">#</th>
                          <th className="py-1 pr-2">名稱</th>
                          <th className="py-1 pr-2">身分</th>
                          <th className="py-1 pr-2">分數</th>
                          <th className="py-1 text-right">紀錄日期</th>
                        </tr>
                      </thead>
                      <tbody>
                        {boardRows.map((row) => (
                          <tr key={`${row.rank}-${row.name}`} className="border-b border-slate-200">
                            <td className="py-1 pr-2">{row.rank}</td>
                            <td className="py-1 pr-2">{row.name}</td>
                            <td className="py-1 pr-2">{row.roleLabel}</td>
                            <td className="py-1 pr-2">{row.score}</td>
                            <td className="py-1 text-right whitespace-nowrap">{row.recordDate || "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              </div>
            )}

            {comboLabel && !finished && (
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                <div className="text-black text-2xl sm:text-4xl font-bold tracking-wider">{comboLabel}</div>
              </div>
            )}

            {finished && (
              <div className="absolute inset-0 flex items-center justify-center bg-white/80">
                <div className="w-[88%] max-w-[420px] rounded border border-black bg-white px-6 py-7 text-center text-black">
                  <h2 className="text-2xl font-bold mb-2">遊戲結束</h2>
                  <p className="text-base mb-2">分數: {score}</p>
                  <p className="text-base mb-1">本機最高分: {bestScore ?? score}</p>
                  {playerRanked && (
                    <p className="text-base mb-1">榜上紀錄: {remoteBest ?? "—"}</p>
                  )}
                  {!playerRanked && (
                    <p className="text-sm text-t3 mb-4">（本機紀錄，不列入排行榜）</p>
                  )}
                  <p className="text-base mb-4 font-medium">再來一局？</p>
                  <div className="flex flex-col sm:flex-row gap-3 justify-center">
                    <button
                      type="button"
                      onClick={resetRound}
                      className="px-4 py-2 rounded border border-black text-black hover:bg-slate-100 cursor-pointer"
                    >
                      再來一局
                    </button>
                    <button
                      type="button"
                      onClick={toggleLeaderboard}
                      className="px-4 py-2 rounded border border-black text-black hover:bg-slate-100 cursor-pointer"
                    >
                      排行榜
                    </button>
                    <button
                      type="button"
                      onClick={closeOverlay}
                      className="px-4 py-2 rounded border border-black text-black hover:bg-slate-100 cursor-pointer"
                    >
                      關閉
                    </button>
                  </div>
                  <p className="text-xs text-slate-700 mt-5">滑鼠上下移動嫦娥，點擊或空白鍵發射，Esc 關閉</p>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
