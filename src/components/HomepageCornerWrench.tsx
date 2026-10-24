"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { fetchSession } from "@/lib/session";

type FallingNut = {
  x: number;
  y: number;
  size: number;
  speed: number;
};

type WrenchProjectile = {
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
  nuts: FallingNut[];
  spawnAccumulator: number;
  playerY: number;
  moveUp: boolean;
  moveDown: boolean;
  projectile: WrenchProjectile;
};

const CONFIG = {
  // 可調參數區：每回合起始扳手數量
  startingWrenches: 5,
  // 可調參數區：螺帽基礎掉落速度（像素/秒）
  nutBaseFallSpeed: 150,
  // 可調參數區：螺帽隨時間增加掉落速度（像素/秒）
  nutTimeRampSpeed: 16,
  // 可調參數區：螺帽隨分數增加掉落速度（像素/秒）
  nutScoreRampSpeed: 4,
  // 可調參數區：螺帽生成基礎間隔（秒）
  nutSpawnBaseInterval: 1.4,
  // 可調參數區：螺帽最小生成間隔（秒）
  nutSpawnMinInterval: 0.3,
  // 可調參數區：螺帽生成隨時間加速係數（秒）
  nutSpawnTimeRamp: 0.028,
  // 可調參數區：螺帽生成隨分數加速係數（秒）
  nutSpawnScoreRamp: 0.011,
  // 可調參數區：螺帽像素尺寸
  nutSize: 24,
  // 可調參數區：扳手上下移動速度（像素/秒）
  wrenchMoveSpeed: 290,
  // 可調參數區：扳手飛行速度（像素/秒）
  projectileSpeed: 490,
  // 可調參數區：扳手旋轉速度（弧度/秒）
  projectileSpinSpeed: 8.4,
  // 可調參數區：右側扳手活動區寬度比例
  wrenchZoneRatio: 0.2,
  // 可調參數區：左側螺帽掉落區寬度比例
  nutZoneRatio: 0.5,
  // 可調參數區：螺帽掉落速度等級範圍（1 最慢、10 最快，每顆隨機）
  nutSpeedLevelMin: 1,
  nutSpeedLevelMax: 10,
  // 可調參數區：連擊字樣顯示時間（毫秒）
  comboBannerMs: 900,
  // 可調參數區：最高分 localStorage 鍵名
  bestScoreKey: "campus-toolkit-wrench-best-score",
};

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
    const res = await fetch("/api/wrench-leaderboard", { cache: "no-store" });
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
    const res = await fetch("/api/wrench-leaderboard", {
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
    const res = await fetch("/api/wrench-leaderboard", { cache: "no-store" });
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

function playMetalHit(audioCtx: AudioContext | null): void {
  if (!audioCtx) return;
  if (audioCtx.state === "suspended") {
    void audioCtx.resume();
  }

  const now = audioCtx.currentTime;
  const master = audioCtx.createGain();
  master.gain.setValueAtTime(0.7, now);
  master.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
  master.connect(audioCtx.destination);

  const partials = [1850, 2680, 3410];
  partials.forEach((freq, index) => {
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = index === 0 ? "triangle" : "sine";
    osc.frequency.setValueAtTime(freq, now);
    osc.frequency.exponentialRampToValueAtTime(freq * 0.72, now + 0.16);
    gain.gain.setValueAtTime(0.9 / (index + 1), now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.16 - index * 0.02);
    osc.connect(gain);
    gain.connect(master);
    osc.start(now);
    osc.stop(now + 0.18);
  });
}

function createRuntime(width: number, height: number): RuntimeState {
  return {
    running: true,
    width,
    height,
    elapsedMs: 0,
    nuts: [],
    spawnAccumulator: 0,
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
      spinSpeed: CONFIG.projectileSpinSpeed,
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

function drawNut(ctx: CanvasRenderingContext2D, nut: FallingNut) {
  const size = Math.round(nut.size);
  const cx = Math.round(nut.x + size / 2);
  const cy = Math.round(nut.y + size / 2);
  const outer = size / 2;
  const inner = outer * 0.7;
  const hole = Math.max(4, Math.floor(size * 0.22));

  const hexPath = (radius: number) => {
    ctx.beginPath();
    for (let i = 0; i < 6; i += 1) {
      const angle = (Math.PI / 3) * i - Math.PI / 2;
      const px = cx + Math.cos(angle) * radius;
      const py = cy + Math.sin(angle) * radius;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
  };

  ctx.fillStyle = "#111111";
  hexPath(outer);
  ctx.fill();

  ctx.fillStyle = "#ffffff";
  hexPath(inner);
  ctx.fill();

  ctx.fillStyle = "#111111";
  hexPath(hole);
  ctx.fill();
}

const WRENCH_SVG_D =
  "M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z";

function drawWrench(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number) {
  if (typeof Path2D === "undefined") return;
  const path = new Path2D(WRENCH_SVG_D);
  const scale = Math.min(width / 24, height / 24);

  ctx.save();
  ctx.translate(x + width / 2, y + height / 2);
  ctx.rotate(Math.PI / 4);
  ctx.scale(scale, scale);
  ctx.translate(-12, -12);
  ctx.fillStyle = "transparent";
  ctx.strokeStyle = "#111111";
  ctx.lineWidth = 2;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.stroke(path);
  ctx.restore();
}

export default function HomepageCornerWrench({
  hideLauncher = false,
  openSignal = 0,
}: {
  /** 不顯示左上角浮動按鈕（改由外部卡片開啟） */
  hideLauncher?: boolean;
  /** 外部開啟訊號：數值遞增即開啟遊戲視窗 */
  openSignal?: number;
}) {
  const [open, setOpen] = useState(false);
  const [score, setScore] = useState(0);
  const [wrenchesLeft, setWrenchesLeft] = useState(CONFIG.startingWrenches);
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
  const wrenchesRef = useRef(CONFIG.startingWrenches);
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

  // 外部卡片開啟：訊號遞增即開啟遊戲視窗
  useEffect(() => {
    if (openSignal > 0) setOpen(true);
  }, [openSignal]);

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
    wrenchesRef.current = CONFIG.startingWrenches;
    finishedRef.current = false;
    syncedScoreRef.current = null;
    setScore(0);
    setWrenchesLeft(CONFIG.startingWrenches);
    setComboLabel("");
    setFinished(false);
    prevTsRef.current = 0;
  }, []);

  const spawnNut = useCallback((runtime: RuntimeState) => {
    const size = CONFIG.nutSize;
    const maxX = Math.floor(runtime.width * CONFIG.nutZoneRatio) - size - 8;
    const minX = 8;
    const x = Math.max(minX, Math.floor(Math.random() * Math.max(1, maxX - minX + 1)) + minX);
    const speedLevel =
      CONFIG.nutSpeedLevelMin +
      Math.random() * (CONFIG.nutSpeedLevelMax - CONFIG.nutSpeedLevelMin);
    const rampByTime = (runtime.elapsedMs / 1000 / 30) * CONFIG.nutTimeRampSpeed;
    const rampByScore = scoreRef.current * CONFIG.nutScoreRampSpeed;
    const levelMid = (CONFIG.nutSpeedLevelMin + CONFIG.nutSpeedLevelMax) / 2;
    const speed =
      ((CONFIG.nutBaseFallSpeed + rampByTime + rampByScore) * speedLevel) / levelMid;
    runtime.nuts.push({ x, y: -size - 10, size, speed });
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

    wrenchesRef.current -= 1;
    setWrenchesLeft(wrenchesRef.current);
    if (wrenchesRef.current <= 0) {
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

    const x = Math.floor(runtime.width * (1 - CONFIG.wrenchZoneRatio / 2));
    const y = Math.round(runtime.playerY - projectile.height / 2);
    runtime.projectile = {
      ...projectile,
      active: true,
      x,
      y,
      angle: 0,
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

    if (runtime.moveUp) runtime.playerY -= CONFIG.wrenchMoveSpeed * dt;
    if (runtime.moveDown) runtime.playerY += CONFIG.wrenchMoveSpeed * dt;
    runtime.playerY = Math.max(playerMinY, Math.min(playerMaxY, runtime.playerY));

    const spawnInterval = Math.max(
      CONFIG.nutSpawnMinInterval,
      CONFIG.nutSpawnBaseInterval -
        (runtime.elapsedMs / 1000 / 18) * CONFIG.nutSpawnTimeRamp -
        scoreRef.current * CONFIG.nutSpawnScoreRamp
    );
    runtime.spawnAccumulator += dt;
    while (runtime.spawnAccumulator >= spawnInterval && runtime.running) {
      runtime.spawnAccumulator -= spawnInterval;
      spawnNut(runtime);
    }

    runtime.nuts.forEach((nut) => {
      nut.y += nut.speed * dt;
    });
    runtime.nuts = runtime.nuts.filter((nut) => nut.y < runtime.height + nut.size + 12);

    const projectile = runtime.projectile;
    if (projectile.active) {
      projectile.x -= projectile.speed * dt;
      projectile.angle += projectile.spinSpeed * dt;

      const projectileBox = {
        x: projectile.x,
        y: projectile.y,
        w: projectile.width,
        h: projectile.height,
      };
      runtime.nuts = runtime.nuts.filter((nut) => {
        const nutBox = { x: nut.x, y: nut.y, w: nut.size, h: nut.size };
        const hit = intersects(projectileBox, nutBox);
        if (hit) {
          projectile.hitsThisShot += 1;
          playMetalHit(audioCtxRef.current);
        }
        return !hit;
      });

      if (projectile.x + projectile.width < -20) {
        projectile.active = false;
        resolveShot();
      }
    }

    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = "#f9f9f9";
    ctx.fillRect(0, 0, runtime.width, runtime.height);

    runtime.nuts.forEach((nut) => drawNut(ctx, nut));

    const playerWidth = 96;
    const playerHeight = 60;
    const playerX = Math.floor(runtime.width * (1 - CONFIG.wrenchZoneRatio / 2)) - playerWidth / 2;
    const playerY = runtime.playerY - playerHeight / 2;

    if (!projectile.active) {
      drawWrench(ctx, playerX, playerY, playerWidth, playerHeight);
    } else {
      ctx.save();
      const cx = runtime.projectile.x + runtime.projectile.width / 2;
      const cy = runtime.projectile.y + runtime.projectile.height / 2;
      ctx.translate(Math.round(cx), Math.round(cy));
      ctx.rotate(runtime.projectile.angle);
      drawWrench(
        ctx,
        -runtime.projectile.width / 2,
        -runtime.projectile.height / 2,
        runtime.projectile.width,
        runtime.projectile.height
      );
      ctx.restore();
    }

    frameRef.current = window.requestAnimationFrame(tick);
  }, [resolveShot, spawnNut]);

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
      {!hideLauncher && (
        <button
          type="button"
          title="維護工具"
          onClick={() => setOpen(true)}
          className="fixed left-4 top-[52px] z-20 p-1 rounded border border-themed bg-card/80 hover:bg-surface transition-colors cursor-pointer"
          aria-label="開啟維護工具"
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
          <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
        </svg>
        </button>
      )}

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
              <span className="shrink-0">板手 {wrenchesLeft}</span>
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

            <div className="hidden sm:block pointer-events-none absolute left-3 top-3 text-black font-mono text-sm sm:text-base">
              <div>
                玩家: {playerName}
                {!playerRanked && "（不列入排行榜）"}
              </div>
              <div>分數: {score}</div>
              <div>板手數: {wrenchesLeft}</div>
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
                    <h3 className="text-lg font-bold">丟板手排行榜 TOP 100</h3>
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
                  <p className="text-xs text-slate-700 mt-5">滑鼠上下移動板手，點擊或空白鍵發射，Esc 關閉</p>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
